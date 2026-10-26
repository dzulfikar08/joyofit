package com.joyodigitama.blesensors

/**
 * The pure part of [WorkoutSteps]: the phone's two step sensors made one count of the steps since the start, with the time of its
 * newest step.
 *
 * - `TYPE_STEP_COUNTER` (steps since boot) is the count that is kept: its first reading is the baseline, and a counter that goes
 *   backwards (the phone rebooted, the sensor was reset) restarts the baseline and keeps what was counted. Phones report it late
 *   (Android allows 10 s, some hold it back far longer), stamped with the time of its newest step.
 * - `TYPE_STEP_DETECTOR` (one event per step, within about 2 s) moves the count on between two counter events: its steps after the
 *   counter's newest one are added to the counter's count, and the next counter event covers them.
 *
 * What is delivered never goes down, its time never goes back nor before [startedWallMs] (the counter's first event carries the time of
 * the last step before the start, possibly minutes old). Where the detector found a step more than the counter, the following steps
 * wait until the counter has caught up. One instance per run; not thread safe, both sensors deliver on one thread.
 */
internal class StepCounterLogic(private val startedWallMs: Long) {
  /** What to deliver: [steps] since the start, [tsMs] the wall-clock time of the newest of them. */
  data class Reading(val steps: Long, val tsMs: Long)

  private var lastRaw: Long? = null
  private var counted = 0L
  private var counterTsMs = Long.MIN_VALUE
  /** Wall-clock times of the detector's steps after the counter's newest one, oldest first. */
  private val pending = ArrayDeque<Long>()
  private var delivered: Reading? = null

  /** A counter event: [raw] steps since boot, stamped [tsMs] (wall clock). The reading to deliver, or null when it adds no step. */
  fun counter(raw: Float, tsMs: Long): Reading? {
    val value = raw.toLong()
    val last = lastRaw
    lastRaw = value
    if (last != null) counted += if (value < last) value else value - last
    if (tsMs > counterTsMs) counterTsMs = tsMs
    while (pending.isNotEmpty() && pending.first() <= counterTsMs) pending.removeFirst()
    return deliver(counted + pending.size, maxOf(counterTsMs, pending.lastOrNull() ?: Long.MIN_VALUE))
  }

  /** A detector event: one step at [tsMs] (wall clock). Null when the counter already covers it or the count waits for the counter. */
  fun detector(tsMs: Long): Reading? {
    if (tsMs <= counterTsMs) return null
    pending.addLast(tsMs)
    return deliver(counted + pending.size, tsMs)
  }

  private fun deliver(steps: Long, tsMs: Long): Reading? {
    val before = delivered
    if (before != null && steps <= before.steps) return null
    return Reading(steps, maxOf(tsMs, startedWallMs, before?.tsMs ?: Long.MIN_VALUE)).also { delivered = it }
  }

  companion object {
    /** Wall-clock epoch ms of a sensor event stamped [eventNanos] on the elapsed-realtime clock, seen when the clocks read [nowWallMs] and [nowElapsedNanos]. */
    fun eventWallMs(eventNanos: Long, nowWallMs: Long, nowElapsedNanos: Long): Long =
      nowWallMs - (nowElapsedNanos - eventNanos) / 1_000_000L
  }
}
