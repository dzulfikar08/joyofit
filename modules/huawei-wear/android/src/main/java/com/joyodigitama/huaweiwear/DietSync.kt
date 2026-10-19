// Calorie intake on the watch. Layouts and rules as Huawei Health 17.0.8.300 behaves: meal list,
// placeholders, 42 cap, extra slots with ExpandCapability 215, recommended ranges, config ids
// 900300023 / 900300022, events 80030003 / 80030004 and the JSON shapes.
// UNVERIFIED on the Fit 4 Pro: nothing here was ever sent to a watch before JoyoFit.
package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.SharedPreferences
import android.database.sqlite.SQLiteException
import java.util.Calendar
import java.util.UUID
import kotlin.math.roundToInt
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** One meal as JS hands it over, or as the watch quick-logged it. [eatTime] is Unix seconds. */
internal data class DietMeal(
  val id: String,
  val eatTime: Long,
  val kcal: Double,
  /** 10 breakfast, 20 lunch, 30 dinner, 40 other; 11 / 21 / 31 extra slots (kept only with ExpandCapability 215). */
  val whichMeal: Int,
  val carbs: Double? = null,
  val protein: Double? = null,
  val fat: Double? = null,
  /** `app` (from JS) or `watch` (quick-logged on the watch). */
  val src: String = "app",
  /** False for a watch meal JS has not yet written to JoyoRogo; such meals survive the next [DietSync.setDay]. */
  val synced: Boolean = true,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("id", id).put("eatTime", eatTime).put("kcal", kcal).put("whichMeal", whichMeal)
    .put("src", src).put("synced", synced)
    .also { o ->
      carbs?.let { o.put("carbs", it) }
      protein?.let { o.put("protein", it) }
      fat?.let { o.put("fat", it) }
    }

  fun toJs(): Map<String, Any?> = mapOf(
    "id" to id, "eatTime" to eatTime, "kcal" to kcal, "whichMeal" to whichMeal,
    "carbs" to carbs, "protein" to protein, "fat" to fat, "src" to src, "synced" to synced,
  )

  companion object {
    fun fromJson(o: JSONObject) = DietMeal(
      id = o.optString("id").ifEmpty { UUID.randomUUID().toString() },
      eatTime = o.optLong("eatTime"),
      kcal = o.optDouble("kcal", 0.0),
      whichMeal = o.optInt("whichMeal", 40),
      carbs = if (o.has("carbs")) o.optDouble("carbs") else null,
      protein = if (o.has("protein")) o.optDouble("protein") else null,
      fat = if (o.has("fat")) o.optDouble("fat") else null,
      src = o.optString("src", "app"),
      synced = o.optBoolean("synced", true),
    )
  }
}

/** The day's goals: the diet config (`900300023`) plus the weight goal (`900300022`). */
internal data class DietGoals(
  val dailyKcal: Int,
  /** Planned daily kcal deficit (`caloricDeficitGoal`); 0 when maintaining. */
  val deficitKcal: Int = 0,
  val weightInitKg: Double? = null,
  val targetWeightKg: Double? = null,
  /** 0 maintain, 1 lose, 2 gain. */
  val weightManagerType: Int = 0,
  /** Daily active kcal goal (`activityCalGoal`); null uses the activity-ring calories goal. */
  val activityCalGoal: Int? = null,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("dailyKcal", dailyKcal).put("deficitKcal", deficitKcal).put("weightManagerType", weightManagerType)
    .also { o ->
      weightInitKg?.let { o.put("weightInitKg", it) }
      targetWeightKg?.let { o.put("targetWeightKg", it) }
      activityCalGoal?.let { o.put("activityCalGoal", it) }
    }

  fun toJs(): Map<String, Any?> = mapOf(
    "dailyKcal" to dailyKcal, "deficitKcal" to deficitKcal, "weightInitKg" to weightInitKg,
    "targetWeightKg" to targetWeightKg, "weightManagerType" to weightManagerType, "activityCalGoal" to activityCalGoal,
  )

  companion object {
    fun fromJson(o: JSONObject): DietGoals? {
      if (!o.has("dailyKcal")) return null
      return DietGoals(
        dailyKcal = o.optInt("dailyKcal"),
        deficitKcal = o.optInt("deficitKcal"),
        weightInitKg = if (o.has("weightInitKg")) o.optDouble("weightInitKg") else null,
        targetWeightKg = if (o.has("targetWeightKg")) o.optDouble("targetWeightKg") else null,
        weightManagerType = o.optInt("weightManagerType"),
        activityCalGoal = if (o.has("activityCalGoal")) o.optInt("activityCalGoal") else null,
      )
    }
  }
}

