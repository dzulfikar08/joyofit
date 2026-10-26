import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  createState, parse, receive, tick, localStop, outgoing, utf8Decode, LOST_AFTER_MS, MAX_N
} from '../entry/src/main/js/MainAbility/common/nav.js';
import { distance, duration, present } from '../entry/src/main/js/MainAbility/common/format.js';
import { stringsFor } from '../entry/src/main/js/MainAbility/common/strings.js';
import { demoScript } from '../entry/src/main/js/MainAbility/common/demo.js';

var n = 0;
function msg(t, fields) {
  n += 1;
  return Object.assign({ v: 1, t: t, n: n }, fields || {});
}

function navigating() {
  var s = createState();
  receive(s, msg('start', { dest: 'Monas', totalM: 2000, etaS: 700 }), 1000);
  return s;
}

describe('parse', () => {
  test('takes a version-1 envelope from text or UTF-8 bytes', () => {
    var text = '{"v":1,"t":"turn","n":3,"dir":"left","distM":120,"street":"Jl. Gajah Mada – Ruas"}';
    expect(parse(text).street).toBe('Jl. Gajah Mada – Ruas');
    expect(parse(Array.from(new TextEncoder().encode(text))).street).toBe('Jl. Gajah Mada – Ruas');
  });
  test('drops other versions, missing n and junk', () => {
    expect(parse('{"v":2,"t":"hb","n":1}')).toBeNull();
    expect(parse('{"v":1,"t":"hb"}')).toBeNull();
    expect(parse('{"v":1,"t":"hb","n":0}')).toBeNull();
    expect(parse('nope')).toBeNull();
  });
  test('decodes 4-byte UTF-8', () => {
    expect(utf8Decode(Array.from(new TextEncoder().encode('a😀b')))).toBe('a😀b');
  });
});

describe('receive', () => {
  test('start shows the navigation screen with totals', () => {
    var s = navigating();
    expect(s.screen).toBe('nav');
    expect(s.dest).toBe('Monas');
    expect(s.remM).toBe(2000);
    expect(s.hasTurn).toBe(false);
  });

  test('vibrates once at <= 200 m and once at <= 50 m per maneuver', () => {
    var s = navigating();
    expect(receive(s, msg('turn', { dir: 'right', distM: 400, street: 'Jl. Thamrin' }), 2000)).toBe('');
    expect(receive(s, msg('prog', { distM: 300, remM: 1900, etaS: 650 }), 3000)).toBe('');
    expect(receive(s, msg('turn', { dir: 'right', distM: 190, street: 'Jl. Thamrin' }), 4000)).toBe('short');
    expect(receive(s, msg('prog', { distM: 150, remM: 1750, etaS: 600 }), 5000)).toBe('');
    expect(receive(s, msg('prog', { distM: 45, remM: 1650, etaS: 560 }), 6000)).toBe('long');
    expect(receive(s, msg('turn', { dir: 'right', distM: 40, street: 'Jl. Thamrin' }), 7000)).toBe('');
    // Next maneuver.
    expect(receive(s, msg('turn', { dir: 'left', distM: 120, street: 'Jl. Juanda' }), 8000)).toBe('short');
    expect(receive(s, msg('prog', { distM: 30, remM: 1500, etaS: 500 }), 9000)).toBe('long');
  });

  test('a first message already inside 50 m gives one long buzz', () => {
    var s = navigating();
    expect(receive(s, msg('turn', { dir: 'left', distM: 30, street: '' }), 2000)).toBe('long');
    expect(receive(s, msg('prog', { distM: 20, remM: 900, etaS: 300 }), 3000)).toBe('');
  });

  test('a same-looking turn far away is a new maneuver', () => {
    var s = navigating();
    receive(s, msg('turn', { dir: 'right', distM: 40, street: '' }), 2000);
    expect(receive(s, msg('turn', { dir: 'right', distM: 180, street: '' }), 3000)).toBe('short');
  });

  test('no buzz for depart or while paused', () => {
    var s = navigating();
    expect(receive(s, msg('turn', { dir: 'depart', distM: 0, street: 'Jl. Sabang' }), 2000)).toBe('');
    s.paused = true;
    expect(receive(s, msg('turn', { dir: 'left', distM: 20, street: '' }), 3000)).toBe('');
  });

  test('drops an exact repeat of n and accepts a reset', () => {
    var s = navigating();
    var turn = msg('turn', { dir: 'left', distM: 150, street: 'A' });
    expect(receive(s, turn, 2000)).toBe('short');
    s.vibNear = false; // would buzz again if the retry were applied
    expect(receive(s, turn, 2100)).toBe('');
    expect(receive(s, { v: 1, t: 'start', n: 1, dest: 'B', totalM: 10, etaS: 5 }, 3000)).toBe('');
    expect(s.dest).toBe('B');
  });

  test('roundabout keeps its exit, next preview, off route and reroute', () => {
    var s = navigating();
    receive(s, msg('off'), 1500);
    expect(s.off).toBe(true);
    receive(s, msg('reroute'), 1600);
    expect(s.rerouting).toBe(true);
    receive(s, msg('turn', { dir: 'roundabout', exit: 2, distM: 500, street: 'Jl. Merdeka', next: { dir: 'left', street: 'Jl. Pos' } }), 2000);
    expect(s.off).toBe(false);
    expect(s.rerouting).toBe(false);
    expect(s.exit).toBe(2);
    expect(s.hasNext).toBe(true);
    expect(s.nextDir).toBe('left');
    var v = present(s, stringsFor('id'), { phoneReachable: true });
    expect(v.actionLine).toBe('Bundaran, keluar ke-2');
    expect(v.nextLine).toBe('Lalu: Jl. Pos');
    expect(v.nextArrow).toBe('/common/images/small_left.png');
  });

  test('unknown dir falls back to straight, unknown t is ignored', () => {
    var s = navigating();
    receive(s, msg('turn', { dir: 'keep_left', distM: 500, street: 'X' }), 2000);
    expect(s.dir).toBe('straight');
    expect(receive(s, msg('weather', { temp: 30 }), 2100)).toBe('');
    expect(s.screen).toBe('nav');
  });

  test('arrive and end', () => {
    var s = navigating();
    receive(s, msg('arrive'), 2000);
    expect(s.screen).toBe('arrived');
    receive(s, msg('end', { why: 'arrived' }), 2100);
    expect(s.screen).toBe('arrived');
    var t = navigating();
    receive(t, msg('end', { why: 'error' }), 2000);
    expect(t.screen).toBe('idle');
    expect(t.ended).toBe('error');
    expect(present(t, stringsFor('en'), { phoneReachable: true }).idleLine).toBe('Navigation ended: the route cannot continue');
  });

  test('watch stop goes back to idle', () => {
    var s = navigating();
    localStop(s);
    expect(s.screen).toBe('idle');
    expect(s.ended).toBe('stopped');
  });
});

