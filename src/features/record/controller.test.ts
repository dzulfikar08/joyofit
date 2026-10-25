import { afterEach, describe, expect, it } from 'bun:test';

import type { LocationEvent, StepCounterPermission, StepsEvent, ValueEvent, WorkoutAction, WorkoutSessionOptions, WorkoutSessionState } from '../../../modules/ble-sensors/src/BleSensors.types';
import { bytesToHex } from '../sensors/gatt';
import { ensureSensorSchema, type SavedSensor } from '../sensors/store';
import { BandLink, type BandLinkNative } from './bandLinkCore';
import type { WatchWorkoutResult, WatchWorkoutStatus } from '../../../modules/huawei-wear/src/HuaweiWear.types';
import { RecordingController, type HubApi, type RecordingDeps, type SessionApi } from './controller';
import { ensureRecordingSchema, loadJournal } from './journal';
import { openDb } from './testDb';

const T0 = 1_700_000_000_000;

const strap: SavedSensor = {
  id: 'AA:BB:CC:DD:EE:01',
  name: 'Polar H10 1234',
  alias: 'My strap',
  kinds: ['hr'],
  addedAt: 0,
  lastSeen: null,
  battery: null,
  batteryAt: null,
  manufacturer: null,
  model: null,
  autoConnect: true,
};
const idle: SavedSensor = { ...strap, id: 'AA:BB:CC:DD:EE:02', name: 'Old TICKR', alias: null, autoConnect: false };

class FakeHub implements HubApi {
  values: ((e: ValueEvent) => void)[] = [];
  fixes: ((e: LocationEvent) => void)[] = [];
  steps: ((e: StepsEvent) => void)[] = [];
  connects: string[] = [];
  disconnects: string[] = [];
  failConnect: string | null = null;
  /** The link state of each sensor: a sensor that is asked to connect is up at once, like a strap on a chest. */
  state: Record<string, 'connecting' | 'connected' | 'disconnected'> = {};
  onValue(l: (e: ValueEvent) => void) {
    this.values.push(l);
    return () => (this.values = this.values.filter((x) => x !== l));
  }
  onSteps(l: (e: StepsEvent) => void) {
    this.steps.push(l);
    return () => (this.steps = this.steps.filter((x) => x !== l));
  }
  onLocation(l: (e: LocationEvent) => void) {
    this.fixes.push(l);
    return () => (this.fixes = this.fixes.filter((x) => x !== l));
  }
  async connect(id: string) {
    if (this.failConnect) throw Object.assign(new Error('bt'), { code: this.failConnect });
    this.connects.push(id);
    this.state[id] = 'connected';
  }
  async disconnect(id: string) {
    this.disconnects.push(id);
    delete this.state[id];
  }
  links() {
    return Object.fromEntries(Object.entries(this.state).map(([id, state]) => [id, { state, error: null, lastFailure: null }]));
  }
  emitSteps(ts: number, steps: number) {
    for (const l of this.steps) l({ ts, steps });
  }
  emitValue(id: string, characteristic: string, hex: string, ts: number) {
    for (const l of this.values) l({ id, ts, service: '', characteristic, value: hex });
  }
  emitFix(ts: number, meters: number, accuracy = 5) {
    for (const l of this.fixes) l({ ts, lat: 10 + meters / 111_194.93, lon: 20, alt: 100, accuracy, speed: 3, bearing: null });
  }
}

class FakeSession implements SessionApi {
  starts: WorkoutSessionOptions[] = [];
  updates: WorkoutSessionState[] = [];
  actionListeners = new Set<(a: WorkoutAction) => void>();
  ended = 0;
  failWith: string | null = null;
  async start(o: WorkoutSessionOptions) {
    if (this.failWith) throw Object.assign(new Error('x'), { code: this.failWith });
    this.starts.push(o);
  }
  async update(state: WorkoutSessionState) {
    this.updates.push(state);
  }
  onAction(listener: (a: WorkoutAction) => void) {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }
  press(action: WorkoutAction) {
    for (const l of this.actionListeners) l(action);
  }
  async end() {
    this.ended += 1;
  }
}

