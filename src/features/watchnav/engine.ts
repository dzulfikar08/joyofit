/**
 * The phone's navigation engine for the watch: GPS fixes and the watch app's messages in, the messages for the watch out
 * (`protocol/watch-nav.schema.json`). It matches every fix to the route line (`project` of the bike computer's route index), keeps the
 * current and next instruction, the distance to it, the distance left and an ETA from the recent speed, detects leaving the route
 * (> 40 m for 10 s) and arriving, and throttles what it sends:
 * - `turn` when the instruction changes, when the distance to it first drops to 200 m and to 50 m, and after `off` ends;
 * - `prog` at most every 5 s (only when a number changed), sooner when the distance to the turn changed by 10% (at least 5 m);
 * - `hb` after 30 s without any message.
 * Pure: time comes in as arguments; the session (`session.ts`) sends what it returns.
 */
import { haversineM, type RoutePoint } from '@/features/routes/routeModel';
import { project } from '@/features/bikecomputer/nav';

import type { NavManeuver, NavRoute } from './maneuvers';
import type { EndReason, PhoneMessage, WatchMessage } from './messages';

export interface NavFix {
  /** Epoch ms of the fix. */
  ts: number;
  lat: number;
  lon: number;
  /** m/s; null when the platform gave none. */
  speedMps: number | null;
  /** Horizontal accuracy, metres; null when unknown. */
  accuracy: number | null;
}

export interface EngineConfig {
  /** Farther than this from the line counts towards off route, metres. */
  offRouteM: number;
  /** ... for this long, ms. */
  offRouteDwellMs: number;
  /** Back within this distance ends off route, metres. */
  backOnRouteM: number;
  /** This close to the end along the route is arrival, metres. */
  arriveM: number;
  /** A maneuver this far behind the wearer is passed, metres. */
  passedM: number;
  progMinIntervalMs: number;
  progChangeRatio: number;
  progMinChangeM: number;
  /** A `prog` triggered by the 10% rule waits at least this long after the last one, ms. */
  progBurstMs: number;
  hbIntervalMs: number;
  /** `next` is sent when the following maneuver is this close after the current one, metres. */
  nextWithinM: number;
  /** Distances at which `turn` is sent again (the watch vibrates at 200 and 50 m). */
  bandsM: readonly number[];
  /** Fixes less accurate than this are not matched (the recorder's limit), metres. */
  maxAccuracyM: number;
  speedWindowMs: number;
  /** Below this average speed the ETA keeps the last moving speed, m/s. */
  minSpeedMps: number;
  /** No usable fix for this long ends the session with `end {why:"error"}`, ms. */
  lostAfterMs: number;
  /** A reroute is asked at most this often, ms. */
  rerouteIntervalMs: number;
}

export const ENGINE_DEFAULTS: EngineConfig = {
  offRouteM: 40,
  offRouteDwellMs: 10_000,
  backOnRouteM: 25,
  arriveM: 20,
  passedM: 5,
  progMinIntervalMs: 5_000,
  progChangeRatio: 0.1,
  progMinChangeM: 5,
  progBurstMs: 1_000,
  hbIntervalMs: 30_000,
  nextWithinM: 150,
  bandsM: [200, 50],
  maxAccuracyM: 35,
  speedWindowMs: 30_000,
  minSpeedMps: 0.5,
  lostAfterMs: 300_000,
  rerouteIntervalMs: 30_000,
};

/** Speeds for the ETA before the wearer moved, m/s (schema `start.etaS`). */
export const DEFAULT_SPEED_MPS = { walk: 1.4, run: 2.8, ride: 5 } as const;

export type NavPhase = 'navigating' | 'paused' | 'offRoute' | 'ended';

/** What the phone's status card shows. */
export interface NavView {
  phase: NavPhase;
  endReason: EndReason | null;
  maneuver: NavManeuver | null;
  next: NavManeuver | null;
  /** Metres along the route to `maneuver`. */
  distToTurnM: number | null;
  remainingM: number;
  etaS: number;
  /** Metres from the line at the last usable fix; null before one. */
  offM: number | null;
  /** A fix was matched to the route at least once. */
  matched: boolean;
  rerouting: boolean;
  source: NavRoute['source'];
}

