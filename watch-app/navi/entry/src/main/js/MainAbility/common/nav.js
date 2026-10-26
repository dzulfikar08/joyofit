// Navigation state for the watch, driven by protocol/watch-nav.schema.json (version 1).
// Plain ES5 plus import/export: the lite-wearable JS engine (JerryScript) runs the bundle DevEco's build makes, and bun
// runs watch-app/navi/test against this same file.

export var DIRS = ['depart', 'straight', 'slight_left', 'left', 'sharp_left', 'slight_right', 'right', 'sharp_right',
  'uturn', 'roundabout', 'arrive'];

export var LOST_AFTER_MS = 90000; // no message for 90 s while navigating -> "phone disconnected"
export var NEAR_M = 200; // one short vibration
export var NOW_M = 50; // one long vibration
export var MAX_N = 2147483647;

// A maneuver counts as a new one when its dir/street/exit changes, or when the distance to it grows by more than
// this (the phone re-sends the same `turn` at 200 m and 50 m; a bigger jump means the next, identical-looking turn).
var NEW_TURN_JUMP_M = 60;

export function createState() {
  return {
    screen: 'idle', // idle | nav | arrived
    ended: '', // '' | stopped | error: why the last session ended, shown on idle
    dest: '',
    remM: -1,
    etaS: -1,
    hasTurn: false,
    dir: 'straight',
    distM: 0,
    street: '',
    exit: 0,
    hasNext: false,
    nextDir: 'straight',
    nextStreet: '',
    off: false,
    rerouting: false,
    paused: false,
    lost: false,
    lastRxMs: 0,
    lastN: 0,
    turnKey: '',
    vibNear: false,
    vibNow: false
  };
}

function isUint(x) {
  return typeof x === 'number' && x >= 0 && Math.floor(x) === x;
}

function str(x) {
  return typeof x === 'string' ? x : '';
}

function dirOf(x) {
  return DIRS.indexOf(x) >= 0 ? x : 'straight';
}

// Text (or UTF-8 bytes) from P2P to a message object, or null when it is not a version-1 envelope.
export function parse(raw) {
  var text = typeof raw === 'string' ? raw : utf8Decode(raw);
  if (!text) return null;
  var m;
  try {
    m = JSON.parse(text);
  } catch (e) {
    return null;
  }
  if (!m || typeof m !== 'object' || m.v !== 1 || typeof m.t !== 'string' || !isUint(m.n) || m.n < 1) return null;
  return m;
}