async function setup(
  sensors: SavedSensor[] = [strap, idle],
  stepCounter: StepCounterPermission | (() => Promise<StepCounterPermission>) = 'unavailable',
  band?: RecordingDeps['band'],
) {
  const { db, all } = openDb();
  await ensureSensorSchema(db as never);
  await ensureRecordingSchema(db as never);
  const hub = new FakeHub();
  const session = new FakeSession();
  let clock = T0;
  const logs: string[] = [];
  const controller = new RecordingController({
    hub,
    session,
    stepCounter: typeof stepCounter === 'function' ? stepCounter : async () => stepCounter,
    db,
    now: () => clock,
    profile: () => ({ weightKg: 70, age: 35, sex: 'male' }),
    wheelCircumferenceM: () => 2.105,
    sensors: () => sensors,
    band,
    log: (m) => logs.push(m),
  });
  /** Advances the fake clock and runs the controller's own tick for every second. */
  const run = (seconds: number, perSecond?: (clockMs: number) => void) => {
    for (let i = 0; i < seconds; i++) {
      clock += 1000;
      perSecond?.(clock);
      controller.tick();
    }
  };
  return { controller, hub, session, db, all, logs, run, clock: () => clock };
}

const hr = (bpm: number) => bytesToHex(new Uint8Array([0x00, bpm]));

let live: RecordingController | null = null;
afterEach(async () => {
  // stop the interval of a controller a test left running
  await live?.discard().catch(() => {});
  live = null;
});

describe('prepare and cancel', () => {
  it('starts the native session, connects only the auto-connect sensors and reports readiness', async () => {
    const { controller, hub, session, run } = await setup();
    live = controller;
    await controller.prepare('run', 'Lari');
    expect(session.starts).toEqual([{ title: 'Lari', text: 'Lari', gps: true }]);
    expect(hub.connects).toEqual([strap.id]);
    const s = controller.getSnapshot();
    expect(s).toMatchObject({ phase: 'ready', sport: 'run', gps: true, sensorIds: [strap.id], status: 'idle', live: null });
    hub.emitFix(T0, 0);
    expect(controller.getSnapshot().fix).toEqual({ accuracyM: 5, ageSec: 0, usableSec: 0 });
    // nothing is recorded yet, but the age of the fix keeps counting on screen
    run(3);
    expect(controller.getSnapshot().fix).toEqual({ accuracyM: 5, ageSec: 3, usableSec: 3 });
    expect(controller.getSnapshot().live).toBeNull();
  });

  it('an indoor sport asks for no GPS', async () => {
    const { controller, session } = await setup();
    live = controller;
    await controller.prepare('treadmill', 'Treadmill');
    expect(session.starts[0]!.gps).toBe(false);
  });

  it('cancel disconnects and ends the session without saving anything', async () => {
    const { controller, hub, session, all } = await setup();
    await controller.prepare('run', 'Lari');
    await controller.cancel();
    expect(hub.disconnects).toEqual([strap.id]);
    expect(session.ended).toBe(1);
    expect(controller.getSnapshot().phase).toBe('idle');
    expect(all('SELECT * FROM workouts')).toEqual([]);
  });

  it('keeps going when Android refuses the foreground service, and says so', async () => {
    const { controller, session } = await setup();
    live = controller;
    session.failWith = 'ERR_SERVICE_NOT_ALLOWED';
    await controller.prepare('ride', 'Ride');
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', noService: true });
  });

  it('a missing location permission fails the prepare and leaves nothing running', async () => {
    const { controller, session, hub } = await setup();
    session.failWith = 'ERR_LOCATION_PERMISSION';
    await expect(controller.prepare('run', 'Lari')).rejects.toThrow();
    expect(controller.getSnapshot().phase).toBe('idle');
    expect(hub.values).toHaveLength(0);
  });

  it('a Bluetooth error does not stop the recording from being prepared', async () => {
    const { controller, hub } = await setup();
    live = controller;
    hub.failConnect = 'ERR_BLUETOOTH_OFF';
    await controller.prepare('run', 'Lari');
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', sensorError: 'ERR_BLUETOOTH_OFF' });
  });
});

