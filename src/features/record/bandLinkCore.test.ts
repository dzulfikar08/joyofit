import { describe, expect, it } from 'bun:test';

import type { WatchWorkoutOutcome, WatchWorkoutResult, WatchWorkoutStatus } from '../../../modules/huawei-wear/src/HuaweiWear.types';
import { BandLink, bandHeartRateHex, bandSportCode, type BandLinkNative } from './bandLinkCore';

class FakeNative implements BandLinkNative {
  calls: string[] = [];
  startOutcome: WatchWorkoutOutcome = 'confirmed';
  startCode: number | null = 100000;
  throwOnStart = false;
  /** Outcome of a pause or resume: a refused one leaves the band's state as it was. */
  operatorOutcome: WatchWorkoutOutcome = 'confirmed';
  status: WatchWorkoutStatus = { connected: true, supported: true, active: false, sport: null, state: null, watchOperator: null };

  getWatchWorkout() {
    return this.status;
  }
  async startWatchWorkout(sport: number): Promise<WatchWorkoutResult> {
    this.calls.push(`start ${sport}`);
    if (this.throwOnStart) throw new Error('boom');
    if (this.startOutcome === 'confirmed' || this.startOutcome === 'sent') this.status = { ...this.status, active: true, sport, state: 'running' };
    return { outcome: this.startOutcome, code: this.startCode };
  }
  async pauseWatchWorkout(): Promise<WatchWorkoutResult> {
    this.calls.push('pause');
    if (this.operatorOutcome !== 'refused') this.status = { ...this.status, state: 'paused' };
    return { outcome: this.operatorOutcome, code: null };
  }
  async resumeWatchWorkout(): Promise<WatchWorkoutResult> {
    this.calls.push('resume');
    if (this.operatorOutcome !== 'refused') this.status = { ...this.status, state: 'running' };
    return { outcome: this.operatorOutcome, code: null };
  }
  async stopWatchWorkout(): Promise<WatchWorkoutResult> {
    this.calls.push('stop');
    this.status = { ...this.status, active: false, state: null };
    return { outcome: 'confirmed', code: null };
  }
}

function make(native: FakeNative | null = new FakeNative(), enabled = true) {
  const stops: string[] = [];
  const logs: string[] = [];
  let listener: ((bpm: number, ts: number) => void) | null = null;
  const band = new BandLink({
    native: () => native,
    enabled: () => enabled,
    heartRate: (l) => {
      listener = l;
      return () => {
        stops.push('hr off');
        listener = null;
      };
    },
    log: (m) => logs.push(m),
  });
  return { band, native, stops, logs, reading: (bpm: number) => listener?.(bpm, 1) };
}

/** Lets the band link's queued native calls (all resolved promises of the fake) run. */
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('bandSportCode', () => {
  it('uses the Huawei sport types of the sport table', () => {
    expect(bandSportCode('run')).toBe(1);
    expect(bandSportCode('walk')).toBe(2);
    expect(bandSportCode('ride')).toBe(3);
    expect(bandSportCode('treadmill')).toBe(5);
    expect(bandSportCode('indoorRide')).toBe(7);
    expect(bandSportCode('hike')).toBe(14);
  });

  it('has none for a sport the band has no workout for', () => {
    expect(bandSportCode('other')).toBeNull();
  });
});

describe('bandHeartRateHex', () => {
  it('is a heart-rate measurement with an 8-bit value', () => {
    expect(bandHeartRateHex(150)).toBe('0096');
  });

  it('refuses a reading that is no heart rate', () => {
    expect(bandHeartRateHex(0)).toBeNull();
    expect(bandHeartRateHex(300)).toBeNull();
    expect(bandHeartRateHex(Number.NaN)).toBeNull();
  });
});

