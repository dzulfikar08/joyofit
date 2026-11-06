// Draws a `map` frame (protocol/watch-nav.schema.json) on the lite canvas: the route line, the next maneuver and the
// wearer's arrow. The phone already turned the frame heading-up and cut it to the view, so this only scales and
// strokes. Only calls the lite canvas has (ace_engine_lite canvas_component.cpp): fillRect, beginPath, moveTo, lineTo,
// closePath, stroke, fill, arc. Plain ES5; bun runs it in watch-app/navi/test with a fake context.

var ROUTE = '#58c4de';
var TURN = '#5fd08d';
var ME = '#f5f1e8';
var BG = '#000000';

// Where the wearer sits on the canvas: centred, 70% down, so more of the way ahead shows.
var ME_Y = 0.7;
// `r` metres ahead reach this share of the canvas height above the wearer.
var REACH = 0.62;

export function mapScale(map, height) {
  return (height * REACH) / map.r;
}

// Canvas coordinates of frame point (x, y).
export function toCanvas(map, width, height, x, y) {
  var k = mapScale(map, height);
  return { x: width / 2 + x * k, y: height * ME_Y - y * k };
}

export function drawMap(ctx, map, width, height) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  if (map && map.p.length >= 4) {
    ctx.strokeStyle = ROUTE;
    ctx.lineWidth = 10;
    ctx.beginPath();
    var first = toCanvas(map, width, height, map.p[0], map.p[1]);
    ctx.moveTo(first.x, first.y);
    for (var i = 2; i < map.p.length; i += 2) {
      var q = toCanvas(map, width, height, map.p[i], map.p[i + 1]);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  }
  if (map && map.hasT) {
    var t = toCanvas(map, width, height, map.tx, map.ty);
    ctx.fillStyle = TURN;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 11, 0, 6.2832);
    ctx.fill();
  }
  // The wearer: an arrow pointing up (the frame is heading-up).
  var cx = width / 2;
  var cy = height * ME_Y;
  ctx.fillStyle = ME;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 18);
  ctx.lineTo(cx + 13, cy + 13);
  ctx.lineTo(cx, cy + 6);
  ctx.lineTo(cx - 13, cy + 13);
  ctx.closePath();
  ctx.fill();
}