interface SpeedSample {
  ts: number;
  mps: number;
}

export class NavEngine {
  private route: NavRoute;
  private readonly cfg: EngineConfig;
  private readonly dest: string;
  private readonly defaultSpeedMps: number;

  private doneM = 0;
  private matched = false;
  private offM: number | null = null;
  private offSince: number | null = null;
  private offRoute = false;
  private offSent = false;
  private paused = false;
  private ended: EndReason | null = null;
  private rerouting = false;
  private lastRerouteAt: number | null = null;

  private samples: SpeedSample[] = [];
  private prevFix: NavFix | null = null;
  private movingSpeed: number | null = null;
  private lastFixAt: number | null = null;
  private startedAt = 0;

  private lastSentAt: number | null = null;
  private turnIndex = -1;
  private turnBand = -1;
  private progAt: number | null = null;
  private progDist = 0;
  private progKey = '';

  constructor(route: NavRoute, options: { dest: string; defaultSpeedMps: number; config?: Partial<EngineConfig> }) {
    this.route = route;
    this.dest = options.dest;
    this.defaultSpeedMps = options.defaultSpeedMps;
    this.cfg = { ...ENGINE_DEFAULTS, ...options.config };
  }

  get isEnded(): boolean {
    return this.ended !== null;
  }

  /** The first messages of a session: `start`, the first `turn` and a `prog`. */
  begin(nowMs: number): PhoneMessage[] {
    this.startedAt = nowMs;
    return this.sent(this.snapshot(nowMs), nowMs);
  }

  update(fix: NavFix, nowMs: number): PhoneMessage[] {
    if (this.ended) return [];
    if (fix.accuracy === null || fix.accuracy <= this.cfg.maxAccuracyM) {
      this.lastFixAt = nowMs;
      this.match(fix, nowMs);
    }
    this.trackSpeed(fix);
    return this.sent(this.step(nowMs), nowMs);
  }

  /** Called about once a second: off route without new fixes, a lost location, the heartbeat. */
  tick(nowMs: number): PhoneMessage[] {
    if (this.ended) return [];
    if (nowMs - (this.lastFixAt ?? this.startedAt) >= this.cfg.lostAfterMs) return this.stop('error', nowMs);
    const out = this.step(nowMs);
    if (out.length === 0 && nowMs - (this.lastSentAt ?? -Infinity) >= this.cfg.hbIntervalMs) out.push({ t: 'hb' });
    return this.sent(out, nowMs);
  }

  /** The watch app's messages: `hello` and `resume` get the whole state again, `pause` silences turns, `stop` ends the session. */
  watch(message: WatchMessage, nowMs: number): PhoneMessage[] {
    if (this.ended) return [];
    switch (message.t) {
      case 'hello':
      case 'resume':
        this.paused = false;
        return this.sent(this.snapshot(nowMs), nowMs);
      case 'pause':
        this.paused = true;
        return [];
      case 'stop':
        return this.stop('stopped', nowMs);
    }
  }

  /** Ends the session once; later calls return nothing. */
  stop(why: EndReason, nowMs: number): PhoneMessage[] {
    if (this.ended) return [];
    this.ended = why;
    return this.sent([{ t: 'end', why }], nowMs);
  }

  /** Off route, no reroute running and the last one long enough ago: the session may ask OSRM for a new line. */
  wantsReroute(nowMs: number): boolean {
    return (
      !this.ended &&
      this.offRoute &&
      !this.rerouting &&
      (this.lastRerouteAt === null || nowMs - this.lastRerouteAt >= this.cfg.rerouteIntervalMs)
    );
  }

