/**
 * One watch navigation session: plans the route (OSRM steps through the saved route when they follow it, else the route's own shape), starts
 * the native P2P service and the phone's GPS, feeds the engine with fixes, a 1 s tick and the watch app's messages, sends what the engine
 * returns (in order, one at a time), and reroutes through OSRM when the wearer left the route. Dependencies are injected (`instance.ts` wires
 * the real ones), so the flow runs under `bun test`.
 */
import { buildRouteIndex } from '@/features/bikecomputer/nav';
import type { RoutingClient, RoutingProfile } from '@/features/routes/map/routingClient';
import type { RoutePoint } from '@/features/routes/routeModel';
import type { WatchNavConfig, WatchNavEvent, WatchNavStatus } from '@/wear';

import { DEFAULT_SPEED_MPS, NavEngine, type EngineConfig, type NavFix, type NavView } from './engine';
import { followsRoute, navRouteFromGeometry, navRouteFromSteps, viaPoints, type NavRoute } from './maneuvers';
import { decodeWatchMessage, MessageEncoder, type EndReason, type PhoneMessage } from './messages';

export type NavActivity = keyof typeof DEFAULT_SPEED_MPS;

export const PROFILE_OF: Record<NavActivity, RoutingProfile> = { walk: 'foot', run: 'foot', ride: 'bike' };

export interface WatchNavNative {
  start(config: WatchNavConfig): Promise<WatchNavStatus>;
  send(json: string): Promise<boolean>;
  stop(): Promise<void>;
  status(): WatchNavStatus | null;
  onEvent(listener: (event: WatchNavEvent) => void): () => void;
}

export interface FixSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  onFix(listener: (fix: NavFix) => void): () => void;
}

export interface SessionDeps {
  native: WatchNavNative;
  location: FixSource;
  /** null: no routing at all (the route's own shape, no reroute). */
  routing: Pick<RoutingClient, 'navigate'> | null;
  config: WatchNavConfig;
  now: () => number;
  /** Calls `fn` every `ms` until the returned function is called. */
  every: (fn: () => void, ms: number) => () => void;
  log: (message: string, error?: boolean) => void;
  engineConfig?: Partial<EngineConfig>;
}

export interface StartInput {
  routeId: string;
  name: string;
  points: readonly RoutePoint[];
  activity: NavActivity;
  /** Ask OSRM for a new line after leaving the route. */
  reroute: boolean;
}

export type SessionPhase = 'idle' | 'planning' | 'running' | 'ended' | 'failed';

export interface SessionSnapshot {
  phase: SessionPhase;
  routeId: string | null;
  routeName: string | null;
  view: NavView | null;
  watch: WatchNavStatus | null;
  /** The watch app's version from its last `hello`. */
  watchAppVersion: string | null;
  error: string | null;
}

const IDLE: SessionSnapshot = { phase: 'idle', routeId: null, routeName: null, view: null, watch: null, watchAppVersion: null, error: null };
const TICK_MS = 1000;

export class WatchNavSession {
  private snap: SessionSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private engine: NavEngine | null = null;
  private encoder = new MessageEncoder();
  private queue: Promise<unknown> = Promise.resolve();
  private cleanups: (() => void)[] = [];
  private input: StartInput | null = null;
  private lastFix: NavFix | null = null;
  private lastWatchN: number | null = null;
  private rerouteAbort: AbortController | null = null;
  private finishing: Promise<void> | null = null;