describe('GPS warm-up', () => {
  it('starts the GPS session as soon as the picker asks, before anything is prepared', async () => {
    const { controller, session, hub } = await setup();
    live = controller;
    await controller.warmUp('run', 'Lari');
    expect(session.starts).toEqual([{ title: 'Lari', text: 'Lari', gps: true }]);
    expect(hub.connects).toEqual([]);
    expect(hub.fixes).toHaveLength(1);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', warm: true, fix: null, status: 'idle' });
  });

  it('shows the fixes of the warm-up and for how long they have been good enough', async () => {
    const { controller, hub, run } = await setup();
    live = controller;
    await controller.warmUp('run', 'Lari');
    hub.emitFix(T0, 0, 80);
    expect(controller.getSnapshot().fix).toEqual({ accuracyM: 80, ageSec: 0, usableSec: null });
    run(1, (now) => hub.emitFix(now, 0, 30));
    expect(controller.getSnapshot().fix).toEqual({ accuracyM: 30, ageSec: 0, usableSec: 0 });
    run(2, (now) => hub.emitFix(now, 0, 28));
    expect(controller.getSnapshot().fix).toEqual({ accuracyM: 28, ageSec: 0, usableSec: 2 });
    // a bad fix breaks the run of good ones
    run(1, (now) => hub.emitFix(now, 0, 60));
    expect(controller.getSnapshot().fix).toEqual({ accuracyM: 60, ageSec: 0, usableSec: null });
  });

  it('reports where the latest fix is for the map, and forgets it when the warm-up ends', async () => {
    const { controller, hub } = await setup();
    live = controller;
    await controller.warmUp('run', 'Lari');
    expect(controller.getSnapshot().position).toBeNull();
    hub.emitFix(T0, 0);
    expect(controller.getSnapshot().position).toEqual({ lat: 10, lon: 20, headingDeg: null });
    await controller.stopWarmUp();
    expect(controller.getSnapshot().position).toBeNull();
  });

  it('restarts the run of good fixes after the signal was gone for a while', async () => {
    const { controller, hub, run } = await setup();
    live = controller;
    await controller.warmUp('run', 'Lari');
    hub.emitFix(T0, 0, 10);
    run(15);
    hub.emitFix(T0 + 15_000, 0, 10);
    expect(controller.getSnapshot().fix).toEqual({ accuracyM: 10, ageSec: 0, usableSec: 0 });
  });

  it('lets the age of the fix count while no new one arrives', async () => {
    const { controller, hub, run } = await setup();
    live = controller;
    await controller.warmUp('run', 'Lari');
    hub.emitFix(T0, 0, 10);
    run(4);
    expect(controller.getSnapshot().fix?.ageSec).toBe(4);
  });

  it('prepare takes the running session over: no second start, the fix stays, the sensors connect now', async () => {
    const { controller, hub, session } = await setup();
    live = controller;
    await controller.warmUp('run', 'Lari');
    hub.emitFix(T0, 0, 8);
    await controller.prepare('run', 'Lari');
    expect(session.starts).toHaveLength(1);
    expect(session.ended).toBe(0);
    expect(hub.connects).toEqual([strap.id]);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', warm: false, gps: true, fix: { accuracyM: 8 } });
  });

  it('prepare right behind warmUp waits for it and starts one session only', async () => {
    const { controller, session } = await setup();
    live = controller;
    void controller.warmUp('run', 'Lari');
    await controller.prepare('run', 'Lari');
    expect(session.starts).toHaveLength(1);
    expect(controller.getSnapshot().phase).toBe('ready');
  });

  it('prepare for a sport without GPS ends the warm-up and starts its own session', async () => {
    const { controller, hub, session } = await setup();
    live = controller;
    await controller.warmUp('run', 'Lari');
    hub.emitFix(T0, 0, 8);
    await controller.prepare('treadmill', 'Treadmill');
    expect(session.ended).toBe(1);
    expect(session.starts.map((s) => s.gps)).toEqual([true, false]);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', gps: false, fix: null });
  });

  it('stopWarmUp ends the session, forgets the fix and stops listening', async () => {
    const { controller, hub, session, run } = await setup();
    await controller.warmUp('run', 'Lari');
    hub.emitFix(T0, 0, 8);
    await controller.stopWarmUp();
    expect(session.ended).toBe(1);
    expect(hub.fixes).toHaveLength(0);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', warm: false, fix: null });
    // the clock is stopped with it: nothing publishes any more
    let published = 0;
    controller.subscribe(() => (published += 1));
    run(3);
    expect(published).toBe(0);
  });

  it('stopWarmUp with nothing warm does nothing', async () => {
    const { controller, session } = await setup();
    await controller.stopWarmUp();
    expect(session.ended).toBe(0);
  });

  it('a stop right behind the start never leaves the GPS running', async () => {
    const { controller, session } = await setup();
    const started = controller.warmUp('run', 'Lari');
    const stopped = controller.stopWarmUp();
    await Promise.all([started, stopped]);
    expect(session.starts.length).toBe(session.ended);
    expect(controller.getSnapshot().warm).toBe(false);
  });

  it('a sport without GPS does not warm up, and switching to one ends the warm-up', async () => {
    const { controller, session } = await setup();
    await controller.warmUp('treadmill', 'Treadmill');
    expect(session.starts).toEqual([]);
    await controller.warmUp('run', 'Lari');
    expect(controller.getSnapshot().warm).toBe(true);
    await controller.warmUp('treadmill', 'Treadmill');
    expect(session.ended).toBe(1);
    expect(controller.getSnapshot().warm).toBe(false);
  });

  it('changing between outdoor sports keeps the one session running', async () => {
    const { controller, hub, session } = await setup();
    live = controller;
    await controller.warmUp('run', 'Lari');
    hub.emitFix(T0, 0, 8);
    await controller.warmUp('ride', 'Ride');
    expect(session.starts).toHaveLength(1);
    expect(session.ended).toBe(0);
    expect(controller.getSnapshot().fix?.accuracyM).toBe(8);
    // and "Mulai" then carries the chosen sport
    await controller.prepare('ride', 'Ride');
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', sport: 'ride', gps: true });
  });

  it('a refused location leaves the warm-up off without failing', async () => {
    const { controller, session, hub, logs } = await setup();
    session.failWith = 'ERR_LOCATION_PERMISSION';
    await controller.warmUp('run', 'Lari');
    expect(controller.getSnapshot().warm).toBe(false);
    expect(hub.fixes).toHaveLength(0);
    expect(logs.some((l) => l.includes('GPS warm-up'))).toBe(true);
    // it can be tried again once the permission is there
    session.failWith = null;
    live = controller;
    await controller.warmUp('run', 'Lari');
    expect(controller.getSnapshot().warm).toBe(true);
  });

  it('carries the refused foreground service over to the recording', async () => {
    const { controller, session } = await setup();
    live = controller;
    session.failWith = 'ERR_SERVICE_NOT_ALLOWED';
    await controller.warmUp('run', 'Lari');
    expect(controller.getSnapshot()).toMatchObject({ warm: true, noService: true });
    await controller.prepare('run', 'Lari');
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', noService: true });
  });

  it('a stop while prepare runs leaves the session to prepare', async () => {
    const { controller, session } = await setup();
    live = controller;
    await controller.warmUp('run', 'Lari');
    const preparing = controller.prepare('run', 'Lari');
    const stopped = controller.stopWarmUp();
    await Promise.all([preparing, stopped]);
    expect(session.ended).toBe(0);
    expect(controller.getSnapshot().phase).toBe('ready');
  });

  it('does not warm up while a recording is prepared or running', async () => {
    const { controller, session } = await setup();
    live = controller;
    await controller.prepare('run', 'Lari');
    await controller.warmUp('run', 'Lari');
    await controller.stopWarmUp();
    expect(session.starts).toHaveLength(1);
    expect(session.ended).toBe(0);
    controller.start();
    await controller.warmUp('ride', 'Ride');
    expect(session.starts).toHaveLength(1);
    expect(controller.getSnapshot().phase).toBe('active');
  });

  it('warms up again after a cancel, with a fresh fix', async () => {
    const { controller, hub } = await setup();
    live = controller;
    await controller.warmUp('run', 'Lari');
    hub.emitFix(T0, 0, 8);
    await controller.prepare('run', 'Lari');
    await controller.cancel();
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', warm: false, fix: null });
    await controller.warmUp('run', 'Lari');
    expect(controller.getSnapshot()).toMatchObject({ warm: true, fix: null });
  });

  it('restore ends a warm-up first', async () => {
    const { controller, session } = await setup();
    await controller.warmUp('run', 'Lari');
    expect(await controller.restore()).toBe(false);
    expect(session.ended).toBe(1);
    expect(controller.getSnapshot().warm).toBe(false);
  });

  it('records from the first good fix of the warm-up onwards', async () => {
    const { controller, hub, run } = await setup();
    live = controller;
    await controller.warmUp('run', 'Lari');
    await controller.prepare('run', 'Lari');
    controller.start();
    let meters = 0;
    run(1, (now) => hub.emitFix(now, 0, 90));
    run(10, (now) => hub.emitFix(now, (meters += 3), 8));
    const s = controller.getSnapshot();
    expect(s.phase).toBe('active');
    expect(s.live?.distanceM).toBeGreaterThan(20);
    expect(s.live?.distanceM).toBeLessThan(35);
  });
});