/** The latest stored day (`diet_day`). [date] is the local `YYYY-MM-DD`. */
internal data class DietDay(
  val date: String,
  val meals: List<DietMeal>,
  val goals: DietGoals?,
  val updatedAt: Long = 0,
  val pushedAt: Long? = null,
) {
  val intakeKcal: Double get() = meals.sumOf { it.kcal }
}

/** One element of the meals array the watch gets (JSON field order). */
internal class DietEntry(
  val eatTime: Long,
  val hasFood: Boolean,
  val kcal: Float,
  /** Null leaves `sugRange` out (Gson omits null), an empty array writes `[]` (what Huawei's `int[0]` does). */
  val sugRange: IntArray?,
  val whichMeal: Int,
)

/** Pure planning: ranges, the meal list, the config JSON. No I/O, so the byte examples can be tested. */
internal object DietPlanner {
  const val PHONE_PKG = "hw.unitedevice.weightMgr"
  const val WATCH_PKG = "hw.sport.dietcal"
  const val COMMON_PKG = "hw.unitedevice.common"

  const val DICT_DIET = 600002
  const val CONFIG_DIET = 900300023
  const val CONFIG_WEIGHT_GOAL = 900300022
  const val EVENT_DIET = 80030003
  const val EVENT_VIP = 80030004

  /** ExpandCapability: extra meal slots and the watch quick-log reply. */
  const val CAP_EXTRA_MEALS = 215

  /** `if (size > 42) return`: no more than this many entries go to the watch. */
  const val MAX_ENTRIES = 42

  /**
   * Table for region `it` (Huawei's default outside cn / de): key `<manager type>_<day has an extra meal of this group>_<meal>`.
   * The extra-slot ranges are (0, 0.05). There is no entry for 40; see [range].
   */
  private val RATIOS: Map<String, Pair<Float, Float>> = buildMap {
    fun put(type: Int, add: Int, meal: Int, lo: Float, hi: Float) = put("${type}_${add}_$meal", lo to hi)
    put(0, 0, 10, 0.2f, 0.26f); put(0, 0, 20, 0.4f, 0.47f); put(0, 0, 30, 0.3f, 0.35f)
    put(0, 1, 10, 0.15f, 0.21f); put(0, 1, 20, 0.35f, 0.42f); put(0, 1, 30, 0.25f, 0.3f)
    put(1, 0, 10, 0.25f, 0.32f); put(1, 0, 20, 0.4f, 0.47f); put(1, 0, 30, 0.25f, 0.3f)
    put(1, 1, 10, 0.2f, 0.27f); put(1, 1, 20, 0.35f, 0.42f); put(1, 1, 30, 0.2f, 0.25f)
    put(2, 0, 10, 0.25f, 0.3f); put(2, 0, 20, 0.4f, 0.5f); put(2, 0, 30, 0.28f, 0.35f)
    put(2, 1, 10, 0.2f, 0.25f); put(2, 1, 20, 0.35f, 0.45f); put(2, 1, 30, 0.23f, 0.3f)
    for (type in 0..2) for (meal in intArrayOf(11, 21, 31)) put(type, 1, meal, 0f, 0.05f)
  }

  /** The "snack" slot has no entry in Huawei's table (its range comes from a cloud config we do not have); 0 to 5 % of the day goal is our choice. */
  private val SNACK_RATIO = 0f to 0.05f

  fun isMealType(which: Int) = which == 10 || which == 11 || which == 20 || which == 21 || which == 30 || which == 31 || which == 40

  /** Without ExpandCapability 215 the extra slots are folded into 40. */
  fun fold(which: Int, extraSlots: Boolean): Int = if (!extraSlots && (which == 11 || which == 21 || which == 31)) 40 else which

