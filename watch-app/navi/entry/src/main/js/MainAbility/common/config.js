// Build-time settings of the watch app. Keep in step with the phone's src/features/watchnav/watchNavConfig.ts and
// with `module.metaData.customizeData[supportLists]` in entry/src/main/config.json.

export var APP_VERSION = '1.0.0'; // = app.version.name in config.json; sent in `hello`

// The phone app the watch talks to (JoyoFit, Android package = iOS bundle id).
export var PHONE_PACKAGE = 'com.joyodigitama.joyofit';

// SHA-256 of the certificate that signs JoyoFit's store build, 64 hex characters, upper case, no colons, as AppGallery
// Connect lists it for the HUAWEI ID / Wear Engine registration. Huawei's watch SDK refuses to send or receive while
// this is empty. Until the developer account exists (JRG-440) it is the placeholder JoyoFit's native P2P service
// recognises; JoyoFit routes by package name, so the placeholder works with JoyoFit but not with Huawei Health.
export var PHONE_FINGERPRINT = 'PLACEHOLDER-JRG440-PHONE-SHA256';

// Start the built-in demo route on launch (simulator screenshots). Off for watch builds: the demo also starts with a
// long press on the idle screen.
export var DEMO_AUTOSTART = false;
