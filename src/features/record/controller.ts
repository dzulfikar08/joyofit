/**
 * Runs one phone-recorded workout: owns the `Recorder`, wires it to the sensor hub and the native workout session (GPS, foreground
 * service), writes the crash journal and saves the result. Framework-free (no React, no Expo imports) so the whole flow runs under bun
 * test with fakes; `state/RecorderProvider.tsx` is the thin React shell around it.
 *
 * Phases: `idle` -> `prepare` -> `ready` (sensors connecting, GPS warming up, nothing recorded) -> `start` -> `active` (the Recorder runs,
 * paused or not) -> `finish` (saves) or `discard` -> `idle`. `cancel` leaves `ready` without a workout. After the app was killed
 * mid-workout `restore` brings the `active` phase back, paused.
 *
 * GPS warm-up: while the picker is open (phase `idle`) the screen calls `warmUp` for an outdoor sport, which starts the native session
 * with GPS at once, so the first fix is already on its way when the person taps "Mulai"; `prepare` then takes the running session over
 * instead of starting one. `stopWarmUp` (leaving the picker, another sport, the app going to the background) ends it again.
 */
import type { LocationEvent, StepCounterPermission, StepsEvent, ValueEvent, WorkoutAction, WorkoutSessionOptions, WorkoutSessionState } from '../../../modules/ble-sensors/src/BleSensors.types';
import type { ManualSport } from '../workouts/manual';
import type { SavedSensor } from '../sensors/store';
import type { WorkoutSensor } from '../sensors/store';
import { cscModeOf, hexToBytes, parseCsc, type SensorKind } from '../sensors/gatt';
import type { LinkInfo } from '../sensors/hub';
import { appendJournal, clearJournal, loadJournal, saveJournalState } from './journal';
import { bandHeartRateHex, type BandLink } from './bandLinkCore';
import { Recorder, FOOT_SPORTS, MAX_FIX_ACCURACY_M, type LiveStats, type RecordedLap, type RecordedWorkout, type RecorderMeta, type RecorderStatus } from './recorder';
import type { EnergyProfile } from './energy';
import { saveRecordedWorkout, type SaveDb } from './save';
import type { VirtualRide } from '../workouts/summary';
import type { SQLiteDatabase } from 'expo-sqlite';

export type RecordingPhase = 'idle' | 'ready' | 'active' | 'saving';

/** Outdoor sports record the phone's GPS; the others do not. */
export const GPS_SPORTS: readonly ManualSport[] = ['run', 'walk', 'ride', 'hike'];

/** Longer than this without a fix (ms) and the signal was lost: the stretch of good fixes starts over. */
const FIX_GAP_MS = 10_000;

export interface RecordingSnapshot {
  phase: RecordingPhase;
  sport: ManualSport | null;
  /** The phone's GPS is part of this recording. */
  gps: boolean;
  /** Phase `idle` only: the GPS warm-up runs (see `warmUp`) and `fix` is its latest fix. */
  warm: boolean;
  status: RecorderStatus;
  /** Null until `start`. Refreshed every second while active. */
  live: LiveStats | null;
  laps: RecordedLap[];
  /** Ids of the sensors this recording asked the radio to connect. */
  sensorIds: string[];
  /**
   * Latest GPS fix, also before `start`, so the screen can say "GPS ready". `usableSec` is how long the fixes have been good enough
   * for the recorder in a row (null while the newest one is not).
   */
  fix: { accuracyM: number | null; ageSec: number; usableSec: number | null } | null;
  /** Where the latest fix is (with the direction of travel when the platform has one), for the map on the setup and ready screens. Null before the first fix. */
  position: { lat: number; lon: number; headingDeg: number | null } | null;
  /** The foreground service was refused (Android): the workout runs, but may stop with the screen off. */
  noService: boolean;
  /** Error code of the last failed sensor connect (ERR_BLUETOOTH_OFF, ...), null while fine. */
  sensorError: string | null;
  /** The phone's step counter is on for this recording (a foot sport with the permission): cadence and steps come from it when no running pod reports. */
  phoneSteps: boolean;
}

