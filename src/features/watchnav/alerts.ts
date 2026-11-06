/**
 * Turn alerts for a workout the wearer runs on the watch with a route (the watch's own route navigation draws the line on its offline map,
 * but Huawei's route format has no instructions). The navigation engine runs as for JoyoNavi; instead of P2P messages its output becomes a
 * few short watch notifications from "JoyoFit": each turn when it is 200 m and 50 m away (the engine's bands), leaving the route, and
 * arriving. Everything else (`prog`, `hb`, `map`, far-away turns after the first) stays silent, so the workout screen is not covered every
 * few seconds. Pure: strings and the distance format come in.
 */
import type { Dir, PhoneMessage } from './messages';

export interface AlertStrings {
  /** The maneuver, e.g. "Turn right"; `exit` only for a roundabout. */
  action: (dir: Dir, exit?: number) => string;
  /** "450 m", "1.2 km". */
  distance: (m: number) => string;
  offRoute: string;
  offRouteBody: string;
  arrived: string;
}

export interface WatchAlert {
  title: string;
  body: string;
}

/** A turn at or under this distance is announced; the engine re-sends `turn` at 200 m and 50 m. */
const NEAR_M = 250;
/** ... and the 50 m band counts from this distance on. */
const NOW_M = 60;

export class TurnAlerts {
  private dest = '';
  private announced = new Set<string>();
  private firstTurn = true;
  private offAnnounced = false;

  constructor(private readonly strings: AlertStrings) {}

  /** The alert one engine message triggers, or null. */
  take(message: PhoneMessage): WatchAlert | null {
    const s = this.strings;
    switch (message.t) {
      case 'start':
        this.dest = message.dest;
        return null;
      case 'turn': {
        this.offAnnounced = false;
        if (message.dir === 'depart') return null;
        const band = message.distM <= NOW_M ? 'now' : message.distM <= NEAR_M ? 'near' : 'far';
        // A far turn is only worth a buzz as the first instruction of the workout ("first turn in 1.2 km").
        if (band === 'far' && !this.firstTurn) return null;
        this.firstTurn = false;
        const key = `${message.dir}|${message.street}|${message.exit ?? ''}|${band}`;
        if (this.announced.has(key)) return null;
        this.announced.add(key);
        if (this.announced.size > 200) this.announced.clear();
        const action = s.action(message.dir, message.exit);
        if (message.dir === 'arrive') return { title: `${s.distance(message.distM)} · ${action}`, body: this.dest };
        return { title: `${s.distance(message.distM)} · ${action}`, body: message.street };
      }
      case 'off':
        if (this.offAnnounced) return null;
        this.offAnnounced = true;
        return { title: s.offRoute, body: s.offRouteBody };
      case 'arrive':
        return { title: s.arrived, body: this.dest };
      default:
        return null;
    }
  }
}