describe('a workout from start to saved', () => {
  it('records heart rate and GPS, laps, pauses, and saves it as a phone workout with its sensor', async () => {
    const { controller, hub, session, all, run } = await setup();
    await controller.prepare('run', 'Lari');
    controller.start();
    expect(controller.getSnapshot()).toMatchObject({ phase: 'active', status: 'recording' });

    let meters = 0;
    run(40, (clock) => {
      hub.emitValue(strap.id, '2a37', hr(150), clock);
      hub.emitFix(clock, (meters += 3));
    });
    controller.lap();
    expect(controller.getSnapshot().laps).toHaveLength(1);
    controller.pause();
    expect(controller.getSnapshot().status).toBe('paused');
    run(30); // paused: the clock keeps running, the recording does not
    controller.resume();
    run(20, (clock) => {
      hub.emitValue(strap.id, '2a37', hr(160), clock);
      hub.emitFix(clock, (meters += 3));
    });
    expect(session.updates.length).toBeGreaterThan(0);

    const result = await controller.finish();
    expect(result).not.toBeNull();
    const [row] = all<Record<string, unknown>>('SELECT * FROM workouts WHERE id = ?', result!.workoutId);
    expect(row).toMatchObject({ sport_name: 'Run', imported: 1, device: null, complete: 1 });
    expect(row!.distance).toBeGreaterThan(150);
    expect(row!.avg_hr).toBeGreaterThan(145);
    const summary = JSON.parse(row!.summary_json as string);
    expect(summary.source).toBe('phone');
    expect(summary.sensors).toEqual([{ id: strap.id, name: 'My strap', kinds: ['hr'], frames: 60 }]);
    expect(summary.laps).toHaveLength(2);
    expect(all('SELECT * FROM workout_sensor')).toHaveLength(1);
    // the journal is gone, the radio and the session are released, the controller is idle again
    expect(all('SELECT * FROM recording_state')).toEqual([]);
    expect(all('SELECT * FROM recording_journal')).toEqual([]);
    expect(hub.disconnects).toEqual([strap.id]);
    expect(session.ended).toBe(1);
    expect(controller.getSnapshot().phase).toBe('idle');
  });

  it('reports the clock to the notification on start, pause and resume, and the numbers every 15 s while recording', async () => {
    const { controller, hub, session, run } = await setup();
    await controller.prepare('run', 'Lari');
    controller.start();
    expect(session.updates).toEqual([{ movingSec: 0, distanceM: 0, hr: null, paused: false }]);
    let meters = 0;
    run(30, (clock) => {
      hub.emitValue(strap.id, '2a37', hr(150), clock);
      hub.emitFix(clock, (meters += 3));
    });
    expect(session.updates).toHaveLength(3); // start, 15 s, 30 s
    expect(session.updates[2]).toMatchObject({ movingSec: 30, hr: 150, paused: false });
    expect(session.updates[2]!.distanceM).toBeGreaterThan(50);
    controller.pause();
    expect(session.updates[3]).toMatchObject({ movingSec: 30, paused: true });
    run(30); // paused: nothing is reported, the notification shows the frozen time
    expect(session.updates).toHaveLength(4);
    controller.resume();
    expect(session.updates[4]).toMatchObject({ movingSec: 30, paused: false });
  });

  it('the buttons of the notification pause, resume and lap the recording', async () => {
    const { controller, session, run } = await setup();
    await controller.prepare('run', 'Lari');
    session.press('pause'); // nothing runs yet
    expect(controller.getSnapshot().status).toBe('idle');
    controller.start();
    run(5);
    session.press('lap');
    expect(controller.getSnapshot().laps).toHaveLength(1);
    session.press('pause');
    expect(controller.getSnapshot().status).toBe('paused');
    session.press('resume');
    expect(controller.getSnapshot().status).toBe('recording');
    await controller.discard();
    expect(session.actionListeners.size).toBe(0);
  });

  it('a sensor that was asked for and never sent a value is listed on the workout with no values, so the workout can say so', async () => {
    const { controller, run, all } = await setup();
    await controller.prepare('treadmill', 'Treadmill');
    controller.start();
    run(10);
    const result = await controller.finish();
    expect(all('SELECT sensor_id FROM workout_sensor WHERE workout_id = ?', result!.workoutId)).toEqual([{ sensor_id: strap.id }]);
    const summary = JSON.parse(all<{ summary_json: string }>('SELECT summary_json FROM workouts')[0]!.summary_json);
    expect(summary.sensors).toEqual([{ id: strap.id, name: 'My strap', kinds: ['hr'], frames: 0 }]);
    expect(summary.kcalSource).toBe('met');
  });

  it('discard drops the journal and the radio but saves nothing', async () => {
    const { controller, run, all, session } = await setup();
    await controller.prepare('treadmill', 'Treadmill');
    controller.start();
    run(12);
    await controller.discard();
    expect(all('SELECT * FROM workouts')).toEqual([]);
    expect(all('SELECT * FROM recording_state')).toEqual([]);
    expect(session.ended).toBe(1);
    expect(controller.getSnapshot().phase).toBe('idle');
  });

  it('writes the journal every ten seconds', async () => {
    const { controller, run, all, db } = await setup();
    live = controller;
    await controller.prepare('treadmill', 'Treadmill');
    controller.start();
    run(25);
    await new Promise((r) => setTimeout(r, 20));
    expect(all<{ n: number }>('SELECT COUNT(*) AS n FROM recording_journal')[0]!.n).toBeGreaterThanOrEqual(20);
    expect(await loadJournal(db, 'phone')).not.toBeNull();
  });
});