describe('begin', () => {
  it('a confirmed start is linked, with the sport of the workout', async () => {
    const { band, native } = make();
    expect(await band.begin('run', () => {})).toBe('linked');
    expect(native!.calls).toEqual(['start 1']);
    expect(band.getSnapshot()).toMatchObject({ phase: 'linked', code: null });
  });

  it('a refusal keeps its code and the phone goes on alone', async () => {
    const native = new FakeNative();
    native.startOutcome = 'refused';
    native.startCode = 123002;
    const { band } = make(native);
    expect(await band.begin('run', () => {})).toBe('refused');
    expect(band.getSnapshot()).toMatchObject({ phase: 'refused', code: 123002 });
  });

  it('a start the band did not confirm is treated as not started', async () => {
    const native = new FakeNative();
    native.startOutcome = 'sent';
    const { band } = make(native);
    expect(await band.begin('run', () => {})).toBe('refused');
  });

  it('a throwing native call does not reject', async () => {
    const native = new FakeNative();
    native.throwOnStart = true;
    const { band } = make(native);
    expect(await band.begin('run', () => {})).toBe('refused');
  });

  it('a band that does not list the command cannot start from the phone, and the log says why', async () => {
    const native = new FakeNative();
    native.startOutcome = 'unsupported';
    native.status = { ...native.status, supported: false };
    const { band, logs } = make(native);
    expect(await band.begin('run', () => {})).toBe('unsupported');
    expect(band.getSnapshot().phase).toBe('unsupported');
    expect(logs.at(-1)).toContain(': unsupported (100000) (connected true, supported false) -> unsupported');
  });

  it('a start the native side found no connected band for waits for the band', async () => {
    const native = new FakeNative();
    native.startOutcome = 'not_connected';
    const { band, logs } = make(native);
    expect(await band.begin('run', () => {})).toBe('connecting');
    expect(native.calls).toEqual(['start 1']);
    expect(logs.at(-1)).toContain(': not_connected (100000) (connected true, supported true) -> connecting');
  });

  it('a band not connected at the start is not sent anything yet and waits', async () => {
    const native = new FakeNative();
    native.status = { ...native.status, connected: false };
    const { band, logs } = make(native);
    expect(await band.begin('run', () => {})).toBe('connecting');
    expect(native.calls).toEqual([]);
    expect(logs.at(-1)).toContain('not sent (connected false, supported true) -> connecting');
  });

  it('a build without the native functions is nobuild', async () => {
    const { band, logs } = make(null);
    expect(await band.begin('run', () => {})).toBe('nobuild');
    expect(logs.at(-1)).toContain('-> nobuild');
  });

  it('the setting off, or a sport without a band workout, is off and asks for nothing', async () => {
    const off = make(new FakeNative(), false);
    expect(await off.band.begin('run', () => {})).toBe('off');
    expect(off.native!.calls).toEqual([]);
    const other = make();
    expect(await other.band.begin('other', () => {})).toBe('off');
    expect(other.native!.calls).toEqual([]);
  });

  it('takes over a workout the phone already owns on the band instead of starting again', async () => {
    const native = new FakeNative();
    native.status = { ...native.status, active: true, sport: 1, state: 'paused' };
    const { band } = make(native);
    expect(await band.begin('run', () => {})).toBe('linked');
    expect(native.calls).toEqual([]);
    // Agreed state is the band's: a resume is sent, a pause is not.
    await band.setPaused(true);
    expect(native.calls).toEqual([]);
    await band.setPaused(false);
    expect(native.calls).toEqual(['resume']);
  });

  it('passes the heart rate on, also when the band refused to start', async () => {
    const native = new FakeNative();
    native.startOutcome = 'refused';
    const { band, reading } = make(native);
    const seen: number[] = [];
    await band.begin('run', (bpm) => seen.push(bpm));
    reading(142);
    expect(seen).toEqual([142]);
    expect(band.getSnapshot().hr).toBe(142);
  });
});

