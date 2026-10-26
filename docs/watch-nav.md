# Watch navigation: the phone side (JRG-439, LAB)

Turn-by-turn on the Huawei Watch Fit 4 Pro (HarmonyOS lite wearable, fw 6.1.0.117) with JoyoFit's **own** watch app `com.joyodigitama.navi`
(JoyoFit Navi). The phone does all the work; the watch app shows the current instruction and vibrates. The two talk over Wear Engine P2P
(link service `0x34`, command `0x01`), the same P2P layer JoyoFit already speaks for Huawei's own watch apps. Message format:
[`protocol/watch-nav.schema.json`](../protocol/watch-nav.schema.json), wire details: `protocol/README.md`, "P2P (f) Watch navigation".

**Status:** behind the experimental switch **Navigasi di jam (lab)** (Settings → About & advanced → Experimental, off by default). The watch app
cannot be signed or installed until the Huawei developer account exists (JRG-440), and both fingerprints are placeholders until then, so nothing
has run against a watch. Clean-room: the design is ours (prior art read for ideas only: tjisse/watchnav, Mobiteka Navigation); no Huawei code,
no Petal/Huawei map endpoints.

## Flow

1. Routes → a saved route (GPX/TCX import, drawn route, saved workout) → **Mulai navigasi di jam**, with the activity (Jalan / Lari / Sepeda:
   OSRM profile `foot`/`foot`/`bike`, default speeds 1.4 / 2.8 / 5 m/s for the ETA before the wearer moves) and **Cari rute baru saat keluar jalur**.
2. Planning (`session.ts` → `maneuvers.ts`): the route is simplified to at most 50 waypoints and sent once to FOSSGIS OSRM with `steps=true`
   and `continue_straight=true` (`routingClient.navigate`; same 1.1 s queue, `JoyoFit/<version> (https://joyofit.app)` User-Agent and Referer
   as the route map). OSRM's line is used when it follows the saved route (length within ×1.25 and ≥ 90% of the route, sampled every 50 m,
   within 50 m of it); its steps become instructions with street names (`ref` when unnamed) and roundabout exits. Each OSRM leg ends at a
   waypoint with `arrive` + `depart`: those two become one turn from the heading in to the heading out (or nothing when it goes on straight).
   Otherwise (offline, NoRoute, a GPX track over paths OSM does not have), turns come from the route's shape: the bike computer's cue finder
   (`generateCues`) with a 30° threshold, angle bands slight > 30°, turn > 60°, sharp > 120°, U-turn > 160°, no street names.
3. Native: `startWatchNav(config)` registers `WatchNavService` (Kotlin `WatchNavService.kt` / Swift `WatchNavService.swift`, controllers
   `WatchNav.kt` / `WatchNav.swift`) on the current link and on every reconnect until `stopWatchNav`. It pings the watch app on registration.
4. GPS: the sensor hub's fixes; a workout session with GPS (foreground service on Android, background location on iOS) is started only when
   none runs, so a recording that already runs keeps its own and keeps running after navigation ends.
5. The engine (`engine.ts`) takes every fix, a 1 s tick and the watch app's messages and returns the messages to send; the session encodes
   them (`messages.ts`, `n` from 1 per session) and sends them one at a time.

## Engine behaviour (`src/features/watchnav/engine.ts`, tests in `engine.test.ts`)