describe('restore after the app was killed', () => {
  it('brings the recording back paused, reconnects its sensors and finishes with all samples', async () => {
    const first = await setup();
    await first.controller.prepare('treadmill', 'Treadmill');
    first.controller.start();
    first.run(30, (clock) => first.hub.emitValue(strap.id, '2a37', hr(140), clock));
    // the journal is written; the app dies (no finish, no discard)
    await new Promise((r) => setTimeout(r, 20));
    // a second controller on the same database, as after a restart
    const hub = new FakeHub();
    const session = new FakeSession();
    let clock = T0 + 10 * 60_000;
    const back = new RecordingController({
      hub,
      session,
      stepCounter: async () => 'unavailable',
      db: first.db,
      now: () => clock,
      profile: () => ({ weightKg: 70, age: 35, sex: 'male' }),
      wheelCircumferenceM: () => 2.105,
      sensors: () => [strap, idle],
    });
    live = back;
    expect(await back.restore()).toBe(true);
    const s = back.getSnapshot();
    expect(s).toMatchObject({ phase: 'active', status: 'paused', sport: 'treadmill', sensorIds: [strap.id] });
    expect(hub.connects).toEqual([strap.id]);
    expect(session.starts).toHaveLength(1);
    back.resume();
    for (let i = 0; i < 10; i++) {
      clock += 1000;
      hub.emitValue(strap.id, '2a37', hr(150), clock);
      back.tick();
    }
    const result = await back.finish();
    const [row] = first.all<{ duration: number; summary_json: string }>('SELECT * FROM workouts WHERE id = ?', result!.workoutId);
    // 30 s before the kill (31 samples) and 10 s after the resume
    expect(row!.duration).toBeGreaterThanOrEqual(38);
    expect(JSON.parse(row!.summary_json).sensors).toHaveLength(1);
    live = null;
  });

  it('nothing to restore on a clean database', async () => {
    const { controller } = await setup();
    expect(await controller.restore()).toBe(false);
  });
});

