// Built-in demo route for the simulator and for showing the app without a phone. It produces the same phone -> watch
// messages JoyoFit sends (protocol/watch-nav.schema.json), fast-forwarded: one step per second, 40 m per step.

var STEP_M = 40;
var STEP_MS = 1000;
var SPEED_MPS = 2.8; // the ETA the phone would give for a run

// Each leg ends at the maneuver the wearer is told about while walking it.
var LEGS = [
  { dir: 'right', street: 'Jl. M.H. Thamrin', len: 360 },
  { dir: 'roundabout', street: 'Jl. Medan Merdeka Barat', exit: 2, len: 520 },
  { dir: 'slight_left', street: 'Jl. Majapahit', len: 280 },
  { dir: 'left', street: 'Jl. Juanda', len: 120 },
  { dir: 'right', street: 'Jl. Pos', len: 400 },
  { dir: 'arrive', street: 'Monas', len: 240 }
];

function turnMsg(i, distM) {
  var leg = LEGS[i];
  var m = { t: 'turn', dir: leg.dir, distM: distM, street: leg.street };
  if (leg.exit) m.exit = leg.exit;
  var after = LEGS[i + 1];
  if (after && after.len <= 150) m.next = { dir: after.dir, street: after.street };
  return m;
}

// [{ waitMs, msg }]: wait `waitMs` after the previous one, then deliver `msg` (without v/n; the runner adds those).
export function demoScript() {
  var total = 0;
  for (var k = 0; k < LEGS.length; k++) total += LEGS[k].len;
  var out = [];
  var walked = 0;
  function push(waitMs, msg) {
    out.push({ waitMs: waitMs, msg: msg });
  }
  push(0, { t: 'start', dest: 'Monas', totalM: total, etaS: Math.round(total / SPEED_MPS) });
  push(400, { t: 'turn', dir: 'depart', distM: 0, street: 'Jl. Kebon Sirih' });
  push(1500, turnMsg(0, LEGS[0].len));
  for (var i = 0; i < LEGS.length; i++) {
    var dist = LEGS[i].len;
    while (dist > 0) {
      var before = dist;
      dist = Math.max(0, dist - STEP_M);
      walked += before - dist;
      var rem = total - walked;
      var crossed = (before > 200 && dist <= 200) || (before > 50 && dist <= 50);
      if (crossed) push(STEP_MS, turnMsg(i, dist));
      push(crossed ? 100 : STEP_MS, { t: 'prog', distM: dist, remM: rem, etaS: Math.round(rem / SPEED_MPS) });
      // One detour on the long leg, to show the off-route and reroute banners.
      if (i === 1 && dist === 400) {
        push(STEP_MS, { t: 'off' });
        push(3000, { t: 'reroute' });
        push(2000, turnMsg(i, dist));
      }
    }
    if (i + 1 < LEGS.length) push(STEP_MS, turnMsg(i + 1, LEGS[i + 1].len));
  }
  push(STEP_MS, { t: 'arrive' });
  push(STEP_MS, { t: 'end', why: 'arrived' });
  return out;
}
