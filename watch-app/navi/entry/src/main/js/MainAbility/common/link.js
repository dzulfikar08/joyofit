// P2P link to JoyoFit through the watch's Wear Engine service (`@system.wearengine`). The watch firmware carries these
// messages to the phone over the link's P2P service (0x34): our text goes out as a P2P data message to PHONE_PACKAGE,
// JoyoFit's messages come back through the subscription.
//
// This is a small client of our own instead of Huawei's watch-side JS SDK (wearengine.js 5.0.2.306, Apache-2.0): that
// file alone is 17 KB, and a lite page in debug (JS parser) mode must stay under 48 KB. It makes the same service calls
// the published SDK makes for text messages (version check, peer package, peer fingerprint, subscribe, send) and
// nothing else (no files, no ping).

import wearengine from '@system.wearengine';
import { PHONE_FINGERPRINT, PHONE_PACKAGE } from './config.js';

var SDK_LEVEL = '3'; // the client level announced to the service, as in Huawei's SDK 5.0.2
var MIN_SERVICE = 303; // peer package and fingerprint calls exist from service 303 on
var DIRECT_SERVICE = 401; // from 401 messages go through @system.wearengine, before through the FeatureAbility global

function noop() {}

function failed(what) {
  return function (data, code) {
    console.error('navi: ' + what + ' failed ' + code + ' ' + data);
  };
}

// Opens the link and calls onText(text) for every text message from the phone, and onState(ok) once the service
// answered (ok = false: no usable Wear Engine service, e.g. in the simulator). Returns { send(text, done(ok)), close() }.
export function openLink(onText, onState) {
  var phase = 'wait'; // wait (for the version answer) | up | down
  var bus = null; // the object with subscribeMsg/sendMsg/unsubscribeMsg
  var pending = []; // messages sent before the version answer

  function send(text, done) {
    if (phase === 'down') {
      done(false);
      return;
    }
    if (phase === 'wait') {
      pending.push({ text: text, done: done });
      return;
    }
    bus.sendMsg({
      deviceId: 'remote',
      bundleName: PHONE_PACKAGE,
      abilityName: '',
      message: text,
      success: function () {
        done(true);
      },
      fail: function (data, code) {
        console.error('navi: send failed ' + code + ' ' + data);
        done(false);
      }
    });
  }

  function start(versionText) {
    if (phase !== 'wait') return;
    var parts = String(versionText || '').split('.');
    var service = Number(parts[parts.length - 1]) || 0;
    console.info('navi: Wear Engine service ' + service);
    if (service < MIN_SERVICE) {
      phase = 'down';
    } else {
      wearengine.setPackageName({ appName: PHONE_PACKAGE, complete: noop, fail: failed('setPackageName') });
      wearengine.setFingerprint({
        appName: PHONE_PACKAGE, appCert: PHONE_FINGERPRINT, complete: noop, fail: failed('setFingerprint')
      });
      bus = service >= DIRECT_SERVICE ? wearengine : FeatureAbility; // eslint-disable-line no-undef
      bus.unsubscribeMsg();
      bus.subscribeMsg({
        success: function (data) {
          // The first callback confirms the subscription ({ isRegister }); files arrive as { isFileType } (unused).
          if (data && !data.isRegister && !data.isFileType && typeof data.message === 'string') onText(data.message);
        },
        fail: failed('subscribeMsg')
      });
      phase = 'up';
    }
    onState(phase === 'up');
    var queued = pending;
    pending = [];
    for (var i = 0; i < queued.length; i++) send(queued[i].text, queued[i].done);
  }

  try {
    wearengine.getWearEngineVersion({ sdkVersion: SDK_LEVEL, complete: start });
  } catch (e) {
    console.error('navi: Wear Engine unavailable: ' + e);
    start('');
  }

  return {
    send: send,
    close: function () {
      if (bus) bus.unsubscribeMsg();
      bus = null;
      phase = 'down';
    }
  };
}