describe('watchdog', () => {
  test('90 s without a message marks the phone lost and keeps the last turn', () => {
    var s = navigating();
    receive(s, msg('turn', { dir: 'left', distM: 300, street: 'Jl. Juanda' }), 10000);
    expect(tick(s, 10000 + LOST_AFTER_MS - 1)).toBe(false);
    expect(tick(s, 10000 + LOST_AFTER_MS)).toBe(true);
    expect(s.lost).toBe(true);
    expect(s.street).toBe('Jl. Juanda');
    var v = present(s, stringsFor('in'), { phoneReachable: true });
    expect(v.banner).toBe('Ponsel terputus');
    expect(v.bannerWarn).toBe(true);
    receive(s, msg('hb'), 200000);
    expect(s.lost).toBe(false);
  });
  test('idle never times out', () => {
    var s = createState();
    expect(tick(s, 10 * LOST_AFTER_MS)).toBe(false);
  });
});

describe('format', () => {
  var ID = stringsFor('id');
  var EN = stringsFor('en');
  test('distance', () => {
    expect(distance(47, ID)).toEqual({ num: '47', unit: 'm' });
    expect(distance(123, ID)).toEqual({ num: '120', unit: 'm' });
    expect(distance(996, ID)).toEqual({ num: '1,0', unit: 'km' });
    expect(distance(1260, EN)).toEqual({ num: '1.3', unit: 'km' });
    expect(distance(12400, EN)).toEqual({ num: '12', unit: 'km' });
  });
  test('duration', () => {
    expect(duration(20, ID)).toBe('< 1 mnt');
    expect(duration(720, ID)).toBe('12 mnt');
    expect(duration(3900, EN)).toBe('1 h 05 min');
  });
});

describe('outgoing', () => {
  test('envelope with per-launch n that wraps', () => {
    var seq = { n: 0 };
    expect(JSON.parse(outgoing(seq, 'hello', { app: '1.0.0' }))).toEqual({ v: 1, t: 'hello', n: 1, app: '1.0.0' });
    seq.n = MAX_N;
    expect(JSON.parse(outgoing(seq, 'stop'))).toEqual({ v: 1, t: 'stop', n: 1 });
  });
});

describe('demo route', () => {
  test('every message validates against the schema shapes and stays under 1000 bytes', () => {
    var script = demoScript();
    var s = createState();
    var buzz = [];
    script.forEach((step, i) => {
      var text = JSON.stringify(Object.assign({ v: 1, n: i + 1 }, step.msg));
      expect(text.length).toBeLessThanOrEqual(1000);
      var v = receive(s, parse(text), i * 1000);
      if (v) buzz.push(v);
    });
    expect(s.screen).toBe('arrived');
    expect(buzz.filter((b) => b === 'long').length).toBeGreaterThanOrEqual(5);
  });
});

describe('images', () => {
  test('there is a big and a small arrow for every dir', () => {
    var dirs = ['depart', 'straight', 'slight_left', 'left', 'sharp_left', 'slight_right', 'right', 'sharp_right', 'uturn', 'roundabout', 'arrive'];
    var root = new URL('../entry/src/main/js/MainAbility/common/images/', import.meta.url).pathname;
    dirs.forEach((d) => {
      expect(readFileSync(root + 'big_' + d + '.png').length).toBeGreaterThan(100);
      expect(readFileSync(root + 'small_' + d + '.png').length).toBeGreaterThan(100);
    });
  });
});

describe('page', () => {
  test('every key present() returns is declared in the page data (lite drops undeclared bindings)', () => {
    var page = readFileSync(new URL('../entry/src/main/js/MainAbility/pages/index/index.js', import.meta.url), 'utf8');
    var data = page.slice(page.indexOf('data: {'), page.indexOf('onInit'));
    var keys = Object.keys(present(createState(), stringsFor('id'), { demo: false, phoneReachable: true }));
    keys.forEach((k) => {
      expect(data).toContain('    ' + k + ':');
    });
    expect(page).not.toContain('render:'); // the lite ViewModel hides a page method called render
  });
});