describe('a failed save', () => {
  it('keeps the recording so the person can try again', async () => {
    const { controller, run, db, all } = await setup();
    await controller.prepare('treadmill', 'Treadmill');
    controller.start();
    run(15);
    const original = db.withExclusiveTransactionAsync.bind(db);
    let fail = true;
    (db as { withExclusiveTransactionAsync: unknown }).withExclusiveTransactionAsync = async (task: never) => {
      if (fail) throw new Error('disk full');
      return original(task);
    };
    await expect(controller.finish()).rejects.toThrow('disk full');
    expect(controller.getSnapshot()).toMatchObject({ phase: 'active', status: 'finished' });
    fail = false;
    const result = await controller.finish();
    expect(result).not.toBeNull();
    expect(all('SELECT * FROM workouts')).toHaveLength(1);
  });
});

describe("the phone's step counter", () => {
  it('asks the native session for steps only on foot and only with the permission', async () => {
    for (const [sport, permission, asked] of [
      ['run', 'granted', true],
      ['walk', 'granted', true],
      ['hike', 'granted', true],
      ['ride', 'granted', false],
      ['treadmill', 'granted', false],
      ['run', 'denied', false],
      ['run', 'undetermined', false],
      ['run', 'unavailable', false],
    ] as const) {
      const { controller, session } = await setup([strap, idle], permission);
      await controller.prepare(sport, 'x');
      expect(session.starts[0]!.steps === true).toBe(asked);
      await controller.cancel();
    }
  });

  it('a check that fails does not stop the recording from preparing', async () => {
    const { controller, session } = await setup([], async () => {
      throw new Error('no module');
    });
    live = controller;
    await controller.prepare('run', 'x');
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', phoneSteps: false });
    expect(session.starts[0]!.steps).toBeUndefined();
  });

  it('feeds the readings to the recorder only while the recording is active, and saves cadence and steps', async () => {
    const { controller, hub, run, all } = await setup([], 'granted');
    live = controller;
    await controller.prepare('run', 'Lari');
    expect(controller.getSnapshot().phoneSteps).toBe(true);
    // ready: not recording yet, so this reading is not the baseline
    hub.emitSteps(T0, 900);
    controller.start();
    let steps = 0;
    run(20, (clock) => {
      steps += 3;
      hub.emitSteps(clock, steps);
    });
    expect(controller.getSnapshot().live!.cadence).toBe(180);
    const result = await controller.finish();
    // the first reading after the start is the baseline: 20 readings, 19 differences of 3 steps
    const [row] = all<{ steps: number }>('SELECT steps FROM workouts WHERE id = ?', result!.workoutId);
    expect(row!.steps).toBe(57);
    const cadences = all<{ cadence: number | null }>('SELECT cadence FROM workout_points WHERE workout_id = ? ORDER BY ts', result!.workoutId).map((r) => r.cadence);
    expect(cadences.at(-1)).toBe(180);
    expect(cadences[0]).toBeNull();
    // after the finish the controller no longer listens
    expect(hub.steps).toHaveLength(0);
  });

  it('keeps feeding through a pause but counts none of it, and ignores readings before the start', async () => {
    const { controller, hub, run, all } = await setup([], 'granted');
    live = controller;
    await controller.prepare('walk', 'Jalan');
    controller.start();
    let steps = 0;
    const feed = (clock: number) => hub.emitSteps(clock, (steps += 2));
    run(6, feed);
    controller.pause();
    run(10, feed);
    controller.resume();
    run(4, feed);
    const result = await controller.finish();
    const [row] = all<{ steps: number }>('SELECT steps FROM workouts WHERE id = ?', result!.workoutId);
    // 20 readings of 2 steps: the first is the baseline, the 10 of the pause are skipped
    expect(row!.steps).toBe(2 * (6 - 1) + 2 * 4);
  });
});