| What | Rule |
|---|---|
| Matching | every fix with accuracy ≤ 35 m is projected on the line (the bike computer's route index), hinted from the last progress (0 at the start, so a loop does not match its finish) |
| Current turn | the first maneuver less than 5 m behind the matched position; `next` is included when the following one is within 150 m |
| `turn` | when the current maneuver changes, when its distance first drops to ≤ 200 m and to ≤ 50 m (the watch vibrates there), after `off` ends, after a reroute |
| `prog` | `distM` (to the turn), `remM`, `etaS`; at most every 5 s and only when a rounded number changed; sooner (≥ 1 s after the last) when `distM` changed by ≥ 10% and ≥ 5 m |
| ETA | remaining / average speed of the moving samples (≥ 0.5 m/s) of the last 30 s; standing still keeps the last moving pace; before any, the activity's default |
| Off route | > 40 m from the line for 10 s → one `off`, then nothing but `hb`; back within 25 m → a fresh `turn` |
| Reroute | off route, switch on, at most every 30 s: `reroute`, then OSRM from the current position through the rest of the line (≤ 49 waypoints); the new line restarts progress and sends `turn` + `prog`; a failure waits 30 s |
| Arrival | ≤ 20 m left along the route (after a match) → `arrive`, `end {why:"arrived"}` |
| Heartbeat | `hb` after 30 s without any message (also while paused) |
| Watch app | `hello` / `resume` → `start`, `turn`, `prog` (+ `off`); `pause` → no `turn`/`prog`/`off`; `stop` → `end {why:"stopped"}`; an exact repeat of the last `n` is dropped (P2P retry) |
| Lost location | no usable fix for 5 min → `end {why:"error"}` |
| Phone stop | `end {why:"stopped"}` goes out before the service is unregistered |

Every message is ≤ 1000 UTF-8 bytes: names are cut to 48 characters (`MAX_NAME_CHARS`); the largest possible `turn` is about 510 bytes, and the
encoder throws rather than send a cut message.

## Fingerprints (placeholders until JRG-440)

Wear Engine checks both ends. Values live in `src/features/watchnav/config.ts` and go to the native side with `startWatchNav`:

| Field | P2P tag (phone → watch) | Where it comes from | Placeholder |
|---|---|---|---|
| `phoneFingerprint` | `05` (source) | SHA-256 of the certificate that signs the JoyoFit store build, as AppGallery Connect lists it for the phone app (64 hex, upper case, no colons); the watch app carries the same string as its peer fingerprint | `PLACEHOLDER-JRG440-PHONE-SHA256` |
| `watchFingerprint` | `06` (destination) | the watch app's fingerprint from its AppGallery Connect project: `com.joyodigitama.navi_<base64 public key of the watch app's signing certificate>` (≤ 127 characters) | `PLACEHOLDER-JRG440-WATCH-FINGERPRINT` |

The source package is the app's own id (`com.joyodigitama.joyofit`, Android `packageName`, iOS bundle id); the destination is `com.joyodigitama.navi`.
Pings carry no fingerprints. The native side treats any value starting with `PLACEHOLDER` as unset (`placeholderFingerprints` in `getWatchNav()`,
and `fingerprints placeholder` in the session-start log line); the route screen says the watch app cannot be installed yet. The phone accepts
data from `com.joyodigitama.navi` whatever fingerprints it carries (P2P routing is by source package). When the account exists: put the two real
values in `config.ts` (OTA-able, JS only) and in the watch app.

## Device test (once the watch app is installed)

`adb logcat -s JoyoFit:V | grep -E "WatchNav|P2P (tx|rx) cmd=. src=com.joyodigitama|dst=com.joyodigitama.navi"`. Expected, in order:

```
WatchNav: lab switch on
WatchNav: session start (phone com.joyodigitama.joyofit, watch app com.joyodigitama.navi, fingerprints set)
WatchNav: registered com.joyodigitama.joyofit -> com.joyodigitama.navi
P2P tx cmd=1 src=com.joyodigitama.joyofit dst=com.joyodigitama.navi seq=N data=none
P2P rx cmd=3 src=com.joyodigitama.navi dst=com.joyodigitama.joyofit seq=N code=202 data=none
WatchNav: ping of com.joyodigitama.navi answered 0xca (0xca = the watch app is there)
WatchNav: watch app present (code 0xca)
WatchNav: tx start n=1 (B bytes)
P2P tx cmd=2 src=com.joyodigitama.joyofit dst=com.joyodigitama.navi seq=N data=B bytes
WatchNav: tx turn n=2 (… bytes)
WatchNav: tx prog n=3 (… bytes)
P2P rx cmd=3 src=com.joyodigitama.navi dst=com.joyodigitama.joyofit seq=N code=207 data=none
WatchNav: tx start n=1 acknowledged 0xcf
```

When the wearer opens the watch app: `P2P rx cmd=2 src=com.joyodigitama.navi …`, `WatchNav: rx {"v":1,"t":"hello","n":1,"app":"…"}` and
`tx start` / `tx turn` / `tx prog` again. A watch app that is not running answers the ping or data with another code:
`WatchNav: watch app absent (code 0x..)` and `tx … answered 0x..`. A ping from the watch app: `WatchNav: the watch app pinged; answered 0xca`.
Stop: `WatchNav: tx end n=… (… bytes)`, then `WatchNav: session stop; service unregistered`. The in-app log (Settings → Log) adds the JS side:
`WatchNav: session start: "<route>", osrm|geometry instructions, N maneuvers, M m`, `off route … m: rerouting through N points`, `reroute: …`,
`session end (arrived|stopped|error)`. The JSON the phone sends is not logged (it has street names); the watch app's is.

## Privacy

New data leaving the phone, only with the lab switch on and a session started: up to 50 points of the saved route (once) and, with reroute on,
the current position plus the rest of the route (at most every 30 s while off the route) go to FOSSGIS OSRM (`routing.openstreetmap.de`). Covered in
`site/src/Privasi.tsx` (Loop dari rumah / Loop from home), `docs/play-store.md` (data safety) and `docs/app-store.md` (App Privacy). Instructions
go to the watch over Bluetooth only.

## Credits

Turn instructions show "data © OpenStreetMap contributors, routing OSRM / FOSSGIS" on the route screen (the FOSSGIS policy asks for attribution).
