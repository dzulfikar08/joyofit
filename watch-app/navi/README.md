# JoyoNavi (`com.joyodigitama.navi`)

JoyoFit's own watch app for turn-by-turn navigation on the Huawei Watch Fit 4 / 4 Pro (HarmonyOS lite wearable, JS,
FA model). JoyoFit on the phone plans the route and works out every instruction; JoyoNavi only shows the next turn and
vibrates. They talk over Wear Engine P2P with the JSON messages in [`protocol/watch-nav.schema.json`](../../protocol/watch-nav.schema.json)
(on the phone branch until it merges). Toolchain, signing, install paths and the owner checklist: [`docs/watch-app.md`](../../docs/watch-app.md).

Status: builds unsigned from the command line and runs in the lite-wearable simulator (demo route). Never installed on a
watch: that needs the signing material from the Huawei developer account (JRG-440).

## Layout

```
watch-app/navi/
  build-profile.json5, hvigorfile.ts, oh-package.json5, hvigor/   hvigor project (FA model, API 10 compatible, 18 target)
  entry/src/main/config.json                                      bundle, deviceType liteWearable, VIBRATE permission,
                                                                  supportLists (phone package:fingerprint)
  entry/src/main/resources/base/                                  label "JoyoNavi", 114x114 icon
  entry/src/main/js/MainAbility/
    app.js
    pages/index/index.{hml,css,js}   the only page: idle, navigating, arrived, pause/stop overlay
    common/nav.js       protocol state: parse, receive, vibration rule, 90 s watchdog, outgoing envelopes
    common/format.js    distances (m / km, 10 m steps), times (mnt / j), banner priority, image paths
    common/strings.js   Indonesian + English (`id`/`in` -> Indonesian, anything else -> English)
    common/link.js      Wear Engine client (`@system.wearengine`): peer package, fingerprint, subscribe, send
    common/demo.js      built-in demo route (Jakarta, fast-forwarded) for the simulator
    common/config.js    APP_VERSION, PHONE_PACKAGE, PHONE_FINGERPRINT, DEMO_AUTOSTART
    common/images/      big_<dir>.png (150 px) and small_<dir>.png (48 px), one per `dir`
  tools/images.ts       draws the arrows and the icon (our own SVG, rasterised with resvg); SVGs in tools/svg/
  test/nav.test.js      bun tests of nav/format/strings/demo (CI runs them)
```

## Behaviour

| Screen | Shows | Input |
|---|---|---|
| Idle | "Mulai navigasi dari JoyoFit"; "JoyoFit belum tersambung" when the `hello` could not be delivered; the reason of the last end (`stopped` / `error`) | tap: send `hello` again; long press: demo route; swipe right: close the app |
| Navigating | big arrow per `dir`, distance to the turn, maneuver text (roundabout exit), street, remaining distance + time, next-turn preview when the phone sends `next`; banners "Ponsel terputus" (no message for 90 s, last turn kept), "Menghitung ulang rute…", "Di luar rute", "Dijeda" | tap: overlay with Jeda/Lanjut, Berhenti, Tutup |
| Arrived | "Sampai di tujuan" + destination | tap: back to idle |

- On launch the app sends `hello {app}`; a navigating JoyoFit answers with `start`, the current `turn` and a `prog`.
- Vibration: once `short` when `distM` first drops to <= 200 m and once `long` at <= 50 m, per maneuver (a new
  maneuver = different dir/street/exit, or the distance growing by more than 60 m). No buzz for `depart` or while paused.
- `n`: an exact repeat of the previous phone `n` is dropped (P2P retry); resets are accepted. Unknown `t` is ignored.
- The screen stays on while navigating (`brightness.setKeepScreenOn`); swiping the app away does not stop navigation on
  the phone, opening it again catches up through `hello`.
- One page on purpose: the lite router has no back stack and a page switch would drop the P2P subscription.

## Build (no account needed)

Command Line Tools for HarmonyOS 6.0.1 (macOS arm64 here) + a JDK 17:

```bash
export DEVECO_SDK_HOME=<command-line-tools>/sdk PATH=<command-line-tools>/bin:$JAVA_HOME/bin:$PATH
cd watch-app/navi
ohpm install
hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
# -> entry/build/default/outputs/default/entry-default-unsigned.hap (one haptobin .bin inside)
```

`buildMode=release` compiles the page to bytecode (`index.bc`). Signing: `docs/watch-app.md`, "Signing".

## Simulator

The SDK ships the lite-wearable previewer (`sdk/default/openharmony/previewer/liteWearable/bin/Simulator`). DevEco
Studio drives it from the device menu; on the command line:

```bash
Simulator -j entry/build/default/intermediates/loader_out_lite/default/js/MainAbility -n JoyoNavi \
  -or 408 480 -cr 408 480 -device liteWearable -shape rect -url pages/index/index -refresh region \
  -lws 40711 -s navipipe -l id-ID -cm dark -o portrait -hs 524288 -hf true -av ACE_1_0 -sm dynamic
```

It streams JPEG frames over the WebSocket on `-lws`. The simulator has no Wear Engine, vibrator or brightness module
(the app logs and carries on) and reports the language as `zh` (so the UI is English there). Long-press the idle
screen for the demo route, or set `DEMO_AUTOSTART = true` in `common/config.js` for screenshots.

## Tests and images

```bash
bun test test        # logic tests, no install needed
bun install && bun run images   # redraw the arrows and the icon
```

Limits that shaped the code: a lite page must stay under 48 KB in debug (JS parser) mode (the simulator refuses
bigger pages), so the app uses its own small Wear Engine client instead of Huawei's 17 KB `wearengine.js`; plain ES5
(JerryScript); no CSS descendant selectors; a page method must not be called `render`.
