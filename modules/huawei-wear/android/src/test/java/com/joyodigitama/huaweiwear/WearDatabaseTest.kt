package com.joyodigitama.huaweiwear

import android.database.Cursor
import android.database.sqlite.SQLiteException
import java.io.File
import java.nio.file.Files
import java.sql.Connection
import java.sql.DriverManager
import java.sql.PreparedStatement
import java.sql.ResultSet
import java.sql.SQLException
import java.sql.Types
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** [SqlConnection] on sqlite-jdbc: the transaction, locking and binding rules of [WearDatabase] run here on a real SQLite file. */
private class JdbcSqlConnection(private val connection: Connection) : SqlConnection {
  var closed = false

  override fun exec(sql: String) {
    try {
      connection.createStatement().use { it.execute(sql) }
    } catch (e: SQLException) {
      throw SQLiteException(e.message)
    }
  }

  override fun prepare(sql: String): SqlStatement =
    try {
      JdbcSqlStatement(connection.prepareStatement(sql)).also { statements.add(it) }
    } catch (e: SQLException) {
      throw SQLiteException(e.message)
    }

  val statements = ArrayList<JdbcSqlStatement>()

  override fun changes(): Int = scalar("SELECT changes()").toInt()

  override fun lastInsertRowId(): Long = scalar("SELECT last_insert_rowid()")

  private fun scalar(sql: String): Long = connection.createStatement().use { s -> s.executeQuery(sql).use { rs -> rs.next(); rs.getLong(1) } }

  override fun close() {
    // Like sqlite3_close after sqlite3_finalize_all_statement: everything still open is finalized here.
    for (statement in statements) if (!statement.isClosed) statement.close()
    closed = true
    connection.close()
  }
}

private class JdbcSqlStatement(private val statement: PreparedStatement) : SqlStatement {
  private var rows: ResultSet? = null
  private var started = false
  var isClosed = false
  var released = false
  var finalizations = 0

  override fun bind(index: Int, value: Any?) {
    if (value == null) statement.setNull(index, Types.NULL) else statement.setObject(index, value)
  }

  override fun clearBindings() = statement.clearParameters()

  override fun reset() {
    rows?.close()
    rows = null
    started = false
  }

  override fun step(): Boolean {
    try {
      if (!started) {
        started = true
        rows = if (statement.execute()) statement.resultSet else null
      }
      return rows?.next() ?: false
    } catch (e: SQLException) {
      throw SQLiteException(e.message)
    }
  }

  override fun columnCount(): Int = statement.metaData?.columnCount ?: 0

  override fun row(): List<Any?> {
    val rs = rows ?: return emptyList()
    return List(columnCount()) {
      when (val value = rs.getObject(it + 1)) {
        is Int -> value.toLong()
        is Float -> value.toDouble()
        else -> value
      }
    }
  }

  override fun close() {
    finalizations++
    check(finalizations == 1) { "statement finalized twice" }
    isClosed = true
    statement.close()
  }

  override fun release() {
    released = true
  }
}

class WearDatabaseTest {
  private val dir: File = Files.createTempDirectory("wear-db").toFile()
  private val file = File(dir, "joyofit.db")
  private val connection = JdbcSqlConnection(DriverManager.getConnection("jdbc:sqlite:${file.path}"))
  private val db = WearDatabase(file.path, connection)

  init {
    db.execSQL("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT UNIQUE, n INTEGER, x REAL)")
  }

  @After
  fun cleanUp() {
    if (!connection.closed) db.close()
    dir.deleteRecursively()
  }

  private fun count(): Long = db.rawQuery("SELECT COUNT(*) FROM t", null).use { it.moveToFirst(); it.getLong(0) }

