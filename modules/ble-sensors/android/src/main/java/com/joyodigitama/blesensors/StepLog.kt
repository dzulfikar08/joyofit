package com.joyodigitama.blesensors

import java.util.Locale

/**
 * The device-log lines of a step counter run ([WorkoutSteps], logcat tag `JoyoFit` like the watch link's): what the phone's sensors
 * really deliver, so the log of a walk shows whether steps arrive one by one, in bursts, or late. Pure: every time is passed in
 * (wall-clock ms); not thread safe, the sensors and the summary timer share one thread.
 */
internal class StepLog(private val label: String, private val startedMs: Long) {
  private var periodStartMs = startedMs
  private var lastArrivalMs = startedMs
  private var stepsAtPeriodStart = 0L
  private var counterEvents = 0
  private var detectorEvents = 0
  private var longestGapMs = 0L
  private var maxDelayMs: Long? = null
  private var allCounterEvents = 0
  private var allDetectorEvents = 0

  fun started(counter: String, detector: String?): String =
    "Phone steps ($label): started; counter $counter, detector ${detector ?: "none"}; fastest rate, no batching asked"

  /**
   * An event of the counter or (with [detector]) of the detector, arriving at [nowMs] and stamped [eventMs]. Returns the line of the
   * first event of each sensor, else null. The counter's first event carries the time of the last step before the start, so its age
   * stays out of the delays.
   */
  fun event(detector: Boolean, nowMs: Long, eventMs: Long, raw: Float?): String? {
    longestGapMs = maxOf(longestGapMs, nowMs - lastArrivalMs)
    lastArrivalMs = nowMs
    val first = if (detector) allDetectorEvents == 0 else allCounterEvents == 0
    if (detector) {
      detectorEvents += 1
      allDetectorEvents += 1
    } else {
      counterEvents += 1
      allCounterEvents += 1
    }
    val delay = nowMs - eventMs
    if (detector || !first) maxDelayMs = maxOf(maxDelayMs ?: delay, delay)
    if (!first) return null
    val sensor = if (detector) "detector" else "counter"
    val value = raw?.let { ", raw ${it.toLong()}" } ?: ""
    return "Phone steps ($label): first $sensor event ${seconds(nowMs - startedMs)} after the start$value, " +
      "stamped ${seconds(delay)} before it arrived"
  }

  /** The line of the period since the last one, at [nowMs] with [steps] delivered so far; starts the next period. */
  fun summary(nowMs: Long, steps: Long): String {
    val gap = maxOf(longestGapMs, nowMs - lastArrivalMs)
    val line = "Phone steps ($label): ${seconds(nowMs - periodStartMs)}: counter $counterEvents events, detector $detectorEvents events, " +
      "+${steps - stepsAtPeriodStart} steps (total $steps), longest gap ${seconds(gap)}, max delay ${maxDelayMs?.let(::seconds) ?: "-"}"
    periodStartMs = nowMs
    stepsAtPeriodStart = steps
    counterEvents = 0
    detectorEvents = 0
    longestGapMs = 0L
    maxDelayMs = null
    return line
  }

  fun stopped(nowMs: Long, steps: Long): String =
    "Phone steps ($label): stopped after ${seconds(nowMs - startedMs)}: total $steps steps, counter $allCounterEvents events, " +
      "detector $allDetectorEvents events"
}

private fun seconds(ms: Long): String = String.format(Locale.ROOT, "%.1f s", ms / 1000.0)
