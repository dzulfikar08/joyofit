// Turns the navigation state into the flat strings and image paths the page binds to.

// Distance to the turn as { num, unit }: whole metres under 100 m, 10 m steps under 1 km,
// one decimal under 10 km, whole kilometres above.
export function distance(m, S) {
  if (m < 0) return { num: '', unit: '' };
  if (m < 100) return { num: String(Math.round(m)), unit: 'm' };
  if (m < 995) return { num: String(Math.round(m / 10) * 10), unit: 'm' };
  if (m < 9950) {
    var tenths = Math.round(m / 100);
    return { num: Math.floor(tenths / 10) + S.decimal + (tenths % 10), unit: 'km' };
  }
  return { num: String(Math.round(m / 1000)), unit: 'km' };
}

export function distanceText(m, S) {
  var d = distance(m, S);
  return d.num ? d.num + ' ' + d.unit : '';
}

// Time to go: "< 1 mnt", "12 mnt", "1 j 05 mnt".
export function duration(s, S) {
  if (s < 0) return '';
  var min = Math.round(s / 60);
  if (min < 1) return '< 1 ' + S.min;
  if (min < 60) return min + ' ' + S.min;
  var h = Math.floor(min / 60);
  var rest = min % 60;
  return h + ' ' + S.hour + ' ' + (rest < 10 ? '0' : '') + rest + ' ' + S.min;
}

export function arrowSrc(dir, size) {
  return '/common/images/' + size + '_' + dir + '.png';
}

export function action(dir, exit, S) {
  var label = S.dir[dir] || S.dir.straight;
  return dir === 'roundabout' && exit > 0 ? label + ', ' + S.exit + exit : label;
}

// Everything the page shows, from the state `s`, strings `S` and the app flags.
export function present(s, S, flags) {
  var d = distance(s.distM, S);
  var rem = [];
  var remText = distanceText(s.remM, S);
  if (remText) rem.push(S.left + ' ' + remText);
  var eta = duration(s.etaS, S);
  if (eta) rem.push(eta);

  var banner = '';
  var bannerKind = 'info';
  if (s.lost) {
    banner = S.lost;
    bannerKind = 'warn';
  } else if (s.rerouting) {
    banner = S.rerouting;
  } else if (s.off) {
    banner = S.off;
    bannerKind = 'warn';
  } else if (s.paused) {
    banner = S.paused;
  }

  var idleLine = S.idleHint;
  if (s.ended === 'stopped') idleLine = S.endedStopped;
  else if (s.ended === 'error') idleLine = S.endedError;

  // Booleans instead of expressions: the lite-wearable template engine binds plain values most reliably.
  return {
    isIdle: s.screen === 'idle',
    isNav: s.screen === 'nav',
    isArrived: s.screen === 'arrived',
    demo: !!flags.demo,
    idleLine: idleLine,
    hasIdleSub: !flags.phoneReachable,
    idleSub: S.idleNoPhone,
    idleDemo: S.idleDemo,
    hasTurn: s.hasTurn,
    noTurn: !s.hasTurn,
    waiting: S.waiting,
    arrow: arrowSrc(s.hasTurn ? s.dir : 'straight', 'big'),
    distNum: s.hasTurn ? d.num : '',
    distUnit: s.hasTurn ? d.unit : '',
    actionLine: s.hasTurn ? action(s.dir, s.exit, S) : '',
    street: s.hasTurn ? s.street : s.dest,
    remLine: rem.join('  ·  '),
    banner: banner,
    bannerWarn: banner !== '' && bannerKind === 'warn',
    bannerInfo: banner !== '' && bannerKind !== 'warn',
    hasRem: banner === '' && rem.length > 0,
    hasNext: s.hasTurn && s.hasNext,
    nextArrow: arrowSrc(s.hasNext ? s.nextDir : 'straight', 'small'),
    nextLine: s.hasNext ? S.then + ': ' + (s.nextStreet || action(s.nextDir, 0, S)) : '',
    dest: s.dest,
    paused: s.paused
  };
}