/** The band as the native module shows it: a workout the phone started, which the person can also pause, resume or stop on the band. */
class FakeBandNative implements BandLinkNative {
  calls: string[] = [];
  outcome: WatchWorkoutResult = { outcome: 'confirmed', code: 100000 };
  active = false;
  state: 'running' | 'paused' | null = null;
  sport: number | null = null;
  getWatchWorkout(): WatchWorkoutStatus {
    return { connected: true, supported: true, active: this.active, sport: this.sport, state: this.state, watchOperator: null };
  }
  async startWatchWorkout(sport: number) {
    this.calls.push(`start ${sport}`);
    if (this.outcome.outcome !== 'refused' && this.outcome.outcome !== 'unsupported' && this.outcome.outcome !== 'not_connected') {
      this.active = true;
      this.state = 'running';
      this.sport = sport;
    }
    return this.outcome;
  }
  async pauseWatchWorkout() {
    this.calls.push('pause');
    this.state = 'paused';
    return { outcome: 'confirmed', code: 100000 } as WatchWorkoutResult;
  }
  async resumeWatchWorkout() {
    this.calls.push('resume');
    this.state = 'running';
    return { outcome: 'confirmed', code: 100000 } as WatchWorkoutResult;
  }
  async stopWatchWorkout() {
    this.calls.push('stop');
    this.active = false;
    this.state = null;
    return { outcome: 'confirmed', code: 100000 } as WatchWorkoutResult;
  }
}

function bandSetup(options: { native?: FakeBandNative | null; enabled?: boolean } = {}) {
  const native = options.native === undefined ? new FakeBandNative() : options.native;
  const readings: ((bpm: number, ts: number) => void)[] = [];
  const band = new BandLink({
    native: () => native,
    enabled: () => options.enabled ?? true,
    heartRate: (listener) => {
      readings.push(listener);
      return () => readings.splice(readings.indexOf(listener), 1);
    },
  });
  const bandHr = (bpm: number, ts: number) => readings.forEach((l) => l(bpm, ts));
  return { native, band, bandHr, readings };
}

