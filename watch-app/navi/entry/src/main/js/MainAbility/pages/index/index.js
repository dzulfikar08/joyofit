// The only page. Idle, navigating, arrived and the pause/stop overlay are sections of this page rather than separate
// pages: the lite router has no back stack and a page switch would drop the P2P receiver and the watchdog with it.
// Method names avoid the lite ViewModel's own members: a page method called `render` is not reachable as this.render.

import app from '@system.app';
import brightness from '@system.brightness';
import configuration from '@system.configuration';
import vibrator from '@system.vibrator';
import { APP_VERSION, DEMO_AUTOSTART } from '../../common/config.js';
import { demoScript } from '../../common/demo.js';
import { present } from '../../common/format.js';
import { drawMap } from '../../common/mapdraw.js';
import { openLink } from '../../common/link.js';
import {
  backToIdle, createState, localPause, localResume, localStop, outgoing, parse, receive, tick
} from '../../common/nav.js';
import { stringsFor } from '../../common/strings.js';

var WATCHDOG_EVERY_MS = 5000;
var TAP_AFTER_BUTTON_MS = 400; // a button tap must not also count as a tap on the screen behind it
var MAP_W = 336; // = .map-canvas in index.css
var MAP_H = 320;

// Module state: one page, one instance.
var state = createState();
var S = stringsFor('');
var link = null;
var seq = { n: 0 };
var phoneReachable = true;
var watchdog = 0;
var demo = null; // { steps, i, n, timer } while the demo route runs
var keepOn = false;
var lastButtonMs = 0;
var mapView = false; // the wearer swiped to the map view
var drawnRev = -1; // the state.mapRev on the canvas

// The lite simulator has neither the brightness nor the vibrator module (calling them throws a TypeError), so both
// calls are guarded: on the simulator they log and the app carries on.
function setKeepOn(on) {
  if (on === keepOn) return;
  keepOn = on;
  try {
    brightness.setKeepScreenOn({
      keepScreenOn: on,
      fail: function (data, code) {
        console.error('navi: setKeepScreenOn ' + on + ' failed ' + code);
      }
    });
  } catch (e) {
    console.error('navi: no brightness module: ' + e);
  }
}

function vibrate(mode) {
  try {
    vibrator.vibrate({ mode: mode });
  } catch (e) {
    console.error('navi: no vibrator module (' + mode + '): ' + e);
  }
}

