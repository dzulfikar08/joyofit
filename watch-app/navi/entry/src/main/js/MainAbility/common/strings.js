// UI strings, Indonesian and English. Kept in JS instead of the i18n/ resource folder so one table serves both the
// watch and the bun tests, and so the Indonesian locale works whether the watch reports it as `id` or `in`.

var ID = {
  appName: 'JoyoNavi',
  idleHint: 'Mulai navigasi dari JoyoFit',
  idleNoPhone: 'JoyoFit belum tersambung',
  idleDemo: 'Tekan lama untuk demo',
  endedStopped: 'Navigasi dihentikan',
  endedError: 'Navigasi berhenti: rute tidak bisa dilanjutkan',
  waiting: 'Menunggu petunjuk…',
  lost: 'Ponsel terputus',
  off: 'Di luar rute',
  rerouting: 'Menghitung ulang rute…',
  paused: 'Dijeda',
  pause: 'Jeda',
  resume: 'Lanjut',
  stop: 'Berhenti',
  close: 'Tutup',
  arrived: 'Sampai di tujuan',
  done: 'Selesai',
  then: 'Lalu',
  left: 'sisa',
  demo: 'DEMO',
  hour: 'j',
  min: 'mnt',
  decimal: ',',
  exit: 'keluar ke-',
  dir: {
    depart: 'Mulai',
    straight: 'Lurus',
    slight_left: 'Agak ke kiri',
    left: 'Belok kiri',
    sharp_left: 'Belok tajam ke kiri',
    slight_right: 'Agak ke kanan',
    right: 'Belok kanan',
    sharp_right: 'Belok tajam ke kanan',
    uturn: 'Putar balik',
    roundabout: 'Bundaran',
    arrive: 'Tujuan'
  }
};

var EN = {
  appName: 'JoyoNavi',
  idleHint: 'Start navigation in JoyoFit',
  idleNoPhone: 'JoyoFit is not connected',
  idleDemo: 'Long-press for a demo',
  endedStopped: 'Navigation stopped',
  endedError: 'Navigation ended: the route cannot continue',
  waiting: 'Waiting for directions…',
  lost: 'Phone disconnected',
  off: 'Off route',
  rerouting: 'Rerouting…',
  paused: 'Paused',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  close: 'Close',
  arrived: 'You have arrived',
  done: 'Done',
  then: 'Then',
  left: 'left',
  demo: 'DEMO',
  hour: 'h',
  min: 'min',
  decimal: '.',
  exit: 'exit ',
  dir: {
    depart: 'Head off',
    straight: 'Go straight',
    slight_left: 'Bear left',
    left: 'Turn left',
    sharp_left: 'Sharp left',
    slight_right: 'Bear right',
    right: 'Turn right',
    sharp_right: 'Sharp right',
    uturn: 'Make a U-turn',
    roundabout: 'Roundabout',
    arrive: 'Destination'
  }
};

// `language` as the watch reports it (`@system.configuration` getLocale().language). Indonesian is `id` (BCP 47) or
// `in` (the old Java code that Huawei's link protocol still uses, e.g. `in-ID`); anything else gets English.
export function stringsFor(language) {
  var l = typeof language === 'string' ? language.toLowerCase() : '';
  return l === 'id' || l === 'in' || l.indexOf('id-') === 0 || l.indexOf('in-') === 0 ? ID : EN;
}