  /** The session asked for a new line: tells the watch (`reroute`). */
  beginReroute(nowMs: number): PhoneMessage[] {
    if (this.ended) return [];
    this.rerouting = true;
    this.lastRerouteAt = nowMs;
    return this.sent(this.paused ? [] : [{ t: 'reroute' }], nowMs);
  }

  /** The reroute failed: the wearer stays off route; another try after `rerouteIntervalMs`. */
  rerouteFailed(): void {
    this.rerouting = false;
  }

  /** A new line from where the wearer is: progress restarts on it and a fresh `turn` and `prog` go out. */
  replaceRoute(route: NavRoute, nowMs: number): PhoneMessage[] {
    if (this.ended) return [];
    this.route = route;
    this.rerouting = false;
    this.doneM = 0;
    this.matched = false;
    this.offRoute = false;
    this.offSent = false;
    this.offSince = null;
    this.turnIndex = -1;
    this.turnBand = -1;
    this.progAt = null;
    if (this.prevFix) this.match(this.prevFix, nowMs);
    return this.sent(this.step(nowMs), nowMs);
  }

  /** The part of the line still ahead of the matched position (for a reroute's waypoints). */
  remainingPoints(): RoutePoint[] {
    const { line, index } = this.route;
    return line.filter((_, i) => index.cumM[i]! > this.doneM);
  }

  view(): NavView {
    const idx = this.currentIndex();
    const maneuver = this.route.maneuvers[idx] ?? null;
    return {
      phase: this.ended ? 'ended' : this.offRoute ? 'offRoute' : this.paused ? 'paused' : 'navigating',
      endReason: this.ended,
      maneuver,
      next: this.route.maneuvers[idx + 1] ?? null,
      distToTurnM: maneuver ? Math.max(0, maneuver.atM - this.doneM) : null,
      remainingM: this.remainingM(),
      etaS: this.etaS(),
      offM: this.offM,
      matched: this.matched,
      rerouting: this.rerouting,
      source: this.route.source,
    };
  }

  // -------------------------------------------------------------------------------------------------------------------

  private sent(messages: PhoneMessage[], nowMs: number): PhoneMessage[] {
    if (messages.length > 0) this.lastSentAt = nowMs;
    return messages;
  }

  private remainingM(): number {
    return Math.max(0, this.route.index.totalM - this.doneM);
  }

  private etaS(): number {
    return Math.round(this.remainingM() / (this.movingSpeed ?? this.defaultSpeedMps));
  }

  private match(fix: NavFix, nowMs: number): void {
    // Always hinted from the matched progress (0 at the start), so a loop's start does not match its finish.
    const proj = project(this.route.index, fix.lat, fix.lon, { atM: this.doneM, windowM: 1500 });
    this.offM = proj.offM;
    if (proj.offM > this.cfg.offRouteM) this.offSince ??= nowMs;
    else this.offSince = null;
    const limit = this.offRoute ? this.cfg.backOnRouteM : this.cfg.offRouteM;
    if (proj.offM <= limit) {
      this.doneM = proj.atM;
      this.matched = true;
      if (this.offRoute) {
        this.offRoute = false;
        this.offSent = false;
        this.turnIndex = -1;
      }
    }
  }

  private trackSpeed(fix: NavFix): void {
    let mps = fix.speedMps;
    if (mps === null || !Number.isFinite(mps)) {
      const prev = this.prevFix;
      const dt = prev ? (fix.ts - prev.ts) / 1000 : 0;
      mps = prev && dt > 0 ? haversineM(prev, fix) / dt : null;
    }
    this.prevFix = fix;
    if (mps !== null) this.samples.push({ ts: fix.ts, mps: Math.max(0, mps) });
    const cutoff = fix.ts - this.cfg.speedWindowMs;
    this.samples = this.samples.filter((s) => s.ts >= cutoff);
    // The ETA uses the pace while moving: a stop at a crossing does not stretch it.
    const moving = this.samples.filter((s) => s.mps >= this.cfg.minSpeedMps);
    if (moving.length > 0) this.movingSpeed = moving.reduce((sum, s) => sum + s.mps, 0) / moving.length;
  }