/** What an observer of the running recording gets each second. */
export interface ControllerTick {
  recorder: Recorder;
  now: number;
}

export interface FinishResult {
  workoutId: number;
}

export interface SessionApi {
  start(options: WorkoutSessionOptions): Promise<void>;
  /** The recorder's numbers for the notification (Android); it counts the time itself between two reports. */
  update(state: WorkoutSessionState): Promise<void>;
  end(): Promise<void>;
  /** The notification's Pause/Resume/Lap buttons (Android). Returns the unsubscribe. */
  onAction(listener: (action: WorkoutAction) => void): () => void;
}

export interface HubApi {
  onValue(listener: (e: ValueEvent) => void): () => void;
  onLocation(listener: (e: LocationEvent) => void): () => void;
  /** Readings of the phone's step counter (only while the native session runs with `steps`). */
  onSteps(listener: (e: StepsEvent) => void): () => void;
  /** Connects the sensor and keeps it connected; a link that is down and waiting out its retry delay is restarted at once. */
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  /** The state of every link the radio knows, by sensor id. */
  links(): Readonly<Record<string, Pick<LinkInfo, 'state' | 'error' | 'lastFailure'>>>;
}

export type RecordingDb = SaveDb & Pick<SQLiteDatabase, 'runAsync' | 'getFirstAsync' | 'getAllAsync'>;

export interface RecordingDeps {
  hub: HubApi;
  session: SessionApi;
  /** Whether the phone's step counter may be used right now, without asking. Never blocks a recording. */
  stepCounter: () => Promise<StepCounterPermission>;
  db: RecordingDb;
  now: () => number;
  profile: () => EnergyProfile;
  wheelCircumferenceM: () => number;
  /** The paired sensors right now (names for the workout's sensor list, `autoConnect`). */
  sensors: () => readonly SavedSensor[];
  log?: (message: string) => void;
  /** The band beside the recording (`bandLink.ts`): started, paused and stopped with it, its heart rate read. Absent: no band logic at all. */
  band?: Pick<BandLink, 'begin' | 'adopt' | 'setPaused' | 'poll' | 'end'>;
}

/** What the recording took from one sensor: how many values, which CSC parts they carried. */
interface SensorTake {
  frames: number;
  wheel: boolean;
  crank: boolean;
}

/** What the journal remembers of the controller besides the recorder. */
interface JournalMeta {
  recorder: RecorderMeta;
  sensorIds: string[];
  used: string[];
  title: string;
  /** Absent in a journal written before the takes were kept. */
  takes?: Record<string, SensorTake>;
}

const JOURNAL_EVERY_S = 10;
/** The notification counts the time itself, so this only corrects its distance and heart rate. */
const NOTIFICATION_EVERY_S = 15;
/** A strap that gave a heart rate this recently is the recording's source; the band's readings wait. */
const STRAP_PREFERRED_MS = 5000;
/** A sensor of the recording seen down is connected again after this long, then after twice that, and so on up to the maximum. */
const SENSOR_RETRY_FIRST_MS = 3000;
const SENSOR_RETRY_MAX_MS = 30_000;

const codeOf = (error: unknown): string => String((error as { code?: unknown } | null)?.code ?? '');