  /** Does the day have an extra meal in the group of [meal]. */
  private fun hasExtra(extras: Set<Int>, meal: Int): Boolean = when (meal) {
    10, 11 -> 11 in extras
    20, 21 -> 21 in extras
    else -> 31 in extras
  }

  /** `[round(lo * goal), round(hi * goal)]`; empty when the goal is not positive. */
  fun range(goalKcal: Int, which: Int, managerType: Int, extras: Set<Int>): IntArray {
    if (goalKcal <= 0) return IntArray(0)
    val ratio = if (which == 40) SNACK_RATIO else RATIOS["${managerType}_${if (hasExtra(extras, which)) 1 else 0}_$which"] ?: return IntArray(0)
    val goal = goalKcal.toDouble()
    return intArrayOf(Math.round(ratio.first.toDouble() * goal).toInt(), Math.round(ratio.second.toDouble() * goal).toInt())
  }

  /** The meal array for one day: merged meals per type, the 40 sum, then placeholders for today. */
  fun entries(day: DietDay, extraSlots: Boolean, todayDate: String, todayStartSec: Long): List<DietEntry> {
    val goal = day.goals?.dailyKcal ?: 0
    val managerType = day.goals?.weightManagerType ?: 0
    val extras = day.meals.map { it.whichMeal }.filter { it == 11 || it == 21 || it == 31 }.toSet()

    // Meals of the same type are one entry (kcal summed, first time kept).
    val merged = LinkedHashMap<Int, Pair<Long, Double>>()
    for (meal in day.meals.sortedBy { it.whichMeal }) {
      val prior = merged[meal.whichMeal]
      merged[meal.whichMeal] = if (prior == null) meal.eatTime to meal.kcal else prior.first to prior.second + meal.kcal
    }

    val list = ArrayList<DietEntry>()
    var snackKcal = 0f
    var snackTime = 0L
    var snackMax = 0
    var snackSeen = false
    for ((original, value) in merged) {
      if (list.size >= MAX_ENTRIES) return list
      val (time, kcal) = value
      val own = range(goal, original, managerType, extras)
      val which = fold(original, extraSlots)
      if (which == 40) {
        snackKcal += kcal.toFloat()
        snackTime = time
        snackMax += own.getOrElse(1) { 0 }
        snackSeen = true
      } else {
        list += DietEntry(time, true, kcal.toFloat(), own.takeIf { it.size == 2 }, which)
      }
    }
    if (snackSeen) list += DietEntry(snackTime, true, snackKcal, intArrayOf(0, snackMax), 40)

    if (day.date == todayDate) {
      val present = list.map { it.whichMeal }.toSet()
      fun placeholder(which: Int) {
        if (list.size >= MAX_ENTRIES) return
        list += DietEntry(todayStartSec, false, 0f, range(goal, which, managerType, extras), which)
      }
      if (10 !in present) placeholder(10)
      if (20 !in present) placeholder(20)
      if (30 !in present) placeholder(30)
      if (40 !in present && !extraSlots) placeholder(40)
    }
    return list
  }

  /** `[{"eatTime":..,"hasFood":..,"kiloCalorie":..,"sugRange":[..],"whichMeal":..}]`, compact, as Gson writes it. */
  fun mealsJson(entries: List<DietEntry>): ByteArray = DataSyncJson.bytes(
    entries.map { e ->
      LinkedHashMap<String, Any?>().apply {
        put("eatTime", e.eatTime)
        put("hasFood", e.hasFood)
        put("kiloCalorie", e.kcal)
        e.sugRange?.let { put("sugRange", it) }
        put("whichMeal", e.whichMeal)
      }
    },
  )

  /** `{"dietaryAnalysis":{"coefficient":1,"carbohydrates":g,"protein":g,"fat":g}}` for the day's macros; null when none are known. */
  fun analysisJson(day: DietDay): ByteArray? {
    val withMacros = day.meals.filter { it.carbs != null || it.protein != null || it.fat != null }
    if (withMacros.isEmpty()) return null
    val inner = LinkedHashMap<String, Any?>()
    inner["coefficient"] = 1
    inner["carbohydrates"] = withMacros.sumOf { it.carbs ?: 0.0 }.toFloat()
    inner["protein"] = withMacros.sumOf { it.protein ?: 0.0 }.toFloat()
    inner["fat"] = withMacros.sumOf { it.fat ?: 0.0 }.toFloat()
    return DataSyncJson.bytes(mapOf("dietaryAnalysis" to inner))
  }