  constructor(private readonly deps: SessionDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.snap;

  private set(patch: Partial<SessionSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  get running(): boolean {
    return this.snap.phase === 'planning' || this.snap.phase === 'running';
  }

  /** Plans the route and starts sending; resolves when the session runs (or failed: see the snapshot's `error`). */
  async start(input: StartInput): Promise<void> {
    if (this.running) await this.stop();
    this.input = input;
    this.encoder = new MessageEncoder();
    this.lastWatchN = null;
    this.lastFix = null;
    this.finishing = null;
    this.set({ ...IDLE, phase: 'planning', routeId: input.routeId, routeName: input.name });
    const route = await this.plan(input);
    if (this.snap.phase !== 'planning') return;
    try {
      const watch = await this.deps.native.start(this.deps.config);
      this.set({ watch });
      await this.deps.location.start();
    } catch (e) {
      await this.deps.native.stop().catch(() => {});
      this.fail(e);
      return;
    }
    const engine = new NavEngine(route, { dest: input.name, defaultSpeedMps: DEFAULT_SPEED_MPS[input.activity], config: this.deps.engineConfig });
    this.engine = engine;
    this.cleanups = [
      this.deps.native.onEvent((event) => this.onNative(event)),
      this.deps.location.onFix((fix) => this.onFix(fix)),
      this.deps.every(() => this.onTick(), TICK_MS),
    ];
    this.deps.log(`session start: "${input.name}", ${route.source} instructions, ${route.maneuvers.length} maneuvers, ${Math.round(route.index.totalM)} m`);
    this.send(engine.begin(this.deps.now()));
    this.set({ phase: 'running', view: engine.view() });
  }

  /** Ends the session from the phone: `end {why:"stopped"}`, then the service and the GPS stop. */
  async stop(why: EndReason = 'stopped'): Promise<void> {
    if (this.snap.phase === 'planning') {
      this.set({ phase: 'ended' });
      return;
    }
    if (!this.engine) return;
    this.send(this.engine.stop(why, this.deps.now()));
    await this.finish();
  }

  /** Forget an ended or failed session (the card goes away). */
  dismiss(): void {
    if (!this.running) this.set(IDLE);
  }

  private async plan(input: StartInput): Promise<NavRoute> {
    const { routing } = this.deps;
    if (routing === null) return navRouteFromGeometry(input.points);
    try {
      const answer = await routing.navigate(PROFILE_OF[input.activity], viaPoints(input.points));
      const route = navRouteFromSteps(answer);
      if (followsRoute(buildRouteIndex(input.points), route.index)) return route;
      this.deps.log("OSRM's line leaves the saved route; using the route's own shape");
    } catch (e) {
      this.deps.log(`routing unavailable (${e instanceof Error ? e.message : String(e)}); using the route's own shape`);
    }
    return navRouteFromGeometry(input.points);
  }

  private fail(e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    this.deps.log(`session failed: ${message}`, true);
    this.set({ phase: 'failed', error: message });
  }

  private send(messages: readonly PhoneMessage[]): void {
    for (const message of messages) {
      let encoded: { json: string; n: number };
      try {
        encoded = this.encoder.encode(message);
      } catch (e) {
        this.deps.log(`not encoded: ${e instanceof Error ? e.message : String(e)}`, true);
        continue;
      }
      this.queue = this.queue
        .then(() => this.deps.native.send(encoded.json))
        .catch((e: unknown) => this.deps.log(`send ${message.t} n=${encoded.n} failed: ${e instanceof Error ? e.message : String(e)}`, true));
    }
    if (messages.some((m) => m.t === 'end') && this.snap.phase === 'running') void this.finish();
  }

  /** Once per session, however many `end`s and stops arrive. */
  private finish(): Promise<void> {
    this.finishing ??= this.wrapUp();
    return this.finishing;
  }

  private async wrapUp(): Promise<void> {
    const engine = this.engine;
    this.engine = null;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.rerouteAbort?.abort();
    this.rerouteAbort = null;
    const view = engine?.view() ?? this.snap.view;
    this.set({ phase: 'ended', view });
    this.deps.log(`session end (${view?.endReason ?? 'stopped'})`);
    // The `end` message goes out before the service is unregistered.
    await this.queue;
    await Promise.allSettled([this.deps.native.stop(), this.deps.location.stop()]);
    this.set({ watch: this.deps.native.status() });
  }

  private refresh(): void {
    if (this.engine) this.set({ view: this.engine.view(), watch: this.deps.native.status() ?? this.snap.watch });
  }

  private onFix(fix: NavFix): void {
    const engine = this.engine;
    if (!engine) return;
    this.lastFix = fix;
    this.send(engine.update(fix, this.deps.now()));
    this.maybeReroute();
    this.refresh();
  }

  private onTick(): void {
    const engine = this.engine;
    if (!engine) return;
    this.send(engine.tick(this.deps.now()));
    this.maybeReroute();
    this.refresh();
  }

  private onNative(event: WatchNavEvent): void {
    const engine = this.engine;
    if (!engine) return;
    if (event.kind === 'presence') {
      this.refresh();
      return;
    }
    const message = decodeWatchMessage(event.json);
    if (message === null) {
      this.deps.log(`ignored from the watch app: ${event.json.slice(0, 120)}`);
      return;
    }
    // A P2P retry repeats the last n; a relaunched watch app starts again at 1 with `hello`.
    if (message.n === this.lastWatchN && message.t !== 'hello') return;
    this.lastWatchN = message.n;
    if (message.t === 'hello') this.set({ watchAppVersion: message.app });
    this.send(engine.watch(message, this.deps.now()));
    this.refresh();
  }

  private maybeReroute(): void {
    const engine = this.engine;
    const { routing } = this.deps;
    const fix = this.lastFix;
    if (!engine || !routing || !this.input?.reroute || !fix || !engine.wantsReroute(this.deps.now())) return;
    this.send(engine.beginReroute(this.deps.now()));
    const ahead = engine.remainingPoints();
    const waypoints = [{ lat: fix.lat, lon: fix.lon }, ...(ahead.length > 0 ? viaPoints(ahead, 49) : [])];
    const abort = new AbortController();
    this.rerouteAbort = abort;
    const profile = PROFILE_OF[this.input.activity];
    this.deps.log(`off route ${Math.round(engine.view().offM ?? 0)} m: rerouting through ${waypoints.length} points`);
    routing.navigate(profile, waypoints, abort.signal).then(
      (answer) => {
        if (this.engine !== engine || abort.signal.aborted) return;
        const route = navRouteFromSteps(answer);
        this.deps.log(`reroute: ${route.maneuvers.length} maneuvers, ${Math.round(route.index.totalM)} m`);
        this.send(engine.replaceRoute(route, this.deps.now()));
        this.refresh();
      },
      (e: unknown) => {
        if (this.engine !== engine) return;
        engine.rerouteFailed();
        this.deps.log(`reroute failed: ${e instanceof Error ? e.message : String(e)}`);
        this.refresh();
      },
    );
  }
}