// Minimal UTF-8 decoder for a byte array (the lite JS engine has no TextDecoder).
export function utf8Decode(bytes) {
  if (!bytes || typeof bytes.length !== 'number') return '';
  var out = '';
  var i = 0;
  while (i < bytes.length) {
    var b = bytes[i++] & 0xff;
    var cp;
    if (b < 0x80) cp = b;
    else if (b >= 0xc0 && b < 0xe0) cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (b >= 0xe0 && b < 0xf0) {
      cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    } else if (b >= 0xf0) {
      cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    } else cp = 0xfffd;
    if (cp > 0xffff) {
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else out += String.fromCharCode(cp);
  }
  return out;
}

function clearSession(s) {
  s.dest = '';
  s.remM = -1;
  s.etaS = -1;
  s.hasTurn = false;
  s.hasNext = false;
  s.off = false;
  s.rerouting = false;
  s.paused = false;
  s.lost = false;
  s.turnKey = '';
  s.vibNear = false;
  s.vibNow = false;
}

function enterNav(s) {
  if (s.screen !== 'nav') {
    s.screen = 'nav';
    s.ended = '';
  }
}

// The vibration the current distance asks for: 'long' once at <= 50 m, 'short' once at <= 200 m, else ''.
// No buzz for `depart` (it is "head off", not a point to act at) or while the wearer paused guidance.
function vibration(s) {
  if (!s.hasTurn || s.paused || s.dir === 'depart') return '';
  if (s.distM <= NOW_M && !s.vibNow) {
    s.vibNow = true;
    s.vibNear = true;
    return 'long';
  }
  if (s.distM <= NEAR_M && !s.vibNear) {
    s.vibNear = true;
    return 'short';
  }
  return '';
}

// Applies one phone -> watch message. Returns the vibration it triggers ('', 'short' or 'long');
// a dropped message (retry, unknown type) returns ''.
export function receive(s, m, nowMs) {
  if (m.n === s.lastN) return ''; // P2P retry of the message we already took
  s.lastN = m.n;
  s.lastRxMs = nowMs;
  s.lost = false;
  switch (m.t) {
    case 'start':
      if (s.screen !== 'nav') clearSession(s);
      enterNav(s);
      s.dest = str(m.dest);
      if (isUint(m.totalM)) s.remM = m.totalM;
      if (isUint(m.etaS)) s.etaS = m.etaS;
      s.paused = false;
      return '';
    case 'turn': {
      enterNav(s);
      var dir = dirOf(m.dir);
      var street = str(m.street);
      var exit = dir === 'roundabout' && isUint(m.exit) ? m.exit : 0;
      var dist = isUint(m.distM) ? m.distM : 0;
      var key = dir + '|' + street + '|' + exit;
      if (key !== s.turnKey || !s.hasTurn || dist > s.distM + NEW_TURN_JUMP_M) {
        s.turnKey = key;
        s.vibNear = false;
        s.vibNow = false;
      }
      s.hasTurn = true;
      s.dir = dir;
      s.street = street;
      s.exit = exit;
      s.distM = dist;
      var next = m.next;
      s.hasNext = !!(next && typeof next === 'object');
      s.nextDir = s.hasNext ? dirOf(next.dir) : 'straight';
      s.nextStreet = s.hasNext ? str(next.street) : '';
      // A fresh turn follows a reroute, or comes when the wearer is back on the route.
      s.off = false;
      s.rerouting = false;
      return vibration(s);
    }
    case 'prog':
      enterNav(s);
      if (isUint(m.distM)) s.distM = m.distM;
      if (isUint(m.remM)) s.remM = m.remM;
      if (isUint(m.etaS)) s.etaS = m.etaS;
      return vibration(s);
    case 'off':
      enterNav(s);
      s.off = true;
      return '';
    case 'reroute':
      enterNav(s);
      s.rerouting = true;
      return '';
    case 'arrive':
      s.screen = 'arrived';
      return '';
    case 'end':
      if (m.why === 'arrived') {
        s.screen = 'arrived';
      } else {
        clearSession(s);
        s.screen = 'idle';
        s.ended = m.why === 'error' ? 'error' : 'stopped';
      }
      return '';
    case 'hb':
      return '';
    default:
      return ''; // unknown type: ignored, never answered
  }
}

// Watchdog: call every few seconds. Returns true when the "phone disconnected" flag changed.
export function tick(s, nowMs) {
  var lost = s.screen === 'nav' && s.lastRxMs > 0 && nowMs - s.lastRxMs >= LOST_AFTER_MS;
  if (lost === s.lost) return false;
  s.lost = lost;
  return true;
}

// Local state changes for the wearer's own actions (the matching message goes to the phone separately).
export function localPause(s) {
  s.paused = true;
}

export function localResume(s) {
  s.paused = false;
}

export function localStop(s) {
  clearSession(s);
  s.screen = 'idle';
  s.ended = 'stopped';
}

export function backToIdle(s) {
  clearSession(s);
  s.screen = 'idle';
  s.ended = '';
}

// Watch -> phone envelopes. `seq` is { n } shared by the app launch; it starts at 1 and wraps after MAX_N.
export function outgoing(seq, t, fields) {
  seq.n = seq.n >= MAX_N ? 1 : seq.n + 1;
  var m = { v: 1, t: t, n: seq.n };
  if (fields) {
    for (var k in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) m[k] = fields[k];
    }
  }
  return JSON.stringify(m);
}