export class RecordingController {
  private snap: RecordingSnapshot = idleSnapshot();
  private readonly listeners = new Set<() => void>();
  private recorder: Recorder | null = null;
  private title = '';
  private used = new Set<string>();
  private connected: string[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticks = 0;
  private lastFix: LocationEvent | null = null;
  /** A finished recording whose save failed: kept so the retry does not need the (already closed) recorder. */
  private pending: RecordedWorkout | null = null;
  private off: (() => void)[] = [];
  /** Journal writes run one after the other, never two statements at once. */
  private io: Promise<unknown> = Promise.resolve();
  /** Called once a second while a recording is active (also paused), after the recorder took its samples. */
  private readonly observers = new Set<(tick: ControllerTick) => void>();
  /** What the picker asks for: the outdoor sport to warm the GPS up for, or null for no warm-up. */
  private wantWarm: { sport: ManualSport; title: string } | null = null;
  /** The sport of the running warm-up session, null while there is none. */
  private warmSport: ManualSport | null = null;
  /** The native session that runs counts steps with the phone's step counter. */
  private sessionSteps = false;
  private warmNoService = false;
  /** `prepare` is under way: the warm-up is its to take over, `stopWarmUp` leaves it alone. */
  private preparing = false;
  /** Warm-up starts and stops run one after the other, never two native calls at once. */
  private warmIo: Promise<void> = Promise.resolve();
  /** Since when (ms) the fixes have been good enough for the recorder without a break, null while they are not. */
  private usableSince: number | null = null;
  private lastFixAt: number | null = null;
  /** Values taken from each sensor since "Mulai" (the recorder only listens while the recording is active), for the workout's sensor list. */
  private takes = new Map<string, SensorTake>();
  /** The sensors whose first value of a characteristic was written to the log, so the log shows the frames once, not every second. */
  private loggedFirst = new Set<string>();
  /** Per wanted sensor that is down: when its link is restarted next and how many restarts it took so far. */
  private readonly retries = new Map<string, { nextAt: number; attempts: number }>();
  /** The link state last written to the log, per wanted sensor, so only changes are logged. */
  private readonly loggedState = new Map<string, string>();
  /** When (ms) a paired strap last gave the recording a heart rate: the band's own readings only fill the gaps a strap leaves. */
  private lastStrapHrAt: number | null = null;

  constructor(private readonly deps: RecordingDeps) {}

  /** Bike mode and other add-ons watch the recording here; the listener must not throw and returns nothing. */
  observe = (listener: (tick: ControllerTick) => void): (() => void) => {
    this.observers.add(listener);
    return () => this.observers.delete(listener);
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RecordingSnapshot => this.snap;

  private publish(patch: Partial<RecordingSnapshot> = {}): void {
    const now = this.deps.now();
    const fix = this.lastFix
      ? {
          accuracyM: this.lastFix.accuracy,
          ageSec: Math.max(0, Math.floor((now - this.lastFix.ts) / 1000)),
          usableSec: this.usableSince === null ? null : Math.max(0, Math.floor((now - this.usableSince) / 1000)),
        }
      : null;
    const position = this.lastFix ? { lat: this.lastFix.lat, lon: this.lastFix.lon, headingDeg: this.lastFix.bearing } : null;
    const recorder = this.recorder;
    this.snap = {
      ...this.snap,
      status: recorder?.status ?? 'idle',
      live: recorder && recorder.status !== 'idle' ? recorder.live(now) : null,
      laps: recorder ? [...recorder.meta().laps] : [],
      fix,
      position,
      ...patch,
    };
    for (const l of this.listeners) l();
  }

  // -------------------------------------------------------------------------------------------------------------------
  // lifecycle

  /**
   * Gets ready: starts the native session (GPS for outdoor sports, the foreground service), or takes over the one `warmUp` started and
   * keeps its fix, and connects the paired sensors that are set to auto-connect. Rejects with ERR_LOCATION_PERMISSION when an outdoor
   * sport has no precise location; ask first (`ensureLocation`). Does nothing when a recording is already prepared or running.
   */
  async prepare(sport: ManualSport, title: string): Promise<void> {
    if (this.snap.phase !== 'idle' || this.preparing) return;
    this.preparing = true;
    try {
      this.wantWarm = null;
      await this.warmIo;
      const gps = GPS_SPORTS.includes(sport);
      this.title = title;
      this.used = new Set();
      let noService: boolean;
      if (gps && this.warmSport !== null) {
        noService = this.warmNoService;
        this.warmSport = null;
        // The warm-up ran for another sport (a ride): the running session has no step counter, ask for it now.
        if (!this.sessionSteps && (await this.wantsSteps(sport))) noService = await this.beginSession(gps, title, sport);
      } else {
        if (this.warmSport !== null) await this.endWarm();
        this.resetFix();
        this.attach();
        noService = await this.beginSession(gps, title, sport);
      }
      const ids = this.deps.sensors().filter((s) => s.autoConnect).map((s) => s.id);
      this.resetSensors();
      this.snap = { ...idleSnapshot(), phase: 'ready', sport, gps, noService, sensorIds: ids, phoneSteps: this.sessionSteps };
      this.beginTimer();
      this.publish();
      const sensorError = await this.connectAll(ids);
      this.publish({ sensorIds: ids, sensorError });
    } finally {
      this.preparing = false;
    }
  }

  /**
   * Starts the GPS ahead of `prepare`, while the picker is open: the native session with GPS runs and `snapshot.fix` follows it, so a
   * fix is waiting when "Mulai" is tapped. Only for an outdoor sport that already has precise location (it never asks), only in phase
   * `idle`. Changing between outdoor sports keeps the session. Never rejects: a refusal just leaves the warm-up off.
   */
  warmUp(sport: ManualSport, title: string): Promise<void> {
    if (!GPS_SPORTS.includes(sport)) return this.stopWarmUp();
    this.wantWarm = { sport, title };
    return this.reconcileWarm();
  }

  /** Ends the warm-up (leaving the picker, a sport without GPS, the app in the background). Does nothing while `prepare` runs. */
  stopWarmUp(): Promise<void> {
    this.wantWarm = null;
    return this.reconcileWarm();
  }

  private reconcileWarm(): Promise<void> {
    this.warmIo = this.warmIo.then(() => this.applyWarm()).catch((e) => this.deps.log?.(`GPS warm-up failed: ${String(e)}`));
    return this.warmIo;
  }

  private async applyWarm(): Promise<void> {
    if (this.snap.phase !== 'idle' || this.preparing) return;
    const want = this.wantWarm;
    if (want && this.warmSport === null) {
      this.resetFix();
      this.attach();
      try {
        this.warmNoService = await this.beginSession(true, want.title, want.sport);
      } catch (error) {
        this.deps.log?.(`GPS warm-up not started: ${String(error)}`);
        return;
      }
      this.warmSport = want.sport;
      this.beginTimer();
      this.publish({ warm: true, noService: this.warmNoService });
    } else if (want && this.warmSport !== want.sport) {
      this.warmSport = want.sport;
    } else if (!want && this.warmSport !== null) {
      await this.endWarm();
    }
  }

  private async endWarm(): Promise<void> {
    clearInterval(this.timer ?? undefined);
    this.timer = null;
    this.detach();
    this.warmSport = null;
    this.resetFix();
    await this.deps.session.end().catch((e) => this.deps.log?.(`ending the warm-up failed: ${String(e)}`));
    this.sessionSteps = false;
    this.publish({ warm: false, noService: false });
  }

  private resetFix(): void {
    this.lastFix = null;
    this.usableSince = null;
    this.lastFixAt = null;
  }

  /** Leaves `ready` without recording anything. */
  async cancel(): Promise<void> {
    if (this.snap.phase !== 'ready') return;
    await this.teardown();
    this.snap = idleSnapshot();
    this.publish();
  }

  /** Starts the clock. */
  start(): void {
    const { phase, sport, gps } = this.snap;
    if (phase !== 'ready' || sport === null) return;
    const recorder = new Recorder({ sport, gps, wheelCircumferenceM: this.deps.wheelCircumferenceM(), profile: this.deps.profile() });
    this.recorder = recorder;
    recorder.start(this.deps.now());
    this.snap = { ...this.snap, phase: 'active' };
    this.beginTimer();
    this.persist();
    this.publish();
    this.pushSession();
    this.startBand(sport);
  }

  pause(): void {
    this.pauseRecorder();
    void this.deps.band?.setPaused(true);
  }

  resume(): void {
    this.resumeRecorder();
    void this.deps.band?.setPaused(false);
  }

  private pauseRecorder(): void {
    this.recorder?.pause(this.deps.now());
    this.persist();
    this.publish();
    this.pushSession();
  }

  private resumeRecorder(): void {
    this.recorder?.resume(this.deps.now());
    this.persist();
    this.publish();
    this.pushSession();
  }

  lap(): void {
    this.recorder?.lap(this.deps.now());
    this.persist();
    this.publish();
  }

  /** Brings back a recording the app lost (killed, crashed, phone restarted). True when there was one. */
  async restore(): Promise<boolean> {
    if (this.snap.phase !== 'idle') return false;
    await this.stopWarmUp();
    const journal = await loadJournal<JournalMeta>(this.deps.db, 'phone');
    if (!journal) return false;
    const { recorder: meta, sensorIds, used, title, takes } = journal.meta;
    if (meta.status === 'finished' || meta.status === 'idle') {
      await clearJournal(this.deps.db, 'phone');
      return false;
    }
    this.title = title;
    this.used = new Set(used);
    this.resetSensors();
    this.takes = new Map(Object.entries(takes ?? {}));
    this.resetFix();
    this.attach();
    const recorder = Recorder.restore(meta, journal.samples);
    this.recorder = recorder;
    const noService = await this.beginSession(meta.config.gps, title, meta.config.sport);
    this.snap = { ...idleSnapshot(), phase: 'active', sport: meta.config.sport, gps: meta.config.gps, noService, sensorIds, phoneSteps: this.sessionSteps };
    const sensorError = await this.connectAll(sensorIds);
    this.beginTimer();
    this.publish({ sensorError });
    this.pushSession();
    // The band still holds the workout of this process (a screen reload), else it is not told again; a restored recording is paused.
    if (this.deps.band) {
      const band = this.deps.band;
      void band.adopt(meta.config.sport, (bpm, ts) => this.onBandHeartRate(bpm, ts)).then(() => band.setPaused(true));
    }
    return true;
  }

  /** The web game's current speed (m/s) for an indoor ride ("Main di web"); see `Recorder.virtualSpeed`. */
  setVirtualSpeed(speedMps: number): void {
    this.recorder?.virtualSpeed(speedMps, this.deps.now());
  }

  /**
   * Ends the workout and saves it. Null when nothing was recorded (then it is discarded). `virtual` is the web game's summary: its
   * distance and climb are stored with the workout instead of the recorder's own distance.
   */
  async finish(virtual?: VirtualRide): Promise<FinishResult | null> {
    const recorder = this.recorder;
    if (this.snap.phase !== 'active' || !recorder) return null;
    this.publish({ phase: 'saving' });
    const workout = this.pending ?? recorder.finish(this.deps.now());
    this.pending = workout;
    await this.flush();
    let result: FinishResult | null = null;
    try {
      if (workout) {
        const saved = this.deps.sensors();
        // Every sensor the recording asked for is listed, also one that never sent a value: the workout then says so.
        const sensors: WorkoutSensor[] = [...new Set([...this.snap.sensorIds, ...this.used])].map((id) => {
          const s = saved.find((x) => x.id === id);
          const take = this.takes.get(id);
          const mode = take ? cscModeOf(take.wheel, take.crank) : null;
          return {
            id,
            name: s ? (s.alias?.trim() || s.name) : id,
            kinds: (s?.kinds ?? []) as SensorKind[],
            frames: take?.frames ?? 0,
            ...(mode ? { mode } : {}),
          };
        });
        result = { workoutId: await saveRecordedWorkout(this.deps.db, workout, sensors, virtual) };
      }
    } catch (error) {
      // Nothing is lost: the journal still holds the samples and `pending` the finished workout. Back to `active` with status
      // `finished`: the screen offers to save again.
      this.deps.log?.(`saving the recording failed: ${String(error)}`);
      this.snap = { ...this.snap, phase: 'active' };
      this.publish();
      throw error;
    }
    this.pending = null;
    await this.discardJournal();
    await this.teardown();
    this.snap = idleSnapshot();
    this.publish();
    return result;
  }

  /** Throws the recording away. */
  async discard(): Promise<void> {
    if (this.snap.phase === 'idle') return;
    await this.flush();
    this.pending = null;
    await this.discardJournal();
    await this.teardown();
    this.snap = idleSnapshot();
    this.publish();
  }

  /** One second of the clock; also called when the app comes back to the foreground to fill the seconds a throttled thread missed. */
  tick(): void {
    // Getting ready or warming up nothing is recorded, but the GPS age on the screen keeps counting.
    if (this.snap.phase === 'ready' || (this.snap.phase === 'idle' && this.warmSport !== null)) {
      if (this.snap.phase === 'ready') this.superviseSensors(this.deps.now());
      this.publish();
      return;
    }
    const recorder = this.recorder;
    if (!recorder || this.snap.phase !== 'active') return;
    const now = this.deps.now();
    recorder.tick(now);
    this.followBand();
    this.superviseSensors(now);
    for (const observer of this.observers) {
      try {
        observer({ recorder, now });
      } catch (error) {
        this.deps.log?.(`recording observer failed: ${String(error)}`);
      }
    }
    this.ticks += 1;
    if (this.ticks % JOURNAL_EVERY_S === 0) this.persist();
    if (this.ticks % NOTIFICATION_EVERY_S === 0 && recorder.status === 'recording') {
      this.pushSession();
    }
    this.publish();
  }

  // -------------------------------------------------------------------------------------------------------------------
  // internals

  /** Reports the clock, distance and heart rate to the notification (Android): on every change of state and every `NOTIFICATION_EVERY_S`. */
  private pushSession(): void {
    const recorder = this.recorder;
    if (!recorder || (recorder.status !== 'recording' && recorder.status !== 'paused')) return;
    const live = recorder.live(this.deps.now());
    const paused = recorder.status === 'paused';
    void this.deps.session.update({ movingSec: live.movingSec, distanceM: live.distanceM, hr: live.hr, paused }).catch(() => {});
  }

  /** A button of the notification: the same as the one on the live screen. */
  private onNotificationAction(action: WorkoutAction): void {
    if (this.snap.phase !== 'active') return;
    if (action === 'pause') this.pause();
    else if (action === 'resume') this.resume();
    else this.lap();
  }

  /** "Mulai": the band starts the same sport (when it can and the person wants it) and its heart rate feeds the recording. Never blocks or fails the recording. */
  private startBand(sport: ManualSport): void {
    this.deps.band?.begin(sport, (bpm, ts) => this.onBandHeartRate(bpm, ts)).catch((e) => this.deps.log?.(`band start failed: ${String(e)}`));
  }

  /** The person pressed pause, resume or stop on the band: the recording follows. A stop pauses it (finishing is the person's call: the band's workout may have ended by mistake). */
  private followBand(): void {
    const order = this.deps.band?.poll();
    if (!order) return;
    this.deps.log?.(`the band's workout: ${order}`);
    if (order === 'resume') {
      if (this.recorder?.status === 'paused') this.resumeRecorder();
    } else if (this.recorder?.status === 'recording') {
      this.pauseRecorder();
    }
  }

  /** The band's heart rate, as a strap would give it, unless a strap is giving it right now. */
  private onBandHeartRate(bpm: number, ts: number): void {
    if (!this.recorder || this.snap.phase !== 'active') return;
    if (this.lastStrapHrAt !== null && this.deps.now() - this.lastStrapHrAt < STRAP_PREFERRED_MS) return;
    const hex = bandHeartRateHex(bpm);
    if (hex !== null) this.recorder.sensor('2a37', hex, ts);
  }

  private attach(): void {
    this.detach();
    this.off = [
      this.deps.session.onAction((action) => this.onNotificationAction(action)),
      this.deps.hub.onValue((e) => this.onSensorValue(e)),
      this.deps.hub.onSteps((e) => {
        if (this.recorder && this.snap.phase === 'active') this.recorder.steps(e.steps, e.ts, this.deps.now(), e.cadence ?? null);
      }),
      this.deps.hub.onLocation((e) => {
        this.lastFix = e;
        const now = this.deps.now();
        if (this.lastFixAt !== null && now - this.lastFixAt > FIX_GAP_MS) this.usableSince = null;
        this.lastFixAt = now;
        if (e.accuracy !== null && e.accuracy > MAX_FIX_ACCURACY_M) this.usableSince = null;
        else this.usableSince ??= now;
        if (this.recorder && this.snap.phase === 'active') {
          this.recorder.fix({ ts: e.ts, lat: e.lat, lon: e.lon, alt: e.alt, accuracy: e.accuracy, speed: e.speed });
        }
        if (this.snap.phase === 'ready' || this.warmSport !== null) this.publish();
      }),
    ];
  }

  private detach(): void {
    for (const off of this.off) off();
    this.off = [];
  }

  /** A raw value from any connected sensor: logged the first time (the frames are the evidence of what a sensor sends), taken into the recording while it is active. */
  private onSensorValue(e: ValueEvent): void {
    const characteristic = e.characteristic.toLowerCase();
    const key = `${e.id}/${characteristic}`;
    if (!this.loggedFirst.has(key)) {
      this.loggedFirst.add(key);
      this.deps.log?.(`sensor ${this.sensorName(e.id)}: first ${characteristic} value ${e.value}${this.snap.phase === 'active' ? '' : ' (not recording yet)'}`);
    }
    const recorder = this.recorder;
    if (!recorder || this.snap.phase !== 'active' || !recorder.sensor(e.characteristic, e.value, e.ts)) return;
    if (characteristic === '2a37') this.lastStrapHrAt = this.deps.now();
    this.used.add(e.id);
    const take = this.takes.get(e.id) ?? { frames: 0, wheel: false, crank: false };
    take.frames += 1;
    if (characteristic === '2a5b') {
      const csc = parseCsc(hexToBytes(e.value));
      if (csc?.wheel) take.wheel = true;
      if (csc?.crank) take.crank = true;
    }
    this.takes.set(e.id, take);
  }

  private sensorName(id: string): string {
    const s = this.deps.sensors().find((x) => x.id === id);
    return s ? s.alias?.trim() || s.name : id;
  }

  private resetSensors(): void {
    this.takes = new Map();
    this.lastStrapHrAt = null;
    this.loggedFirst = new Set();
    this.retries.clear();
    this.loggedState.clear();
  }

  /**
   * The sensors of the recording stay wanted for the whole session. A sensor that sleeps until the crank turns, drops out of range or
   * loses its link is connected again for as long as the recording runs: its link is restarted `SENSOR_RETRY_FIRST_MS` after it is seen
   * down, then after growing pauses up to `SENSOR_RETRY_MAX_MS`, never given up. The link's own retries (native, with backoff) go on
   * in between; this only cuts their waiting. Link changes are written to the log.
   */
  private superviseSensors(now: number): void {
    const links = this.deps.hub.links();
    for (const id of this.connected) {
      const link = links[id];
      const state = link?.state ?? 'disconnected';
      const note = state === 'disconnected' ? `not connected${link?.lastFailure ? ` (${link.lastFailure})` : ''}` : state;
      if (this.loggedState.get(id) !== note) {
        this.loggedState.set(id, note);
        this.deps.log?.(`sensor ${this.sensorName(id)}: ${note}`);
      }
      if (state === 'connected') {
        this.retries.delete(id);
        continue;
      }
      if (state === 'connecting') continue;
      let retry = this.retries.get(id);
      if (!retry) {
        retry = { nextAt: now + SENSOR_RETRY_FIRST_MS, attempts: 0 };
        this.retries.set(id, retry);
      }
      if (now < retry.nextAt) continue;
      retry.attempts += 1;
      retry.nextAt = now + Math.min(SENSOR_RETRY_MAX_MS, SENSOR_RETRY_FIRST_MS * 2 ** retry.attempts);
      this.deps.log?.(`sensor ${this.sensorName(id)}: connecting again (attempt ${retry.attempts})`);
      this.deps.hub.connect(id).catch((error: unknown) => {
        this.deps.log?.(`connect ${id} failed: ${String(error)}`);
        this.publish({ sensorError: codeOf(error) || String(error) });
      });
    }
    if (this.snap.sensorError !== null && this.connected.every((id) => links[id]?.state === 'connected')) this.publish({ sensorError: null });
  }

  private beginTimer(): void {
    clearInterval(this.timer ?? undefined);
    this.ticks = 0;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  /** True when the Android foreground service was refused. */
  private async beginSession(gps: boolean, title: string, sport: ManualSport): Promise<boolean> {
    const steps = await this.wantsSteps(sport);
    try {
      await this.deps.session.start({ title, text: title, gps, ...(steps ? { steps: true } : {}) });
      this.sessionSteps = steps;
      return false;
    } catch (error) {
      if (codeOf(error) === 'ERR_SERVICE_NOT_ALLOWED') {
        this.deps.log?.('the foreground service was refused; recording without it');
        this.sessionSteps = steps;
        return true;
      }
      this.detach();
      throw error;
    }
  }

  /** A foot sport uses the phone's step counter for cadence and steps when it may; a refusal or a failed check never blocks the recording. */
  private async wantsSteps(sport: ManualSport): Promise<boolean> {
    if (!FOOT_SPORTS.includes(sport)) return false;
    try {
      return (await this.deps.stepCounter()) === 'granted';
    } catch (error) {
      this.deps.log?.(`step counter check failed: ${String(error)}`);
      return false;
    }
  }

  /** Connects every id; the first error code is kept (the rest are logged), none stops the others. */
  private async connectAll(ids: readonly string[]): Promise<string | null> {
    let first: string | null = null;
    this.connected = [...ids];
    await Promise.all(
      ids.map(async (id) => {
        try {
          await this.deps.hub.connect(id);
        } catch (error) {
          first ??= codeOf(error) || String(error);
          this.deps.log?.(`connect ${id} failed: ${String(error)}`);
        }
      }),
    );
    return first;
  }

  private persist(): void {
    const recorder = this.recorder;
    if (!recorder) return;
    const samples = recorder.drainNew();
    const meta: JournalMeta = {
      recorder: recorder.meta(),
      sensorIds: this.snap.sensorIds,
      used: [...this.used],
      title: this.title,
      takes: Object.fromEntries(this.takes),
    };
    const now = this.deps.now();
    this.io = this.io
      .then(() => appendJournal(this.deps.db, 'phone', samples))
      .then(() => saveJournalState(this.deps.db, 'phone', meta, now))
      .catch((e) => this.deps.log?.(`journal write failed: ${String(e)}`));
  }

  private async flush(): Promise<void> {
    this.persist();
    await this.io;
  }

  private async discardJournal(): Promise<void> {
    await this.io;
    await clearJournal(this.deps.db, 'phone');
  }

  private async teardown(): Promise<void> {
    void this.deps.band?.end();
    clearInterval(this.timer ?? undefined);
    this.timer = null;
    this.detach();
    this.resetFix();
    this.recorder = null;
    await Promise.all(
      this.connected.map((id) =>
        this.deps.hub.disconnect(id).catch((e) => this.deps.log?.(`disconnect ${id} failed: ${String(e)}`)),
      ),
    );
    this.connected = [];
    this.retries.clear();
    await this.deps.session.end().catch((e) => this.deps.log?.(`ending the session failed: ${String(e)}`));
    this.sessionSteps = false;
  }
}

function idleSnapshot(): RecordingSnapshot {
  return { phase: 'idle', sport: null, gps: false, warm: false, status: 'idle', live: null, laps: [], sensorIds: [], fix: null, position: null, noService: false, sensorError: null, phoneSteps: false };
}
