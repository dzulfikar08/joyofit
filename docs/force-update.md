# Launch-time update gate ("Update dulu")

Written 2026-10-19. Goal: people who report problems we already fixed must update from Google Play / TestFlight before they use the app. The server decides the lowest native build that may run; an older build sees a full-screen "Update dulu" wall. A newer-but-not-latest build only sees a dismissible banner. On every cold start the app also pulls a newer JS bundle (OTA) before it shows anything.

## Where the rule lives

`GET https://api.fit.joyorogo.com/v1/app-config`: public (no session, so a logged-out phone is gated too), `Cache-Control: public, max-age=60`.

```json
{
  "android": { "minBuild": 0, "latestBuild": 0, "storeUrl": "https://play.google.com/store/apps/details?id=com.joyodigitama.joyofit" },
  "ios":     { "minBuild": 0, "latestBuild": 0, "storeUrl": "https://testflight.apple.com/join/GXzrQ8GJ" },
  "message": null
}
```

Build = Android `versionCode`, iOS `CFBundleVersion` (`Constants.nativeBuildVersion`, shown on the wall as "Versi terpasang"). The values come from D1 table `app_config` (`server/migrations/0011_app_config.sql`, key/value), so changing them needs **no code deploy**, only the migration once: `cd server && bunx wrangler d1 migrations apply joyofit --remote`.

**Default is off.** An empty table means every `minBuild` is 0 and nobody is gated. Store review builds are therefore never blocked until you set a number.

## Setting it

```
scripts/app-min-build.sh show                          # what the live server hands out
scripts/app-min-build.sh android 1472000               # block Android builds below 1472000
scripts/app-min-build.sh ios 202610190340 --latest 202610191200
scripts/app-min-build.sh android 0                     # gate off again
scripts/app-min-build.sh message "Ada perbaikan penting, update dulu ya."   # "" = the app's own copy
scripts/app-min-build.sh android-url https://play.google.com/store/apps/details?id=com.joyodigitama.joyofit
```