describe('a band not connected at the start', () => {
  function disconnected() {
    const native = new FakeNative();
    native.status = { ...native.status, connected: false };
    return make(native);
  }

  it('is started exactly once when it connects, never while the start is in flight', async () => {
    const { band, native } = disconnected();
    await band.begin('run', () => {});
    expect(band.poll()).toBeNull();
    expect(band.poll()).toBeNull();
    expect(native!.calls).toEqual([]);
    native!.status = { ...native!.status, connected: true };
    expect(band.poll()).toBeNull();
    expect(band.getSnapshot().phase).toBe('starting');
    expect(band.poll()).toBeNull();
    await flush();
    expect(native!.calls).toEqual(['start 1']);
    expect(band.getSnapshot().phase).toBe('linked');
    band.poll();
    band.poll();
    expect(native!.calls).toEqual(['start 1']);
  });

  it('a start that finds the band gone again waits for the next connect, one attempt each', async () => {
    const { band, native } = disconnected();
    await band.begin('run', () => {});
    native!.startOutcome = 'not_connected';
    native!.status = { ...native!.status, connected: true };
    band.poll();
    await flush();
    expect(band.getSnapshot().phase).toBe('connecting');
    // Still reading connected: no second attempt on the same connect.
    band.poll();
    await flush();
    expect(native!.calls).toEqual(['start 1']);
    native!.status = { ...native!.status, connected: false };
    band.poll();
    native!.startOutcome = 'confirmed';
    native!.status = { ...native!.status, connected: true };
    band.poll();
    await flush();
    expect(native!.calls).toEqual(['start 1', 'start 1']);
    expect(band.getSnapshot().phase).toBe('linked');
  });

  it('a band that connects but does not list the command is unsupported and not tried again', async () => {
    const { band, native } = disconnected();
    await band.begin('run', () => {});
    native!.startOutcome = 'unsupported';
    native!.status = { ...native!.status, connected: true, supported: false };
    band.poll();
    await flush();
    expect(band.getSnapshot().phase).toBe('unsupported');
    native!.status = { ...native!.status, connected: false };
    band.poll();
    native!.status = { ...native!.status, connected: true };
    band.poll();
    await flush();
    expect(native!.calls).toEqual(['start 1']);
  });

  it('waits for the resume when the recording is paused', async () => {
    const { band, native } = disconnected();
    await band.begin('run', () => {});
    await band.setPaused(true);
    native!.status = { ...native!.status, connected: true };
    band.poll();
    band.poll();
    await flush();
    expect(native!.calls).toEqual([]);
    expect(band.getSnapshot().phase).toBe('connecting');
    await band.setPaused(false);
    band.poll();
    await flush();
    expect(native!.calls).toEqual(['start 1']);
    expect(band.getSnapshot().phase).toBe('linked');
  });

  it('is given up when the recording ends', async () => {
    const { band, native } = disconnected();
    await band.begin('run', () => {});
    await band.end();
    native!.status = { ...native!.status, connected: true };
    expect(band.poll()).toBeNull();
    await flush();
    expect(native!.calls).toEqual([]);
    expect(band.getSnapshot().phase).toBe('off');
  });

  it('a start already queued when the recording ends sends nothing', async () => {
    const { band, native } = disconnected();
    await band.begin('run', () => {});
    const pending = band.setPaused(false);
    native!.status = { ...native!.status, connected: true };
    // A command is in flight: the poll waits.
    band.poll();
    expect(band.getSnapshot().phase).toBe('connecting');
    await pending;
    band.poll();
    expect(band.getSnapshot().phase).toBe('starting');
    // The recording ends before the queued start runs.
    await band.end();
    await flush();
    expect(native!.calls).toEqual([]);
    expect(band.getSnapshot().phase).toBe('off');
  });
});