  /**
   * Config JSON in field order: onePointFull{dinner,lunch,breakfast}, caloricDeficitGoal, weightInit, activityCalGoal, fatLossRatio,
   * weightManagerType. `onePointFull` is `round((min + max) / 14)` of each meal's range; fatLossRatio is the default
   * Huawei Health fills in when the user has none; proportionMeal is null and so left out.
   */
  fun configJson(goals: DietGoals, activityCalGoal: Int, weightInitKg: Double?): ByteArray {
    fun onePoint(meal: Int): Int {
      val r = range(goals.dailyKcal, meal, goals.weightManagerType, emptySet())
      return if (r.size < 2) 0 else Math.round((r[0] + r[1]) / 14.0f)
    }
    val onePointFull = LinkedHashMap<String, Any?>()
    onePointFull["dinner"] = onePoint(30)
    onePointFull["lunch"] = onePoint(20)
    onePointFull["breakfast"] = onePoint(10)
    val fatLoss = LinkedHashMap<String, Any?>()
    fatLoss["maxRatio"] = 0f
    fatLoss["minRatio"] = 0f
    fatLoss["maxWeek"] = 0
    fatLoss["gear"] = 1
    val out = LinkedHashMap<String, Any?>()
    out["onePointFull"] = onePointFull
    out["caloricDeficitGoal"] = goals.deficitKcal
    out["weightInit"] = (weightInitKg ?: 0.0).toFloat()
    out["activityCalGoal"] = activityCalGoal
    out["fatLossRatio"] = fatLoss
    out["weightManagerType"] = goals.weightManagerType
    return DataSyncJson.bytes(out)
  }

  /** `{"weightGoal":<double>}`. */
  fun weightGoalJson(kg: Double): ByteArray = DataSyncJson.bytes(mapOf("weightGoal" to kg))

  /** The reply to a quick-logged meal. */
  fun punchReply(resultCode: Int, failTimeSec: Long): ByteArray {
    val out = LinkedHashMap<String, Any?>()
    out["punchResult"] = resultCode
    if (resultCode != 0) out["punchFailTime"] = failTimeSec
    out["event"] = 6
    return DataSyncJson.bytes(out)
  }

  /** Parses the watch's `{"meals":[...]}` (the array may also arrive as a string, as Huawei's `getString("meals")` allows). */
  fun parseQuickLog(json: JSONObject, nowSec: Long): List<DietMeal> {
    val raw = json.opt("meals")
    val array = when (raw) {
      is JSONArray -> raw
      is String -> try { JSONArray(raw) } catch (e: JSONException) { return emptyList() }
      else -> return emptyList()
    }
    val out = ArrayList<DietMeal>()
    for (i in 0 until array.length()) {
      val o = array.optJSONObject(i) ?: continue
      val which = o.optInt("whichMeal", 0)
      // whichMeal 0 is an error and skipped.
      if (which == 0) continue
      var time = o.optLong("eatTime", 0L)
      if (time >= 1_000_000_000_000L) time /= 1000
      if (time <= 0) time = nowSec
      out += DietMeal(
        id = "watch-$time-$which-$i",
        eatTime = time,
        kcal = o.optDouble("kiloCalorie", 0.0),
        whichMeal = which,
        src = "watch",
        synced = false,
      )
    }
    return out
  }
}

/** Reads and writes `diet_day`. */
internal class DietStore(private val store: SyncStore) {
  @Synchronized
  fun latest(): DietDay? = query("SELECT date, meals_json, goals_json, updated_at, pushed_at FROM diet_day ORDER BY date DESC LIMIT 1", emptyArray())

  @Synchronized
  fun day(date: String): DietDay? = query("SELECT date, meals_json, goals_json, updated_at, pushed_at FROM diet_day WHERE date = ?", arrayOf(date))

