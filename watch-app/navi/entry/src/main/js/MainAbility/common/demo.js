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

// Map frames for the demo, as the phone would send them (map view): the legs laid out as a polyline, heading-up.
var MAP_R = 200;
var TURN_DEG = { right: 90, left: -90, slight_left: -35, slight_right: 35, sharp_left: -135, sharp_right: 135, uturn: 180, roundabout: 30 };

function corners() {
  var x = 0;
  var y = 0;
  var h = 0;
  var out = [{ x: 0, y: 0 }];
  for (var i = 0; i < LEGS.length; i++) {
    var rad = (h * Math.PI) / 180;
    x += LEGS[i].len * Math.sin(rad);
    y += LEGS[i].len * Math.cos(rad);
    out.push({ x: x, y: y });
    h += TURN_DEG[LEGS[i].dir] || 0;
  }
  return out;
}

// The frame for a wearer `walked` metres along the demo route.
export function demoMap(walked) {
  var cs = corners();
  var k = 0;
  var done = 0;
  while (k < LEGS.length - 1 && done + LEGS[k].len < walked) {
    done += LEGS[k].len;
    k++;
  }
  var a = cs[k];
  var b = cs[k + 1];
  var f = Math.min(1, (walked - done) / LEGS[k].len);
  var px = a.x + (b.x - a.x) * f;
  var py = a.y + (b.y - a.y) * f;
  var h = Math.atan2(b.x - a.x, b.y - a.y);
  var sin = Math.sin(h);
  var cos = Math.cos(h);
  var p = [];
  for (var i = 0; i < cs.length; i++) {
    var dx = cs[i].x - px;
    var dy = cs[i].y - py;
    p.push(Math.round(dx * cos - dy * sin), Math.round(dx * sin + dy * cos));
  }
  var tdx = b.x - px;
  var tdy = b.y - py;
  return { t: 'map', r: MAP_R, p: p, tx: Math.round(tdx * cos - tdy * sin), ty: Math.round(tdx * sin + tdy * cos) };
}

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
      push(0, demoMap(walked));
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