  @Test
  fun queryArgumentsAreBoundAsTextLikeAndroidDoes() {
    db.execSQL("INSERT INTO t (name, n) VALUES ('7', 7)")
    // A text argument compared with an integer column takes the column's affinity: the row is found.
    assertEquals(1, db.rawQuery("SELECT n FROM t WHERE n = ?", arrayOf("7")).use { it.count })
    // Against an expression there is no affinity and the text is compared as text: this is why the stores CAST.
    assertEquals(0, db.rawQuery("SELECT n FROM t WHERE n + 0 = ?", arrayOf("7")).use { it.count })
    assertEquals(1, db.rawQuery("SELECT n FROM t WHERE n + 0 = CAST(? AS INTEGER)", arrayOf("7")).use { it.count })
  }

  @Test
  fun cursorGettersConvertTheWayAndroidsDo() {
    db.execSQL("INSERT INTO t (name, n, x) VALUES (?, ?, ?)", arrayOf<Any?>("a", 5L, 1.5))
    db.execSQL("INSERT INTO t (name, n, x) VALUES (?, NULL, NULL)", arrayOf("b"))
    db.rawQuery("SELECT name, n, x FROM t ORDER BY id", null).use { c ->
      assertEquals(2, c.count)
      assertEquals(3, c.columnCount)
      assertTrue(c.moveToFirst())
      assertEquals("a", c.getString(0))
      assertEquals(5L, c.getLong(1))
      assertEquals(5, c.getInt(1))
      assertEquals("5", c.getString(1))
      assertEquals(1.5, c.getDouble(2), 0.0)
      assertTrue(c.moveToNext())
      assertTrue(c.isNull(1))
      assertNull(c.getString(2))
      assertFalse(c.moveToNext())
    }
    assertFalse(db.rawQuery("SELECT * FROM t WHERE id < 0", null).use { it.moveToFirst() })
  }

  @Test
  fun execSqlBindsTypedValuesAndAFailedStatementThrows() {
    db.execSQL("INSERT INTO t (name, n, x) VALUES (?, ?, ?)", arrayOf<Any?>("a", 3, 2.5f))
    db.rawQuery("SELECT name, n, x FROM t", null).use { c ->
      assertTrue(c.moveToFirst())
      assertEquals("a", c.getString(0))
      assertEquals(Cursor.FIELD_TYPE_INTEGER, c.getType(1))
      assertEquals(3L, c.getLong(1))
      assertEquals(Cursor.FIELD_TYPE_FLOAT, c.getType(2))
      assertEquals(2.5, c.getDouble(2), 0.0)
    }
    try {
      db.execSQL("INSERT INTO t (name) VALUES (?)", arrayOf("a"))
      fail("a unique violation must throw")
    } catch (expected: SQLiteException) {
      assertEquals(1L, count())
    }
  }

