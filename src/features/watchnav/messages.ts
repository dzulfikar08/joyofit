/**
 * The messages between JoyoFit and the JoyoFit Navi watch app (`protocol/watch-nav.schema.json`): the types, the encoder that stamps the
 * envelope and keeps every message within the 1000-byte P2P payload, and the decoder of the watch app's messages. Pure.
 */

export const PROTOCOL_VERSION = 1;
/** Largest payload of one P2P data message, UTF-8 bytes. */
export const MAX_MESSAGE_BYTES = 1000;
/** `street` and `dest` are cut to this many characters (schema `maxLength`). */
export const MAX_NAME_CHARS = 48;
const MAX_SEQ = 2_147_483_647;

export const DIRS = [
  'depart',
  'straight',
  'slight_left',
  'left',
  'sharp_left',
  'slight_right',
  'right',
  'sharp_right',
  'uturn',
  'roundabout',
  'arrive',
] as const;
export type Dir = (typeof DIRS)[number];

export type EndReason = 'arrived' | 'stopped' | 'error';

/** Phone -> watch, without the envelope. */
export type PhoneMessage =
  | { t: 'start'; dest: string; totalM: number; etaS: number }
  | { t: 'turn'; dir: Dir; distM: number; street: string; exit?: number; next?: { dir: Dir; street: string } }
  | { t: 'prog'; distM: number; remM: number; etaS: number }
  | { t: 'off' }
  | { t: 'reroute' }
  | { t: 'arrive' }
  | { t: 'end'; why: EndReason }
  | { t: 'hb' };

/** Watch -> phone, with its sequence number. */
export type WatchMessage =
  | { t: 'hello'; n: number; app: string }
  | { t: 'pause'; n: number }
  | { t: 'resume'; n: number }
  | { t: 'stop'; n: number };

/** Cuts `name` to `MAX_NAME_CHARS` characters (code points, so no half emoji), trimmed. */
export function cutName(name: string): string {
  const chars = Array.from(name.trim());
  return chars.length <= MAX_NAME_CHARS ? chars.join('') : chars.slice(0, MAX_NAME_CHARS).join('').trimEnd();
}

const utf8 = new TextEncoder();

export function byteLength(text: string): number {
  return utf8.encode(text).length;
}

/** Distances and times are whole and never negative on the wire. */
function whole(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function normalise(message: PhoneMessage): PhoneMessage {
  switch (message.t) {
    case 'start':
      return { t: 'start', dest: cutName(message.dest), totalM: whole(message.totalM), etaS: whole(message.etaS) };
    case 'turn': {
      const turn: Extract<PhoneMessage, { t: 'turn' }> = { t: 'turn', dir: message.dir, distM: whole(message.distM), street: cutName(message.street) };
      if (message.exit !== undefined) turn.exit = message.exit;
      if (message.next) turn.next = { dir: message.next.dir, street: cutName(message.next.street) };
      return turn;
    }
    case 'prog':
      return { t: 'prog', distM: whole(message.distM), remM: whole(message.remM), etaS: whole(message.etaS) };
    default:
      return message;
  }
}

/**
 * Stamps `v` and `n` (1, 2, ... per session, back to 1 after 2^31 - 1) and serialises. Names are cut to 48 characters; should a message still
 * exceed 1000 bytes (it cannot with the schema's limits, but the check is the contract), `encode` throws instead of sending a truncated one.
 */
export class MessageEncoder {
  private seq = 0;

  /** The `n` the next message gets. */
  get next(): number {
    return this.seq >= MAX_SEQ ? 1 : this.seq + 1;
  }

  encode(message: PhoneMessage): { json: string; n: number; bytes: number } {
    const n = this.next;
    const { t, ...fields } = normalise(message);
    const json = JSON.stringify({ v: PROTOCOL_VERSION, t, n, ...fields });
    const bytes = byteLength(json);
    if (bytes > MAX_MESSAGE_BYTES) throw new Error(`watch-nav ${message.t} is ${bytes} bytes, more than ${MAX_MESSAGE_BYTES}`);
    this.seq = n;
    return { json, n, bytes };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The watch app's message, or null for anything else (bad JSON, another version, unknown type, missing fields); the caller logs and ignores it. */
export function decodeWatchMessage(json: string): WatchMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObject(raw) || raw.v !== PROTOCOL_VERSION) return null;
  const { t, n } = raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_SEQ) return null;
  switch (t) {
    case 'hello':
      return typeof raw.app === 'string' ? { t, n, app: raw.app } : null;
    case 'pause':
    case 'resume':
    case 'stop':
      return { t, n };
    default:
      return null;
  }
}
