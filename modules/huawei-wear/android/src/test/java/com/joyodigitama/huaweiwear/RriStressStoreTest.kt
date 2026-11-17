package com.joyodigitama.huaweiwear

import java.io.File
import java.sql.Connection
import java.sql.DriverManager
import org.json.JSONArray
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** [RriStressStore] and the dictionary cursor on the shipped schema (JRG-486: Band 11 Pro stress only in `rrisqi_data.bin`). */
class RriStressStoreTest {
  private val a = "AA:AA:AA:AA:AA:01"
  private val connection: Connection = DriverManager.getConnection("jdbc:sqlite::memory:")
  private val db = JdbcWatchDb(connection)

  init {
    val migrations = JSONArray(File("../schema/joyofit-db-migrations.json").readText())
    for (i in 0 until migrations.length()) {
      val statements = migrations.getJSONArray(i)
      for (j in 0 until statements.length()) connection.createStatement().use { it.execute(statements.getString(j)) }
    }
    db.exec("INSERT INTO device (address, name, is_primary) VALUES (?, ?, 1)", a, "Band")
  }

  @After
  fun close() = connection.close()

  private fun record(start: Long, score: Int, level: Int = 2) = RriRecord(start, start + 56, score, level, 0, 1, 0, 0, List(12) { 0f })

  private fun emotion(): List<List<Any?>> = db.query("SELECT ts, last_ts, value, values_json FROM health_metrics WHERE type = 'emotion' ORDER BY ts")

  @Test
  fun storesTheScoresOfAWatchWithoutItsOwnEmotionRows() {
    val written = RriStressStore.save(db, a, listOf(record(1_000, 32), record(2_000, 0), record(3_000, 26, 1), record(4_000, 101)))
    assertEquals(2, written)
    val rows = emotion()
    assertEquals(listOf(1_000L, 3_000L), rows.map { it[0] })
    assertEquals(1_056L, rows[0][1])
    assertEquals(32.0, rows[0][2])
    assertEquals("""{"source":"rrisqi","score":26,"level":1}""", rows[1][3])
    // Synced again: the same records replace their rows.
    assertEquals(2, RriStressStore.save(db, a, listOf(record(1_000, 32), record(3_000, 26, 1))))
    assertEquals(2, emotion().size)
  }

  @Test
  fun leavesAWatchThatReportsItsOwnEmotionAlone() {
    db.exec(WatchSql.UPSERT_HEALTH_METRIC, "emotion", 500L, 560L, 40.0, """{"stressScore":40}""", a)
    assertNull(RriStressStore.save(db, a, listOf(record(1_000, 32))))
    assertEquals(listOf(500L), emotion().map { it[0] })
  }

  @Test
  fun theStressFileRowsDoNotMoveTheDictionaryCursorAndGoWhenTheWatchReportsItsOwn() {
    RriStressStore.save(db, a, listOf(record(1_000, 32)))
    assertNull(db.query(WatchSql.SELECT_HEALTH_METRIC_CURSOR, "emotion", a).first()[0])
    assertEquals(0L, db.query(WatchSql.COUNT_OWN_EMOTION, a).first()[0])
    // What HealthMetricsStore.persist runs before the dictionary's own rows.
    db.exec(WatchSql.DELETE_RRI_EMOTION, a)
    db.exec(WatchSql.UPSERT_HEALTH_METRIC, "emotion", 900L, 960L, 30.0, """{"stressScore":30}""", a)
    assertEquals(listOf(900L), emotion().map { it[0] })
    assertEquals(960L, db.query(WatchSql.SELECT_HEALTH_METRIC_CURSOR, "emotion", a).first()[0])
  }
}
