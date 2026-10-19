package com.joyodigitama.huaweiwear

import android.database.Cursor

/**
 * The few database operations the multi-watch write rules need, so the flows built on them ([WorkoutWriter],
 * [NightHrvStore]) run unchanged against the app's database ([WearDatabase]) and against a plain JDBC SQLite in the JVM unit tests.
 * Query arguments are compared with columns only, never used in arithmetic (the Android side binds them as text).
 */
internal interface WatchDb {
  /** Every row of [sql] as column values: `Long`, `Double`, `String`, `ByteArray` or null. */
  fun query(sql: String, vararg args: Any?): List<List<Any?>>

  fun exec(sql: String, vararg args: Any?)

  /** Inserts [points] of the workout [workoutId] into `workout_points`. */
  fun insertPoints(workoutId: Long, points: List<WorkoutPoint>)

  /** Runs [block] in one transaction; an exception rolls it back. */
  fun <T> transaction(block: () -> T): T
}

/** [WatchDb] on the app's open database. */
internal class AndroidWatchDb(private val db: WearDatabase) : WatchDb {
  override fun query(sql: String, vararg args: Any?): List<List<Any?>> =
    db.rawQuery(sql, Array(args.size) { args[it]?.toString() }).use { cursor ->
      val rows = ArrayList<List<Any?>>(cursor.count)
      while (cursor.moveToNext()) rows.add(List(cursor.columnCount) { value(cursor, it) })
      rows
    }

  override fun exec(sql: String, vararg args: Any?) {
    if (args.isEmpty()) db.execSQL(sql) else db.execSQL(sql, arrayOf(*args))
  }

  override fun insertPoints(workoutId: Long, points: List<WorkoutPoint>) {
    val insert = db.compileStatement(WatchSql.INSERT_WORKOUT_POINT)
    try {
      for (p in points) {
        insert.clearBindings()
        insert.bindLong(1, workoutId)
        insert.bindLong(2, p.ts)
        p.lat?.let { insert.bindDouble(3, it) } ?: insert.bindNull(3)
        p.lon?.let { insert.bindDouble(4, it) } ?: insert.bindNull(4)
        p.alt?.let { insert.bindDouble(5, it) } ?: insert.bindNull(5)
        p.hr?.let { insert.bindLong(6, it.toLong()) } ?: insert.bindNull(6)
        p.speed?.let { insert.bindDouble(7, it) } ?: insert.bindNull(7)
        p.cadence?.let { insert.bindLong(8, it.toLong()) } ?: insert.bindNull(8)
        p.stride?.let { insert.bindDouble(9, it) } ?: insert.bindNull(9)
        p.power?.let { insert.bindLong(10, it.toLong()) } ?: insert.bindNull(10)
        insert.executeInsert()
      }
    } finally {
      insert.close()
    }
  }

  override fun <T> transaction(block: () -> T): T {
    db.beginTransaction()
    try {
      val result = block()
      db.setTransactionSuccessful()
      return result
    } finally {
      db.endTransaction()
    }
  }

  private fun value(cursor: WearCursor, column: Int): Any? = when (cursor.getType(column)) {
    Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(column)
    Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(column)
    Cursor.FIELD_TYPE_STRING -> cursor.getString(column)
    Cursor.FIELD_TYPE_BLOB -> cursor.getBlob(column)
    else -> null
  }
}