  /** The newest [limit] days. */
  @Synchronized
  fun recent(limit: Int): List<DietDay> {
    val dates = ArrayList<String>()
    try {
      store.db().rawQuery("SELECT date FROM diet_day ORDER BY date DESC LIMIT ?", arrayOf(limit.toString())).use { c ->
        while (c.moveToNext()) dates.add(c.getString(0).orEmpty())
      }
    } catch (e: SQLiteException) {
      throw WearException(ErrorCodes.STORAGE, "Could not read diet_day: ${e.message}", e)
    }
    val days = ArrayList<DietDay>()
    for (date in dates) day(date)?.let { days.add(it) }
    return days
  }

  private fun query(sql: String, args: Array<String>): DietDay? = try {
    store.db().rawQuery(sql, args).use { c ->
      if (!c.moveToFirst()) return null
      val meals = ArrayList<DietMeal>()
      val array = JSONArray(c.getString(1))
      for (i in 0 until array.length()) meals += DietMeal.fromJson(array.getJSONObject(i))
      DietDay(
        date = c.getString(0).orEmpty(),
        meals = meals,
        goals = JSONObject(c.getString(2)).let { DietGoals.fromJson(it) },
        updatedAt = c.getLong(3),
        pushedAt = if (c.isNull(4)) null else c.getLong(4),
      )
    }
  } catch (e: SQLiteException) {
    throw WearException(ErrorCodes.STORAGE, "Could not read diet_day: ${e.message}", e)
  } catch (e: JSONException) {
    throw WearException(ErrorCodes.STORAGE, "diet_day holds invalid JSON: ${e.message}", e)
  }

  @Synchronized
  fun put(day: DietDay) {
    val meals = JSONArray().also { a -> day.meals.forEach { a.put(it.toJson()) } }.toString()
    val goals = (day.goals?.toJson() ?: JSONObject()).toString()
    try {
      store.db().execSQL(
        "INSERT INTO diet_day (date, meals_json, goals_json, updated_at, pushed_at) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(date) DO UPDATE SET meals_json = excluded.meals_json, goals_json = excluded.goals_json, " +
          "updated_at = excluded.updated_at, pushed_at = excluded.pushed_at",
        arrayOf<Any?>(day.date, meals, goals, day.updatedAt, day.pushedAt),
      )
    } catch (e: SQLiteException) {
      throw WearException(ErrorCodes.STORAGE, "Could not store diet_day: ${e.message}", e)
    }
  }

  @Synchronized
  fun markPushed(date: String, atMs: Long) {
    try {
      store.db().execSQL("UPDATE diet_day SET pushed_at = ? WHERE date = ?", arrayOf<Any>(atMs, date))
    } catch (e: SQLiteException) {
      throw WearException(ErrorCodes.STORAGE, "Could not update diet_day: ${e.message}", e)
    }
  }
}

/**
 * Sends the day's meals and goals to the watch's calorie card and answers its requests. The data comes from JS
 * ([setDay]); the latest day lives in the database so the background service can answer with JS closed.
 */