describe('pause and resume', () => {
  it('are sent once per change, and only to a linked band', async () => {
    const { band, native } = make();
    await band.begin('run', () => {});
    await band.setPaused(true);
    await band.setPaused(true);
    await band.setPaused(false);
    await band.setPaused(false);
    expect(native!.calls).toEqual(['start 1', 'pause', 'resume']);
  });

  it('send nothing to a band that refused the start', async () => {
    const native = new FakeNative();
    native.startOutcome = 'refused';
    const { band } = make(native);
    await band.begin('run', () => {});
    await band.setPaused(true);
    expect(native.calls).toEqual(['start 1']);
  });

  it('a refused pause is not read back as the band resuming', async () => {
    const { band, native } = make();
    await band.begin('run', () => {});
    native!.operatorOutcome = 'refused';
    await band.setPaused(true);
    expect(band.poll()).toBeNull();
  });
});

describe('poll', () => {
  it('reports a pause, a resume and a stop the person did on the band, each once', async () => {
    const { band, native } = make();
    await band.begin('run', () => {});
    expect(band.poll()).toBeNull();
    native!.status = { ...native!.status, state: 'paused' };
    expect(band.poll()).toBe('pause');
    expect(band.poll()).toBeNull();
    native!.status = { ...native!.status, state: 'running' };
    expect(band.poll()).toBe('resume');
    expect(band.poll()).toBeNull();
    native!.status = { ...native!.status, active: false, state: null };
    expect(band.poll()).toBe('stop');
    expect(band.getSnapshot().phase).toBe('ended');
    expect(band.poll()).toBeNull();
  });

  it('does not take our own command for the band: nothing while a command is in flight', async () => {
    const { band, native } = make();
    await band.begin('run', () => {});
    const pending = band.setPaused(true);
    // The band's state has not caught up with the command yet; the poll is silent meanwhile.
    expect(band.poll()).toBeNull();
    await pending;
    expect(native!.calls).toEqual(['start 1', 'pause']);
    expect(band.poll()).toBeNull();
  });

  it('is silent when the band is not linked', async () => {
    const native = new FakeNative();
    native.startOutcome = 'refused';
    const { band } = make(native);
    await band.begin('run', () => {});
    expect(band.poll()).toBeNull();
  });
});

describe('end', () => {
  it('stops a linked band and its heart rate, back to off', async () => {
    const { band, native, stops } = make();
    await band.begin('run', () => {});
    await band.end();
    expect(native!.calls).toEqual(['start 1', 'stop']);
    expect(stops).toEqual(['hr off']);
    expect(band.getSnapshot()).toEqual({ phase: 'off', code: null, hr: null });
  });

  it('also releases a start the band never confirmed, so the live mirror works again', async () => {
    const native = new FakeNative();
    native.startOutcome = 'sent';
    const { band } = make(native);
    await band.begin('run', () => {});
    await band.end();
    expect(native.calls).toEqual(['start 1', 'stop']);
  });

  it('does not stop a workout the band ended itself, and does nothing when idle', async () => {
    const { band, native } = make();
    await band.begin('run', () => {});
    native!.status = { ...native!.status, active: false, state: null };
    band.poll();
    await band.end();
    expect(native!.calls).toEqual(['start 1']);
    await band.end();
    expect(native!.calls).toEqual(['start 1']);
  });
});

describe('adopt', () => {
  it('takes over an open band workout without starting anything', async () => {
    const native = new FakeNative();
    native.status = { ...native.status, active: true, sport: 1, state: 'running' };
    const { band } = make(native);
    expect(await band.adopt('run', () => {})).toBe('linked');
    expect(native.calls).toEqual([]);
    await band.setPaused(true);
    expect(native.calls).toEqual(['pause']);
  });

  it('is off when the band has no workout of ours, but the heart rate is asked', async () => {
    const { band, native, reading } = make();
    const seen: number[] = [];
    expect(await band.adopt('run', (bpm) => seen.push(bpm))).toBe('off');
    reading(120);
    expect(seen).toEqual([120]);
    expect(native!.calls).toEqual([]);
  });
});
