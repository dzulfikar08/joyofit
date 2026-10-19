package com.joyodigitama.huaweiwear

/**
 * What [WearDatabase] needs from a SQLite connection. The app's is [ExpoSqlConnection] (the SQLite library of expo-sqlite); the
 * JVM unit tests use sqlite-jdbc, which is how the transaction and locking rules of [WearDatabase] are tested without a phone.
 * Failures are `android.database.sqlite.SQLiteException`.
 */
internal interface SqlConnection {
  /** Runs one or more statements without parameters or results. */
  fun exec(sql: String)

  fun prepare(sql: String): SqlStatement

  /** Rows changed by the most recently completed INSERT, UPDATE or DELETE. */
  fun changes(): Int

  fun lastInsertRowId(): Long

  /** Closes the connection; the statements still open are finalized with it. */
  fun close()
}

internal interface SqlStatement {
  /** Binds null, Long, Int, Double, String or ByteArray to the 1-based [index]. */
  fun bind(index: Int, value: Any?)

  fun clearBindings()

  fun reset()

  /** True while the statement produced a row, false at the end of the result. */
  fun step(): Boolean

  fun columnCount(): Int

  /** The current row: Long, Double, String, a blob (ByteBuffer or ByteArray) or null for each column. */
  fun row(): List<Any?>

  /** Finalizes the statement. */
  fun close()

  /** Frees a statement that [SqlConnection.close] finalized already; finalizing twice is a use after free. */
  fun release()
}

/** [SqlConnection] over [ExpoSqliteConnection]. */
internal class ExpoSqlConnection private constructor(private val connection: ExpoSqliteConnection) : SqlConnection {
  override fun exec(sql: String) = connection.exec(sql)

  override fun prepare(sql: String): SqlStatement = ExpoSqlStatement(connection.prepare(sql))

  override fun changes(): Int = connection.changes()

  override fun lastInsertRowId(): Long = connection.lastInsertRowId()

  override fun close() = connection.close()

  companion object {
    /** Opens (creating when missing) the database file at [path]. */
    fun open(path: String): ExpoSqlConnection {
      val connection = ExpoSqliteConnection()
      connection.open(path)
      return ExpoSqlConnection(connection)
    }
  }
}

private class ExpoSqlStatement(private val statement: ExpoSqliteConnection.Statement) : SqlStatement {
  override fun bind(index: Int, value: Any?) = statement.bind(index, value)

  override fun clearBindings() = statement.clearBindings()

  override fun reset() = statement.reset()

  override fun step(): Boolean = statement.step()

  override fun columnCount(): Int = statement.columnCount()

  override fun row(): List<Any?> = statement.row()

  override fun close() = statement.close()

  override fun release() = statement.release()
}