  /** The first maneuver not yet passed; the `arrive` at the end is never passed. */
  private currentIndex(): number {
    const list = this.route.maneuvers;
    for (let i = 0; i < list.length; i++) {
      if (list[i]!.atM + this.cfg.passedM > this.doneM || i === list.length - 1) return i;
    }
    return list.length - 1;
  }

  private band(distM: number): number {
    return this.cfg.bandsM.filter((limit) => distM <= limit).length;
  }

  private turnMessage(idx: number): PhoneMessage | null {
    const list = this.route.maneuvers;
    const maneuver = list[idx];
    if (!maneuver) return null;
    const distM = Math.max(0, maneuver.atM - this.doneM);
    this.turnIndex = idx;
    this.turnBand = this.band(distM);
    this.progDist = distM;
    const turn: Extract<PhoneMessage, { t: 'turn' }> = { t: 'turn', dir: maneuver.dir, distM, street: maneuver.street };
    if (maneuver.exit !== undefined) turn.exit = maneuver.exit;
    const following = list[idx + 1];
    if (following && following.atM - maneuver.atM <= this.cfg.nextWithinM) turn.next = { dir: following.dir, street: following.street };
    return turn;
  }

  private progMessage(nowMs: number): PhoneMessage {
    const maneuver = this.route.maneuvers[this.currentIndex()];
    const distM = maneuver ? Math.max(0, maneuver.atM - this.doneM) : 0;
    const prog: PhoneMessage = { t: 'prog', distM, remM: this.remainingM(), etaS: this.etaS() };
    this.progAt = nowMs;
    this.progDist = distM;
    this.progKey = `${Math.round(distM)}|${Math.round(prog.remM)}|${prog.etaS}`;
    return prog;
  }

  /** `start`, the current `turn`, a `prog`, and `off` when off route: what a watch that just (re)opened needs. */
  private snapshot(nowMs: number): PhoneMessage[] {
    const out: PhoneMessage[] = [{ t: 'start', dest: this.dest, totalM: this.remainingM(), etaS: this.etaS() }];
    const turn = this.turnMessage(this.currentIndex());
    if (turn) out.push(turn);
    out.push(this.progMessage(nowMs));
    if (this.offRoute) {
      out.push({ t: 'off' });
      this.offSent = true;
    }
    return out;
  }

  /** What changed since the last messages. */
  private step(nowMs: number): PhoneMessage[] {
    if (!this.offRoute && this.offSince !== null && nowMs - this.offSince >= this.cfg.offRouteDwellMs) this.offRoute = true;
    if (this.paused) return [];
    if (this.offRoute) {
      if (this.offSent) return [];
      this.offSent = true;
      return [{ t: 'off' }];
    }
    if (this.matched && this.remainingM() <= this.cfg.arriveM) {
      this.ended = 'arrived';
      return [{ t: 'arrive' }, { t: 'end', why: 'arrived' }];
    }
    const out: PhoneMessage[] = [];
    const idx = this.currentIndex();
    const maneuver = this.route.maneuvers[idx];
    const distM = maneuver ? Math.max(0, maneuver.atM - this.doneM) : 0;
    if (idx !== this.turnIndex || this.band(distM) > this.turnBand) {
      const turn = this.turnMessage(idx);
      if (turn) out.push(turn);
    }
    const sinceProg = this.progAt === null ? Infinity : nowMs - this.progAt;
    const key = `${Math.round(distM)}|${Math.round(this.remainingM())}|${this.etaS()}`;
    const jump = Math.abs(distM - this.progDist);
    const big = jump >= Math.max(this.cfg.progMinChangeM, this.cfg.progChangeRatio * this.progDist);
    if ((sinceProg >= this.cfg.progMinIntervalMs && key !== this.progKey) || (big && sinceProg >= this.cfg.progBurstMs)) {
      out.push(this.progMessage(nowMs));
    }
    return out;
  }
}
