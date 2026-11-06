// Build-time settings of the watch app. Keep in step with the phone's src/features/watchnav/watchNavConfig.ts and
// with `module.metaData.customizeData[supportLists]` in entry/src/main/config.json.

export var APP_VERSION = '1.0.0'; // = app.version.name in config.json; sent in `hello`

// The phone app the watch talks to (JoyoFit, Android package = iOS bundle id).
export var PHONE_PACKAGE = 'com.joyodigitama.joyofit';

// SHA-256 of the Play app-signing certificate that signs JoyoFit's store build, 64 hex characters, upper case, no
// colons, as registered for the JoyoFit HUAWEI ID / Wear Engine service (JRG-440, 2026-11-06). Huawei's watch SDK
// refuses to send or receive while this is empty. JoyoFit routes by package name and accepts any fingerprint, so
// sideloaded JoyoFit builds (signed with the upload key) work too.
export var PHONE_FINGERPRINT = '5702ADC96D179243217B41840B026B809AB85F9A590E32BEE22752805F43C04A';

// Start the built-in demo route on launch (simulator screenshots). Off for watch builds: the demo also starts with a
// long press on the idle screen.
export var DEMO_AUTOSTART = false;