export default {
  data: {
    isIdle: true,
    isNav: false,
    isArrived: false,
    overlay: false,
    demo: false,
    appName: '',
    idleLine: '',
    hasIdleSub: false,
    idleSub: '',
    idleDemo: '',
    hasTurn: false,
    noTurn: true,
    waiting: '',
    arrow: '/common/images/big_straight.png',
    distNum: '',
    distUnit: '',
    actionLine: '',
    street: '',
    remLine: '',
    hasRem: false,
    banner: '',
    bannerWarn: false,
    bannerInfo: false,
    hasNext: false,
    nextArrow: '/common/images/small_straight.png',
    nextLine: '',
    dest: '',
    paused: false,
    lblPauseResume: '',
    lblStop: '',
    lblClose: '',
    lblArrived: '',
    lblDone: '',
    lblDemo: '',
    isNavMap: false,
    mapTop: '',
    mapTopPlain: true,
    mapTopWarn: false,
    mapWaiting: false,
    lblMapWaiting: ''
  },

  onInit: function () {
    var language = '';
    try {
      language = configuration.getLocale().language;
    } catch (e) {
      console.error('navi: no locale: ' + e);
    }
    S = stringsFor(language);
    console.info('navi: locale language ' + language);
    this.appName = S.appName;
    this.lblStop = S.stop;
    this.lblClose = S.close;
    this.lblArrived = S.arrived;
    this.lblDone = S.done;
    this.lblDemo = S.demo;
    this.lblMapWaiting = S.mapWaiting;
    mapView = false;
    drawnRev = -1;
    state = createState();
    seq = { n: 0 };
    var self = this;
    phoneReachable = true;
    link = openLink(function (text) {
      self.onPhone(text);
    }, function (ok) {
      phoneReachable = ok;
      self.updateView();
    });
    this.updateView();
    this.sendToPhone('hello', { app: APP_VERSION });
    watchdog = setInterval(function () {
      if (tick(state, Date.now())) self.updateView();
    }, WATCHDOG_EVERY_MS);
    if (DEMO_AUTOSTART) this.startDemo();
  },

  onDestroy: function () {
    clearInterval(watchdog);
    this.stopDemo();
    if (link) link.close();
    link = null;
    setKeepOn(false);
  },

  // ---- phone ----

  onPhone: function (text) {
    if (demo) return; // the demo owns the screen until it ends or is stopped
    var m = parse(text);
    if (!m) return;
    phoneReachable = true;
    this.handleMessage(m);
  },

  handleMessage: function (m) {
    var buzz = receive(state, m, Date.now());
    if (buzz) vibrate(buzz);
    this.updateView();
  },

  sendToPhone: function (t, fields) {
    if (!link) return;
    var self = this;
    link.send(outgoing(seq, t, fields), function (ok) {
      if (ok === phoneReachable) return;
      phoneReachable = ok;
      self.updateView();
    });
  },

  // ---- view ----

  updateView: function () {
    var view = present(state, S, { demo: !!demo, phoneReachable: phoneReachable });
    for (var k in view) {
      if (Object.prototype.hasOwnProperty.call(view, k)) this[k] = view[k];
    }
    this.lblPauseResume = state.paused ? S.resume : S.pause;
    if (!view.isNav) {
      this.overlay = false;
      mapView = false;
    }
    // The turn view and the map view are two screens of the same navigation.
    this.isNav = view.isNav && !mapView;
    this.isNavMap = view.isNav && mapView;
    var top = view.distNum ? view.distNum + ' ' + view.distUnit : '';
    if (view.actionLine) top = top ? top + ' · ' + view.actionLine : view.actionLine;
    this.mapTop = view.bannerInfo ? view.banner : top || view.waiting;
    this.mapTopWarn = view.bannerWarn;
    this.mapTopPlain = !view.bannerWarn;
    this.mapWaiting = this.isNavMap && !state.map;
    if (this.isNavMap && state.mapRev !== drawnRev) this.paintMap();
    setKeepOn(view.isNav);
  },

  paintMap: function () {
    try {
      var canvas = this.$refs.map;
      if (!canvas) return;
      drawMap(canvas.getContext('2d'), state.map, MAP_W, MAP_H);
      drawnRev = state.mapRev;
    } catch (e) {
      console.error('navi: map draw failed: ' + e);
    }
  },

  setMapView: function (on) {
    mapView = on;
    drawnRev = -1;
    if (!demo) this.sendToPhone('view', { mode: on ? 'map' : 'turn' });
    this.updateView();
    // The canvas only gets its size once it is shown: draw again on the next turn of the loop.
    var self = this;
    if (on) {
      setTimeout(function () {
        if (mapView) self.paintMap();
      }, 50);
    }
  },

  // ---- input ----

  onTap: function () {
    if (this.overlay || Date.now() - lastButtonMs < TAP_AFTER_BUTTON_MS) return;
    if (state.screen === 'nav') {
      this.overlay = true;
    } else if (state.screen === 'arrived') {
      this.stopDemo();
      backToIdle(state);
      this.updateView();
    } else {
      // Idle: ask again; a navigating JoyoFit answers with start + turn + prog.
      this.sendToPhone('hello', { app: APP_VERSION });
    }
  },

  onLongPress: function () {
    if (state.screen === 'idle' && !demo) this.startDemo();
  },

  // Navigating: left = map view, right = back to the turn view. Right on the turn view (or any other screen) leaves the app.
  onSwipe: function (e) {
    if (this.overlay) {
      if (e.direction === 'right') this.overlay = false;
      return;
    }
    if (state.screen === 'nav' && e.direction === 'left' && !mapView) {
      this.setMapView(true);
      return;
    }
    if (state.screen === 'nav' && e.direction === 'right' && mapView) {
      this.setMapView(false);
      return;
    }
    if (e.direction !== 'right') return;
    // Leaving the app does not stop navigation on the phone; opening it again catches up through `hello`.
    app.terminate();
  },

  onPauseResume: function () {
    lastButtonMs = Date.now();
    this.overlay = false;
    if (state.paused) {
      localResume(state);
      if (demo) this.stepDemo();
      else this.sendToPhone('resume');
    } else {
      localPause(state);
      if (demo) clearTimeout(demo.timer);
      else this.sendToPhone('pause');
    }
    this.updateView();
  },

  onStop: function () {
    lastButtonMs = Date.now();
    if (demo) this.stopDemo();
    else this.sendToPhone('stop');
    localStop(state);
    this.updateView();
  },

  onClose: function () {
    lastButtonMs = Date.now();
    this.overlay = false;
  },

  // ---- demo route (simulator, or a long press on the idle screen) ----

  startDemo: function () {
    demo = { steps: demoScript(), i: 0, n: 0, timer: 0 };
    state = createState();
    this.stepDemo();
  },

  stepDemo: function () {
    if (!demo || state.paused) return;
    if (demo.i >= demo.steps.length) {
      demo = null; // stays on the arrived screen; a tap goes back to idle
      this.updateView();
      return;
    }
    var step = demo.steps[demo.i];
    var self = this;
    demo.timer = setTimeout(function () {
      if (!demo) return;
      demo.i += 1;
      demo.n += 1;
      var m = step.msg;
      m.v = 1;
      m.n = demo.n;
      self.handleMessage(m);
      self.stepDemo();
    }, step.waitMs);
  },

  stopDemo: function () {
    if (!demo) return;
    clearTimeout(demo.timer);
    demo = null;
  }
};