(The script writes the remote D1 `joyofit`; `--local` for the dev database. It is `wrangler d1 execute` on keys `android_min_build`, `android_latest_build`, `android_store_url`, `ios_*`, `message`.) A change reaches phones within about 6 minutes (1 min edge cache plus the app's 5 min cache), sooner on a cold start after that, or at once on "Cek lagi".

Pick the number carefully: `minBuild` must be a build that is **already installable** by the people it blocks (Play track they are on, TestFlight group they belong to), otherwise they are stuck on a wall with nothing to update to. Check the store first, then set it to the build number of the newest build that fixes the problem. `latestBuild` (optional, never below `minBuild`) is for "a newer one exists" nudges.

## Behaviour

- **Cold start.** The splash stays up while the app reads the config (fresh cache, else the server, 4 s timeout) and then looks for an OTA bundle. A blocked build never mounts the app (no database, sync, BLE); it shows the wall instead.
- **Resume.** When the app returns to the foreground the config is read again, at most every 5 minutes (`CONFIG_TTL_MS`). A block found then covers the running app with an opaque layer instead of unmounting it, so a recording in progress is not lost. Android back is swallowed on the wall.
- **Wall** (`UpdateRequiredScreen.tsx`): why (fixes are already released), what to do, installed build, owner `message` instead of the body when set. Buttons: store, **Cek lagi** (asks the server past every cache; if the build is still too old it says so). Android: **Perbarui di Play Store** opens `market://details?id=com.joyodigitama.joyofit`; when `storeUrl` is the closed-testing opt-in page (no longer the default: JoyoFit is in production, so the default is the store listing) a second button **Buka halaman uji coba** opens it, for testers who still have to opt in. If no Play app is present the https page opens. iOS: **Buka TestFlight** (`itms-beta://testflight.apple.com/join/<code>`, falling back to the https join link); with an `apps.apple.com` URL it becomes **Buka App Store**. The app cannot tell a tester from a production user, so the testing link is always offered while `storeUrl` is that link.
- **Banner.** Build below `latestBuild` but at or above `minBuild`: "Ada versi baru" with **Update** (store) and **Nanti** (hidden 24 h, SecureStore `joyofit_newer_dismissed_at`). It shows only when nothing else wants the banner slot: a downloaded OTA, then Play's own in-app update, win.
- **Fail open.** No network, timeout, a bad status, unparsable JSON, no cloud URL in the build, a build number that cannot be read, a platform other than Android/iOS: the app opens normally. A config younger than 5 minutes (SecureStore `joyofit_gate_config`) is used when the server cannot be reached; an older one is not (a stale block must never lock someone out).
- **OTA freshness** (`refreshOtaAtLaunch` in `useOtaUpdate.ts`, extends `checkAndFetchOta`): on cold start, if the update server has a bundle for this runtime, the app shows "Memperbarui…", downloads it and reloads into it before showing the app. Total budget 8 s from launch (`OTA_LAUNCH_TIMEOUT_MS`, gate read included); after that the app opens on the bundle it has, the reload is cancelled (no jump in the middle of use), and the download keeps going: the existing "Update ready to install" banner or the next cold start applies it. A launch within 60 s of our own reload skips the refresh (no loop). Off in dev clients and Expo Go. The foreground 6 h re-check from `docs/ota.md` is unchanged.

## Code

| File | Role |
| --- | --- |
| `server/src/appConfig.ts`, `server/migrations/0011_app_config.sql` | endpoint, table, defaults |
| `src/features/updates/forceUpdatePolicy.ts` (+ `.test.ts`) | pure rules: parse, `decideGate`, cache TTL, fail open, store links, throttles |
| `src/features/updates/forceUpdate.ts` | native build, fetch with timeout, SecureStore cache, `openFirst` |
| `src/features/updates/UpdateGateProvider.tsx` | cold-start sequence, resume re-check, context |
| `src/features/updates/UpdateRequiredScreen.tsx` | the wall and the "Memperbarui…" screen |
| `src/features/updates/useAppUpdate.ts`, `UpdateBanner.tsx` | the "Ada versi baru" banner |
| `src/app/_layout.tsx` | provider above everything, splash held until the launch gate is done |

Copy lives in `settings` `updates.gate.*`, `updates.launch.*`, `updates.banner.newer*` (id and en).

## Who gets this code

The gate is JS only: no native module, no `app.json` change, so the runtimeVersion does not move and it ships over the air (`scripts/ota.sh`, `docs/ota.md`).

- It reaches binaries that embed expo-updates **and** whose runtime has this commit published: from master that is the runtimes listed in `docs/ota.md` ("Master Android OTAs target `b8054fd8...`", "Master iOS OTAs target `60ae9d28...`"). Older runtimes (`ota/1.0`, `ota/tf-938`, `ota/r-81a99224`, ...) need this commit cherry-picked onto their `ota/*` branch (`git cherry-pick -x <sha>`, then `scripts/ota.sh --platform <p> --runtime-version <hash> "..."` locally). The commit touches no native file, so the pick is clean.
- Binaries built before expo-updates was added never get it; the store only reaches them by a normal update.
- **Deploy the Worker and apply migration 0011 first** (`bunx wrangler deploy`, `db:migrate:remote`); until then the endpoint answers 404 and every build fails open.
- A build that carries the gate but cannot reach a store build that satisfies `minBuild` is the one case to avoid: see "Pick the number carefully".

## Testing

`bun test ./src/features/updates/` (rules), `cd server && bunx vitest run test/appConfig.test.ts` (endpoint). On a device: set `minBuild` above the installed build with `scripts/app-min-build.sh`, cold start (wall, no tabs behind it), tap the store button, set it back to 0 and tap **Cek lagi** (app opens). Airplane mode on a cold start opens the app.