  @Test
  fun aTransactionCommitsOnSuccessAndRollsBackWithoutIt() {
    db.beginTransaction()
    try {
      db.execSQL("INSERT INTO t (name) VALUES ('kept')")
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    assertEquals(1L, count())

    db.beginTransaction()
    try {
      db.execSQL("INSERT INTO t (name) VALUES ('lost')")
    } finally {
      db.endTransaction()
    }
    assertEquals(1L, count())
  }

  @Test
  fun anInnerTransactionThatDoesNotSucceedRollsBackTheOuterOne() {
    db.beginTransaction()
    try {
      db.execSQL("INSERT INTO t (name) VALUES ('outer')")
      db.beginTransaction()
      try {
        db.execSQL("INSERT INTO t (name) VALUES ('inner')")
      } finally {
        db.endTransaction()
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    assertEquals(0L, count())
  }

  @Test
  fun nestedTransactionsThatAllSucceedCommitOnce() {
    db.beginTransaction()
    try {
      db.beginTransaction()
      try {
        db.execSQL("INSERT INTO t (name) VALUES ('inner')")
        db.setTransactionSuccessful()
      } finally {
        db.endTransaction()
      }
      db.execSQL("INSERT INTO t (name) VALUES ('outer')")
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    assertEquals(2L, count())
  }

  @Test
  fun aThrowingTransactionBodyRollsBackAndLeavesTheConnectionUsable() {
    try {
      db.beginTransaction()
      try {
        db.execSQL("INSERT INTO t (name) VALUES ('x')")
        error("boom")
      } finally {
        db.endTransaction()
      }
    } catch (expected: IllegalStateException) {
      // The body's own failure.
    }
    assertEquals(0L, count())
    db.execSQL("INSERT INTO t (name) VALUES ('after')")
    assertEquals(1L, count())
  }

  @Test
  fun anotherThreadWaitsForATransactionAndNeverSeesItsHalfWrittenRows() {
    val inside = CountDownLatch(1)
    val proceed = CountDownLatch(1)
    val writer = thread {
      db.beginTransaction()
      try {
        db.execSQL("INSERT INTO t (name) VALUES ('one')")
        inside.countDown()
        proceed.await(5, TimeUnit.SECONDS)
        db.execSQL("INSERT INTO t (name) VALUES ('two')")
        db.setTransactionSuccessful()
      } finally {
        db.endTransaction()
      }
    }
    assertTrue(inside.await(5, TimeUnit.SECONDS))
    val seen = AtomicReference<Long>()
    val reader = thread { seen.set(count()) }
    Thread.sleep(150)
    assertTrue("the reader must wait while the transaction is open", reader.isAlive)
    proceed.countDown()
    writer.join(5_000)
    reader.join(5_000)
    assertEquals(2L, seen.get())
  }

  @Test
  fun statementsInsertRowsAndReportWhatTheyChanged() {
    val insert = db.compileStatement("INSERT OR IGNORE INTO t (name, n) VALUES (?, ?)")
    insert.bindString(1, "a")
    insert.bindLong(2, 1)
    assertTrue(insert.executeInsert() > 0)
    insert.clearBindings()
    insert.bindString(1, "a")
    insert.bindNull(2)
    assertEquals(-1L, insert.executeInsert())
    insert.close()

    val update = db.compileStatement("UPDATE t SET n = ? WHERE name = ?")
    update.bindLong(1, 9)
    update.bindString(2, "a")
    assertEquals(1, update.executeUpdateDelete())
    update.clearBindings()
    update.bindLong(1, 9)
    update.bindString(2, "missing")
    assertEquals(0, update.executeUpdateDelete())
    update.close()
    assertEquals(9L, db.rawQuery("SELECT n FROM t", null).use { it.moveToFirst(); it.getLong(0) })
  }

  @Test
  fun userVersionReadsAndWrites() {
    assertEquals(0, db.version)
    db.version = 14
    assertEquals(14, db.version)
  }

  @Test
  fun aClosedDatabaseThrowsAndAStatementOpenAtCloseIsFinalizedExactlyOnce() {
    val open = db.compileStatement("SELECT 1")
    db.close()
    assertTrue(connection.closed)
    // The connection finalized it; closing the statement afterwards only releases it.
    open.close()
    val statement = connection.statements.last()
    assertEquals(1, statement.finalizations)
    assertTrue(statement.released)
    try {
      db.rawQuery("SELECT 1", null)
      fail("a closed database must throw")
    } catch (expected: SQLiteException) {
      // Closed: nothing reaches the connection any more.
    }
    db.close()
  }

  @Test
  fun closingWaitsForARunningTransaction() {
    val inside = CountDownLatch(1)
    val finish = CountDownLatch(1)
    val writer = thread {
      db.beginTransaction()
      try {
        db.execSQL("INSERT INTO t (name) VALUES ('done')")
        inside.countDown()
        finish.await(5, TimeUnit.SECONDS)
        db.setTransactionSuccessful()
      } finally {
        db.endTransaction()
      }
    }
    assertTrue(inside.await(5, TimeUnit.SECONDS))
    val closer = thread { db.close() }
    Thread.sleep(150)
    assertTrue("close must wait for the transaction", closer.isAlive)
    finish.countDown()
    writer.join(5_000)
    closer.join(5_000)
    assertTrue(connection.closed)
    // The transaction committed before the connection went away.
    val check = DriverManager.getConnection("jdbc:sqlite:${file.path}")
    check.use { c -> c.createStatement().use { s -> s.executeQuery("SELECT COUNT(*) FROM t").use { rs -> rs.next(); assertEquals(1L, rs.getLong(1)) } } }
  }
}
