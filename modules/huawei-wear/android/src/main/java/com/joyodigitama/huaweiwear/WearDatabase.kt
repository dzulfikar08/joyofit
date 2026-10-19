package com.joyodigitama.huaweiwear

import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteException
import android.util.Log
import java.io.Closeable
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * The database of the native code: `joyofit.db` through the SQLite library of expo-sqlite ([ExpoSqliteConnection]), the one
 * the JS side uses, instead of Android's own `android.database.sqlite`. See [ExpoSqliteConnection] for why two copies of
 * SQLite must never open the same file. The surface is the part of `SQLiteDatabase` the stores used (`rawQuery`, `execSQL`,
 * `compileStatement`, the three transaction calls, `version`), with the same behavior where the stores depend on it:
 * query arguments are bound as text, a failed statement throws [SQLiteException], an inner transaction that does not succeed
 * rolls back the outer one.
 *
 * One connection, shared by every thread. A transaction owns the connection from `beginTransaction` to `endTransaction` (a
 * lock held by the thread that began it); other threads wait for it, which is also what keeps their statements out of the
 * transaction. Results are read completely before a query returns, so no cursor holds anything open.
 */
internal class WearDatabase(val path: String, private val connection: SqlConnection) : Closeable {
  private val lock = ReentrantLock()

  /** Per open transaction level: whether `setTransactionSuccessful` was called for it. */
  private val levels = ArrayList<Boolean>()
  private var rollbackOnly = false
  private var closed = false

  /**
   * Runs [block] on the connection, alone. A corruption error is logged and rethrown; the file is never deleted from here: the
   * JS repair (`src/db/recovery`) keeps a copy of the damaged file and rebuilds the database from what can be read.
   */
  private fun <T> locked(block: () -> T): T = lock.withLock {
    if (closed) throw SQLiteException("The database is closed")
    try {
      block()
    } catch (e: SQLiteDatabaseCorruptException) {
      Log.e(TAG, "Corruption reported by sqlite on $path; the file is left for the repair")
      throw e
    }
  }

  fun rawQuery(sql: String, args: Array<out String?>?): WearCursor = locked {
    val statement = connection.prepare(sql)
    try {
      args?.forEachIndexed { i, value -> statement.bind(i + 1, value) }
      val rows = ArrayList<List<Any?>>()
      val columns = statement.columnCount()
      while (statement.step()) rows.add(statement.row())
      WearCursor(rows, columns)
    } finally {
      statement.close()
    }
  }

  fun execSQL(sql: String) {
    locked { connection.exec(sql) }
  }

  fun execSQL(sql: String, args: Array<out Any?>) {
    locked {
      val statement = connection.prepare(sql)
      try {
        args.forEachIndexed { i, value -> statement.bind(i + 1, bindable(value)) }
        while (statement.step()) { /* a statement with parameters that returns rows: nothing to keep */ }
      } finally {
        statement.close()
      }
    }
  }

  fun compileStatement(sql: String): WearStatement = locked { WearStatement(this, connection.prepare(sql)) }

  /** `PRAGMA user_version`. */
  var version: Int
    get() = rawQuery("PRAGMA user_version", null).use { if (it.moveToFirst()) it.getInt(0) else 0 }
    set(value) = execSQL("PRAGMA user_version = $value")

  /** Begins a transaction (`BEGIN IMMEDIATE`: the write lock is taken now, so a busy file fails here and not halfway through); nests. */
  fun beginTransaction() {
    lock.lock()
    try {
      if (closed) throw SQLiteException("The database is closed")
      if (levels.isEmpty()) {
        connection.exec("BEGIN IMMEDIATE")
        rollbackOnly = false
      }
      levels.add(false)
    } catch (e: Throwable) {
      lock.unlock()
      throw e
    }
  }

  fun setTransactionSuccessful() {
    check(lock.isHeldByCurrentThread && levels.isNotEmpty()) { "No transaction of this thread" }
    levels[levels.size - 1] = true
  }