/** Lets the band link's queued native calls (all resolved promises of the fake) run; no timers. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('the band beside a phone run', () => {
  it('starts the band with the run, mirrors pause and resume, stops it with the workout and takes its heart rate', async () => {
    const { native, band, bandHr, readings } = bandSetup();
    const { controller, hub, run, all } = await setup([strap, idle], 'unavailable', band);
    await controller.prepare('run', 'Lari');
    expect(native!.calls).toEqual([]);
    controller.start();
    await settle();
    expect(native!.calls).toEqual(['start 1']);
    expect(band.getSnapshot().phase).toBe('linked');

    let meters = 0;
    run(30, (clock) => {
      bandHr(140, clock);
      hub.emitFix(clock, (meters += 3));
    });
    controller.pause();
    await settle();
    controller.resume();
    await settle();
    expect(native!.calls).toEqual(['start 1', 'pause', 'resume']);

    const result = await controller.finish();
    await settle();
    expect(native!.calls).toEqual(['start 1', 'pause', 'resume', 'stop']);
    expect(band.getSnapshot().phase).toBe('off');
    expect(readings).toHaveLength(0);
    const [row] = all<Record<string, unknown>>('SELECT * FROM workouts WHERE id = ?', result!.workoutId);
    expect(row!.avg_hr).toBeGreaterThan(135);
  });

  it('a band that refuses leaves the recording going alone, still with its heart rate, and says so', async () => {
    const native = new FakeBandNative();
    native.outcome = { outcome: 'refused', code: 123002 };
    const { band, bandHr } = bandSetup({ native });
    const { controller, run } = await setup([strap, idle], 'unavailable', band);
    live = controller;
    await controller.prepare('run', 'Lari');
    controller.start();
    await settle();
    expect(band.getSnapshot()).toMatchObject({ phase: 'refused', code: 123002 });
    run(5, (clock) => bandHr(150, clock));
    expect(controller.getSnapshot()).toMatchObject({ phase: 'active', status: 'recording' });
    expect(controller.getSnapshot().live?.hr).toBe(150);
    // Pausing the phone sends nothing to a band that never started.
    controller.pause();
    await settle();
    expect(native.calls).toEqual(['start 1']);
  });

  it('a band that is not there leaves the recording going alone', async () => {
    const { band } = bandSetup({ native: null });
    const { controller } = await setup([strap, idle], 'unavailable', band);
    live = controller;
    await controller.prepare('run', 'Lari');
    controller.start();
    await settle();
    expect(band.getSnapshot().phase).toBe('nobuild');
    expect(controller.getSnapshot().status).toBe('recording');
  });

  it('the setting off, or a sport the band has no workout for, starts nothing', async () => {
    const off = bandSetup({ enabled: false });
    const a = await setup([strap, idle], 'unavailable', off.band);
    await a.controller.prepare('run', 'Lari');
    a.controller.start();
    await settle();
    expect(off.native!.calls).toEqual([]);
    expect(off.band.getSnapshot().phase).toBe('off');
    await a.controller.discard();

    const other = bandSetup();
    const b = await setup([strap, idle], 'unavailable', other.band);
    live = b.controller;
    await b.controller.prepare('other', 'Lainnya');
    b.controller.start();
    await settle();
    expect(other.native!.calls).toEqual([]);
  });

  it('a pause, resume and stop on the band is followed by the recording, and a stop only pauses it', async () => {
    const { native, band } = bandSetup();
    const { controller, run } = await setup([strap, idle], 'unavailable', band);
    live = controller;
    await controller.prepare('run', 'Lari');
    controller.start();
    await settle();
    run(3);

    native!.state = 'paused';
    run(1);
    expect(controller.getSnapshot().status).toBe('paused');
    native!.state = 'running';
    run(1);
    expect(controller.getSnapshot().status).toBe('recording');
    // Nothing was echoed back to the band.
    expect(native!.calls).toEqual(['start 1']);

    native!.active = false;
    native!.state = null;
    run(1);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'active', status: 'paused' });
    expect(band.getSnapshot().phase).toBe('ended');
    // Said once: the person can resume the phone recording and it is not paused again.
    controller.resume();
    run(3);
    expect(controller.getSnapshot().status).toBe('recording');
  });

  it('a strap keeps the heart rate: the band only fills in while no strap reading is fresh', async () => {
    const { band, bandHr } = bandSetup();
    const { controller, hub, run } = await setup([strap, idle], 'unavailable', band);
    live = controller;
    await controller.prepare('run', 'Lari');
    controller.start();
    await settle();
    run(1, (clock) => {
      hub.emitValue(strap.id, '2a37', hr(120), clock);
      bandHr(180, clock);
    });
    expect(controller.getSnapshot().live?.hr).toBe(120);
    // The strap goes quiet for more than five seconds: the band's reading is used.
    run(7, (clock) => bandHr(150, clock));
    expect(controller.getSnapshot().live?.hr).toBe(150);
  });
});