internal class DietSync(
  context: Context,
  store: SyncStore,
  private val service: DataSyncService,
  private val events: WearEvents,
  private val settings: WearSettings,
  private val goals: ActivityGoals,
  private val body: BodyMetrics,
) : DataSyncFeature {
  private val days = DietStore(store)
  private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  override val name = "calorie intake"

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun error(message: String) = events.log(LogDirection.ERROR, null, null, null, message)

  // Local time

  private fun dateOf(ms: Long): String {
    val cal = Calendar.getInstance().also { it.timeInMillis = ms }
    return "%04d-%02d-%02d".format(cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH))
  }

  private fun startOfDaySec(ms: Long): Long {
    val cal = Calendar.getInstance().also { it.timeInMillis = ms }
    cal.set(Calendar.HOUR_OF_DAY, 0)
    cal.set(Calendar.MINUTE, 0)
    cal.set(Calendar.SECOND, 0)
    cal.set(Calendar.MILLISECOND, 0)
    return cal.timeInMillis / 1000
  }

  /**
   * The day to answer with: today's stored row, or (new day, app not opened yet) today with no meals and the latest goals,
   * so the watch shows today's empty slots instead of yesterday's meals. Null when nothing was ever stored.
   */
  fun currentDay(nowMs: Long = System.currentTimeMillis()): DietDay? {
    val today = dateOf(nowMs)
    days.day(today)?.let { return it }
    val latest = days.latest() ?: return null
    return DietDay(today, emptyList(), latest.goals, latest.updatedAt, null)
  }

  /** The kcal eaten on [date] (`YYYY-MM-DD`), null when no row exists. For other native features (Healthy Living). */
  fun intakeKcal(date: String): Double? = days.day(date)?.intakeKcal

  // JS API

  /**
   * Stores the day (JoyoRogo is the source of truth, but a watch meal JS has not yet confirmed is kept) and pushes it to a
   * connected watch. Returns true when it reached the watch.
   */
  suspend fun setDay(date: String, meals: List<DietMeal>, newGoals: DietGoals?): Boolean {
    if (!Regex("\\d{4}-\\d{2}-\\d{2}").matches(date)) throw WearException(ErrorCodes.INVALID_ARGUMENT, "date must be YYYY-MM-DD, got '$date'")
    for (meal in meals) {
      if (!DietPlanner.isMealType(meal.whichMeal)) throw WearException(ErrorCodes.INVALID_ARGUMENT, "whichMeal must be 10, 11, 20, 21, 30, 31 or 40, got ${meal.whichMeal}")
      if (meal.kcal < 0 || meal.kcal > 20_000) throw WearException(ErrorCodes.INVALID_ARGUMENT, "kcal out of range: ${meal.kcal}")
    }
    if (newGoals != null && newGoals.dailyKcal !in 0..20_000) throw WearException(ErrorCodes.INVALID_ARGUMENT, "dailyKcal out of range: ${newGoals.dailyKcal}")
    val existing = days.day(date)
    val keptWatchMeals = existing?.meals.orEmpty().filter { it.src == "watch" && !it.synced && meals.none { m -> m.id == it.id } }
    val goalsToStore = newGoals ?: existing?.goals ?: days.latest()?.goals
    val now = System.currentTimeMillis()
    days.put(DietDay(date, meals + keptWatchMeals, goalsToStore, now, existing?.pushedAt))
    log("Diet: stored $date meals=${meals.size}+${keptWatchMeals.size} watch-only, intake=${(meals + keptWatchMeals).sumOf { it.kcal }.roundToInt()} kcal, goal=${goalsToStore?.dailyKcal ?: "none"}")
    return push("set", withConfig = true)
  }

  /** JS wrote the watch-logged meals to JoyoRogo: stop keeping them separately. */
  fun markWatchMealsSynced(ids: List<String>) {
    for (day in days.recent(RECENT_DAYS)) {
      if (day.meals.none { it.id in ids }) continue
      days.put(day.copy(meals = day.meals.map { if (it.id in ids) it.copy(synced = true) else it }, updatedAt = System.currentTimeMillis()))
    }
  }

  /** Watch quick-logged meals (recent days) that JS has not yet confirmed written to JoyoRogo. */
  fun pendingWatchMeals(): List<DietMeal> = days.recent(RECENT_DAYS).flatMap { day -> day.meals.filter { it.src == "watch" && !it.synced } }

  fun status(): Map<String, Any?> {
    val day = try {
      currentDay()
    } catch (e: WearException) {
      null
    }
    val pending = try {
      pendingWatchMeals()
    } catch (e: WearException) {
      emptyList()
    }
    val connected = service.connected()
    return mapOf(
      "date" to day?.date,
      "mealCount" to day?.meals?.size,
      "intakeKcal" to day?.intakeKcal,
      "goals" to day?.goals?.toJs(),
      "updatedAt" to day?.updatedAt?.takeIf { it > 0 },
      "pushedAt" to (prefs.getLong(KEY_PUSHED_AT, 0L).takeIf { it > 0 }),
      "lastResult" to prefs.getString(KEY_LAST_RESULT, null),
      "unsyncedWatchMeals" to pending.size,
      "pendingWatchMeals" to pending.map { it.toJs() },
      "supported" to if (connected) mapOf(
        "config" to service.supports(DataSyncWire.CAP_CONFIG),
        "event" to service.supports(DataSyncWire.CAP_EVENT),
        "point" to service.supports(DataSyncWire.CAP_POINT),
        "dictionary" to service.supports(DataSyncWire.CAP_DICT),
        "extraMealSlots" to service.supports(DietPlanner.CAP_EXTRA_MEALS),
      ) else null,
    )
  }

  // Sending

  private fun record(result: String) {
    prefs.edit().putString(KEY_LAST_RESULT, result).apply()
  }

  /** Config(s) then the day's point. [withConfig] false sends only the point (a watch request). */
  suspend fun push(reason: String, withConfig: Boolean, window: Pair<Long, Long>? = null): Boolean {
    val now = System.currentTimeMillis()
    val day = currentDay(now)
    if (day == null) {
      log("Diet: nothing to push ($reason): no day stored yet")
      record("nothing stored")
      return false
    }
    if (!service.connected()) {
      log("Diet: not pushed ($reason): no connected watch; it is sent at the next connect")
      record("watch not connected")
      return false
    }
    var ok = true
    if (withConfig) ok = sendConfigs(day, now) && ok
    ok = sendPoint(day, now, window, reason) && ok
    if (ok) {
      prefs.edit().putLong(KEY_PUSHED_AT, now).apply()
      if (days.day(day.date) != null) days.markPushed(day.date, now)
    }
    record(if (ok) "sent ($reason)" else "failed ($reason), see the log")
    return ok
  }

  private suspend fun sendConfigs(day: DietDay, now: Long): Boolean {
    val goalsOfDay = day.goals
    if (goalsOfDay == null) {
      log("Diet: no goals stored, config ${DietPlanner.CONFIG_DIET} not sent")
      return true
    }
    val activityCal = goalsOfDay.activityCalGoal ?: goals.goals.calories
    val weightInit = goalsOfDay.weightInitKg ?: settings.profile?.weightKg
    val items = ArrayList<ConfigItem>()
    items += ConfigItem(DietPlanner.CONFIG_DIET, 1, DietPlanner.configJson(goalsOfDay, activityCal, weightInit), now)
    // The weight goal is its own config.
    goalsOfDay.targetWeightKg?.let { items += ConfigItem(DietPlanner.CONFIG_WEIGHT_GOAL, 1, DietPlanner.weightGoalJson(it), now) }
    var ok = true
    for (item in items) {
      log("Diet: config ${item.configId} = ${DataSyncService.describe(item.data)}")
      ok = service.sendConfig(DietPlanner.PHONE_PKG, DietPlanner.WATCH_PKG, item.configId, item.data, item.action, item.modifyMs, what = "diet config ${item.configId}") && ok
    }
    return ok
  }

  private suspend fun sendPoint(day: DietDay, now: Long, window: Pair<Long, Long>?, reason: String): Boolean {
    val extra = service.supports(DietPlanner.CAP_EXTRA_MEALS)
    log("Diet: ExpandCapability ${DietPlanner.CAP_EXTRA_MEALS} (extra meal slots 11/21/31) is ${if (extra) "set" else "NOT set: they fold into 40"}")
    val entries = DietPlanner.entries(day, extra, dateOf(now), startOfDaySec(now))
    val json = DietPlanner.mealsJson(entries)
    log("Diet: meals ($reason, ${entries.size} entries) = ${String(json, Charsets.UTF_8)}")
    val start = window?.first ?: (startOfDaySec(now) * 1000)
    val end = window?.second ?: now
    return service.sendSamplePoint(
      DietPlanner.PHONE_PKG,
      DietPlanner.WATCH_PKG,
      DietPlanner.DICT_DIET,
      listOf(PointValue(DietPlanner.DICT_DIET, json)),
      startMs = start,
      endMs = end,
      metadata = if (day.date == dateOf(now)) DietPlanner.analysisJson(day) else null,
      what = "diet meals",
    )
  }

  // Watch requests

  override fun register(service: DataSyncService) {
    service.onEvent(DietPlanner.PHONE_PKG, null, DietPlanner.EVENT_DIET) { onDietEvent(it) }
    service.onEvent(DietPlanner.COMMON_PKG, null, DietPlanner.EVENT_VIP) { onVipEvent(it) }
  }

  override suspend fun onConnected() {
    push("connected", withConfig = true)
  }

  /** For 80030003: `{startTime, endTime, event}`. */
  private suspend fun onDietEvent(event: SampleEvent) {
    val json = event.json()
    if (json == null) {
      log("Diet: watch event ${event.eventId} without a JSON body, ignored")
      return
    }
    val phone = event.phonePkg.ifEmpty { DietPlanner.PHONE_PKG }
    val watch = event.watchPkg.ifEmpty { DietPlanner.WATCH_PKG }
    when (val kind = json.optInt("event", -1)) {
      1 -> {
        // The day's meals for the clamped start / end. We hold one day, so the window only becomes start / end of the point.
        val startMs = json.optLong("startTime", 0L)
        val endMs = json.optLong("endTime", 0L)
        val clamped = if (startMs > 0) startOfDaySec(startMs) * 1000 else 0L
        log("Diet: the watch asks for its meals (event 1, window $startMs..$endMs)")
        push("watch request", withConfig = false, window = if (endMs > 0) clamped to endMs else null)
      }
      5 -> {
        log("Diet: the watch asks for the latest weight (event 5)")
        body.sendWeight(phone, watch, "watch request")
      }
      6 -> onQuickLog(event, json, phone, watch)
      else -> log("Diet: watch event ${event.eventId} kind $kind (week report 4 and others) is not answered")
    }
  }

  private suspend fun onQuickLog(event: SampleEvent, json: JSONObject, phone: String, watch: String) {
    val now = System.currentTimeMillis()
    val meals = DietPlanner.parseQuickLog(json, now / 1000)
    log("Diet: the watch quick-logged ${meals.size} meal(s): ${meals.joinToString { "${it.whichMeal}@${it.eatTime}=${it.kcal} kcal" }}")
    var result = 0
    var failTime = meals.firstOrNull()?.eatTime ?: json.optLong("startTime", 0L)
    try {
      if (meals.isNotEmpty()) {
        val byDate = meals.groupBy { dateOf(it.eatTime * 1000) }
        for ((date, added) in byDate) {
          val existing = days.day(date)
          val base = existing ?: DietDay(date, emptyList(), days.latest()?.goals)
          days.put(base.copy(meals = base.meals + added, updatedAt = now))
        }
        events.watchMealLogged(
          mapOf(
            "date" to dateOf(meals.first().eatTime * 1000),
            "meals" to meals.map { it.toJs() },
          ),
        )
      }
    } catch (e: WearException) {
      error("Diet: could not store the watch's meals: ${e.message}")
      result = 102
      failTime = meals.firstOrNull()?.eatTime ?: 0L
    }
    // The reply needs ExpandCapability 215.
    val extra = service.supports(DietPlanner.CAP_EXTRA_MEALS)
    if (extra) {
      service.sendEvent(phone, watch, DietPlanner.EVENT_DIET, DietPlanner.punchReply(result, failTime), what = "diet quick-log reply")
    } else {
      log("Diet: ExpandCapability ${DietPlanner.CAP_EXTRA_MEALS} not set, no quick-log reply sent (as Huawei Health)")
    }
    if (result == 0 && meals.isNotEmpty()) push("watch quick-log", withConfig = false)
  }

  /** For 80030004: only a request byte of 1 is answered, here always with "not VIP" (0). */
  private suspend fun onVipEvent(event: SampleEvent) {
    val asked = DataSyncBytes.readInt32(event.data)
    if (asked != 1) {
      log("Diet: VIP flag event with request ${asked ?: "none"}, not answered (Huawei answers only 1)")
      return
    }
    service.sendEvent(
      event.phonePkg.ifEmpty { DietPlanner.COMMON_PKG },
      event.watchPkg.ifEmpty { DietPlanner.WATCH_PKG },
      DietPlanner.EVENT_VIP,
      byteArrayOf(0),
      what = "vip flag",
    )
  }

  private companion object {
    const val PREFS_NAME = "joyofit_diet"
    /** How far back watch meals awaiting JoyoRogo are looked for. */
    const val RECENT_DAYS = 7
    const val KEY_PUSHED_AT = "pushed_at"
    const val KEY_LAST_RESULT = "last_result"
  }
}