  /** Ends the innermost transaction; the outermost commits when every level succeeded and rolls back otherwise. */
  fun endTransaction() {
    check(lock.isHeldByCurrentThread && levels.isNotEmpty()) { "No transaction of this thread" }
    try {
      if (!levels.removeAt(levels.size - 1)) rollbackOnly = true
      if (levels.isEmpty() && !closed) {
        if (rollbackOnly) {
          connection.exec("ROLLBACK")
        } else {
          try {
            connection.exec("COMMIT")
          } catch (e: SQLiteException) {
            // A commit that fails leaves the transaction open; the next statement must not run inside it.
            runCatching { connection.exec("ROLLBACK") }
            throw e
          }
        }
      }
    } finally {
      lock.unlock()
    }
  }

  /** Runs [block] (a statement of this database and what reads its outcome) with the connection to itself. */
  internal fun <T> withStatement(block: () -> T): T = locked(block)

  /** Finalizes [statement], unless closing the database did already (it finalizes every statement still open; twice is a use after free). */
  internal fun closeStatement(statement: SqlStatement) {
    lock.withLock {
      if (closed) statement.release() else statement.close()
    }
  }

  internal fun changes(): Int = connection.changes()

  internal fun lastInsertRowId(): Long = connection.lastInsertRowId()

  /** Rolls back what is open and closes the connection; further use throws. Waits for a transaction of another thread to end. */
  override fun close() {
    lock.withLock {
      if (closed) return
      if (levels.isNotEmpty()) {
        runCatching { connection.exec("ROLLBACK") }
        levels.clear()
      }
      closed = true
      connection.close()
    }
  }

  companion object {
    private const val TAG = "WearDatabase"

    /** Opens [path] (created when missing) and waits up to [busyTimeoutMs] for a lock another connection holds. */
    fun open(path: String, busyTimeoutMs: Int): WearDatabase {
      val connection = ExpoSqlConnection.open(path)
      try {
        connection.exec("PRAGMA busy_timeout = $busyTimeoutMs")
        // The journal mode is a property of the file, set by whoever creates it (JS: `migrate`); stating it here covers a file the native side creates first.
        connection.exec("PRAGMA journal_mode = WAL")
      } catch (e: Throwable) {
        connection.close()
        throw e
      }
      return WearDatabase(path, connection)
    }

    /** Android's `execSQL` bindings: integers and floats by type, everything else as text or bytes. */
    internal fun bindable(value: Any?): Any? = when (value) {
      null, is Long, is Int, is Double, is String, is ByteArray -> value
      is Short, is Byte -> (value as Number).toLong()
      is Float -> value.toDouble()
      is Boolean -> if (value) 1L else 0L
      else -> value.toString()
    }
  }
}

/** A prepared statement of [WearDatabase], used like Android's `SQLiteStatement`: bind, then execute; `clearBindings` between rows. */
internal class WearStatement(private val database: WearDatabase, private val statement: SqlStatement) : Closeable {
  fun bindLong(index: Int, value: Long) = statement.bind(index, value)

  fun bindDouble(index: Int, value: Double) = statement.bind(index, value)

  fun bindString(index: Int, value: String) = statement.bind(index, value)

  fun bindNull(index: Int) = statement.bind(index, null)

  fun clearBindings() = statement.clearBindings()

  /** Runs the statement; returns the new row's id, or -1 when it inserted nothing (`INSERT OR IGNORE` of an existing key). */
  fun executeInsert(): Long = run {
    if (database.changes() > 0) database.lastInsertRowId() else -1L
  }

  /** Runs the statement; returns the number of rows it changed. */
  fun executeUpdateDelete(): Int = run { database.changes() }

  private fun <T> run(after: () -> T): T = database.withStatement {
    try {
      while (statement.step()) { /* rows of a write statement are not read */ }
      after()
    } finally {
      statement.reset()
    }
  }

  override fun close() = database.closeStatement(statement)
}
