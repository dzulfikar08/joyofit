# Over-the-air JS updates (EAS Update)

Written 2026-10-18. JS and asset fixes (screens, copy, logic) reach installed apps in minutes instead of waiting for a store build and review. The native binaries are still built by our own scripts (`scripts/build-release.sh`, `scripts/build-ios-mac.sh`, the `Release *` workflows). Only the update hosting is EAS: **EAS Update works with self-built binaries**, no EAS Build is involved.

| | |
| --- | --- |
| Library | `expo-updates` |
| EAS project | `@dzulfikar08/joyofit`, id `6175ba14-6962-4cbe-bc80-a5bb46be7fcb` (`app.json`: `extra.eas.projectId`, `updates.url`, `owner`) |
| runtimeVersion | `{ "policy": "fingerprint" }` |
| Channels | `production` (App Store, TestFlight, Play and sideloaded APK builds: `updates.requestHeaders["expo-channel-name"]` in `app.json`). `preview` exists on EAS but no build listens to it yet |
| Publish | `scripts/ota.sh "<message>"` or the **OTA update** workflow |
| Signing | none: EAS Update code signing needs a paid EAS plan (see Signing) |

## What may ship over the air (store policy)

Only **JS and asset bug fixes and improvements** that leave the app doing what it was submitted to do: syncing and showing data from the user's own watch.

- Apple: interpreted code may be downloaded as long as it does not change the app's primary purpose or add features inconsistent with what was reviewed (guidelines 3.3.1 and 4.7; the same rule sits in the Developer Program License Agreement). The code runs in React Native's own JS engine, not a downloaded native binary.
- Google Play: the Device and Network Abuse policy forbids an app from modifying or replacing itself by any method other than Play's update mechanism, with an exception for code that runs in an interpreter or VM that only reaches Android APIs indirectly. Hermes JS is that case. Native code never ships over the air.

Fine over the air: layout, copy, spacing, logic fixes, calculations, new screens built from what the app already does, image assets.

**Not** over the air, ship a reviewed build:

- a new primary purpose, or a feature the store listing and review notes do not describe;
- new permissions or a new use of an existing one (Bluetooth, location, Health, notifications), new data collection or sharing (Play Data safety, App Store privacy labels), new SDKs or trackers, new cloud endpoints for data the policies list;
- anything that opens a store of other code, or bypasses OS signing or sandboxing;
- native code (`modules/huawei-wear`, `plugins/`), `app.json` native settings, native dependencies (they cannot ship over the air anyway, see below).

Wording above is our reading of the policies; read the current Apple and Google text before a gray-area change.

## How a build and an update find each other: runtimeVersion

`runtimeVersion` policy `fingerprint`: every binary embeds a hash of its native side, and the update server only offers an update published for **that** hash. An update can therefore never land on a binary with incompatible native code. A mismatch is silent and safe: the app keeps running what it has (the server answers 204).

What goes into the hash (checked with `expo-updates runtimeversion:resolve`, whole list in its `fingerprintSources`):

- the whole resolved Expo config of `app.json`, **including `version`, `ios.buildNumber`, `extra` (API and cloud URLs, Facebook app id), name, scheme, permissions, plugin list and `updates`**;
- the source of local config plugins (`plugins/*.js`), icon and splash images;
- every autolinked native package and the local module `modules/huawei-wear` (directory contents, so a native dependency bump, add, or a Swift/Kotlin edit);
- `scripts` in `package.json`, and `.gitignore`.

Not in the hash: JS and TS source, JS-only dependencies, the generated `android/` and `ios/` folders (gitignored, expo-updates ignores them so a prebuild changes nothing), `versionCode` (set at build time by `plugins/with-version-code.js`), `JOYOFIT_DISTRIBUTION` (Gradle only; Play and sideload builds share one runtimeVersion and one JS bundle).

Consequences:

- Bumping `version` or `ios.buildNumber` in `app.json`, changing an `extra` URL, or touching any native-relevant line creates a **new runtimeVersion**. Updates published afterwards only reach binaries built from that state. Commits that only change JS leave it alone.
- Check what a commit resolves to: `scripts/ota.sh --runtime`. The About screen "Quick updates" block shows the first 8 characters of the runtime a device runs; they must match what `ota.sh` prints for the update to reach it.

## Behaviour in the app

- `updates.checkAutomatically: ON_LOAD`, `fallbackToCacheTimeout: 0`: on cold start the app launches immediately with the newest bundle it already has (embedded or a downloaded update), checks the server in the background and downloads a newer update. It is applied on the **next cold start**.
- `src/features/updates/useOtaUpdate.ts` (`expo-updates` `useUpdates`) drives the UI. When an update is downloaded, the in-app update banner (`UpdateBanner`) shows "Update ready to install / Restart to update"; **Restart to update** reloads into it, **Later** keeps going until the next cold start. An OTA banner beats the Play prompt.
- Settings, About, **Quick updates** (`OtaSection.tsx`): status (up to date, checking, downloading with percent, ready, error), channel, which bundle runs (built into the app, or update `<id>` from `<date>`), runtime, **Check for updates** and **Restart to update**.
- On every cold start the app also waits up to 8 s for a newer bundle and reloads into it before showing anything (`refreshOtaAtLaunch`, `docs/force-update.md`).
- On returning to the foreground the app re-checks, at most every 6 hours (`CHECK_THROTTLE_MS`), so a phone that is never cold-started still gets fixes.
- Off in dev clients and Expo Go (`Updates.isEnabled` false): the section and checks do not exist there.
- **Failure falls back to the embedded bundle.** A failed check or download changes nothing. A downloaded update that crashes on start is dropped by expo-updates' launch error recovery and the app runs the previous or embedded bundle. (Not exercised on a device in this session: do the test below after the first OTA-enabled build.)

## When the printed runtime does not match the installed one

`scripts/ota.sh --runtime` computes the fingerprint on a clean tree. The Gradle build of a store binary computes it **while it runs**
(`expo-updates` `createUpdatesResources`, generated files already in the module and app directories), and the two can differ: the
Play build 1470409 (CI, 9688a11) carries `e542e6f1...` while `--runtime` and the OTA workflow print `ed436776...` for the same sources.
An update published for the printed hash reaches nobody. Read what the binary carries:

- Android: `unzip -p base.apk assets/fingerprint` (`adb shell pm path <package>`, `adb pull`), or Settings, About, Quick updates (first 8 characters).
- Publish for exactly that value: `scripts/ota.sh --platform android --runtime-version <40 hex> "message"`, or the OTA workflow's `runtime_version` input (single platform).

The next store build will carry whatever its Gradle step computes; read it from that binary again before the first update.

## Publish

```
scripts/ota.sh "Fix the workout list header on small phones"     # production, android + ios
scripts/ota.sh --platform ios "Copy fix"                         # one platform
scripts/ota.sh --runtime                                         # runtimeVersion only
```

It runs `bun scripts/i18n-check.ts` (translation key parity and hard-coded UI text, docs/i18n.md), `bunx tsrs --noEmit` (the typecheck, a failure aborts the script) and `bun test ./src/`, then per platform a release `expo export` (fails when the bundle holds no app code), then `eas update --channel production --skip-bundler` with that bundle, and prints one line per platform:

```
android  channel=production  runtimeVersion=<hash>  group=<update group id>
```

Android and iOS are two update groups (different runtimeVersion). Nothing goes to a store.

The same from GitHub: Actions, **OTA update**, Run workflow (`message`, `channel`, `platform`). The job is bound to the `release` environment (owner approval, default branch only) and uses its `EXPO_TOKEN` secret. The group ids land in the job summary.

## Roll back

Instant, no store involved. Devices pick it up at their next check (next cold start or foreground re-check).

```
bunx eas-cli update:rollback <group id> --non-interactive
```

The group must be the **latest** one of its branch and runtimeVersion (the id `ota.sh` just printed). It republishes the update group published before it, or a "roll back to embedded" directive when there is none. Other options:

```
bunx eas-cli update:roll-back-to-embedded --channel production --runtime-version <hash> --platform android
bunx eas-cli update:republish --group <older group id>        # re-publish a specific earlier update
bunx eas-cli update:list --branch production                  # find group ids
```

Or just publish a corrected fix with `scripts/ota.sh`. Roll Android and iOS back separately (two groups).

## Which branch publishes to which runtime

Written 2026-10-18. Master carries native changes (BLE sensors, phone recording, native module edits) since merge `4a2aeb4`, so its fingerprint differs from the binaries installed before it. One rule keeps both groups of devices fixable:

| Installed build | Runtime | Publish from |
| --- | --- | --- |
| Store and TestFlight builds made before the sensors merge (including JoyoFit 1.0 build 0830 in review) | Android `e542e6f1...`, iOS `43df410f...` | branch **`ota/1.0`**, created at tag `ota-base-e542e6f1` (master as it was the last OTA source for them, `5bf951f`) |
| Builds made from master after the sensors merge | the "New runtimes" below | **`master`** |

- **Old runtimes: `ota/1.0` only.** Cherry-pick JS-only fixes onto it from master (`git cherry-pick -x <sha>`). A fix that touches native code, `app.json` native settings or a native dependency does not belong there and cannot reach those binaries anyway. Publish from a checkout of `ota/1.0` with `scripts/ota.sh --platform <p> --runtime-version <hash> "message"`, with the hash read from the binary (see "When the printed runtime does not match the installed one": the fingerprint printed for a clean tree is not always what the Gradle build embedded). `ota/1.0` is not an allowed branch of the `release` environment, so the **OTA update** workflow cannot run from it; use the script locally. Never merge `ota/1.0` into master.
- **New runtime: master only.** `scripts/ota.sh` and the **OTA update** workflow on master publish for the runtime master resolves to. A master commit that changes the runtime (native code, `app.json`, a native dependency, `version`) needs a new store build before its updates reach anyone.
- A master commit never reaches an old binary by accident: the server only offers an update whose runtime equals the one the binary embeds.
- Features go to master as soon as they are green. No long-lived feature branches: they are what stopped master from being a safe OTA source.

### New runtimes

Read from the binaries of the store build cut from master `8461444` (2026-10-18), not from `scripts/ota.sh --runtime` (see "When the printed runtime does not match the installed one"):

| Platform | Build | Runtime embedded in the binary | `ota.sh --runtime` on `8461444` |
| --- | --- | --- | --- |
| Android | AAB versionCode 1470815 (`assets/fingerprint`) | `1fe3a3e01c827e0364b68fcef03752c681b8cdbe` | `71b7dc6b9006dfd9ee793ecbe4e92837130a8628` |
| iOS | TestFlight 1.0 (202610180938) (`EXUpdates.bundle/fingerprint`) | `62b33b49c9d0ac991f023d22487f71d7c60b63c0` | `b805b384f29fabf875bf568341b487e32c88bf23` |

Publish for the embedded values: `scripts/ota.sh --platform <p> --runtime-version <hash> "message"`.

### Runtimes of the 2026-10-18 store build (master `375f052`)

Read from the binaries of the Release Android run 39135259956 (AAB versionCode 1471097, Play internal + alpha) and the Release iOS run 39135263189 (TestFlight 1.0 build 202610181417, Internal + Publik):

| Platform | Build | Runtime embedded in the binary |
| --- | --- | --- |
| Android | AAB versionCode 1471097 (`assets/fingerprint`); the sideload APK of the same commit carries the same value | `81a992248b4f15cc3f439a19323d19ae4e6c9252` |
| iOS | TestFlight 1.0 (202610181417) (`EXUpdates.bundle/fingerprint`) | `60ae9d289f32d564fee79956251795a11e147d56` |

Older lines stay for stragglers: `ota/1.0` for Android `e542e6f1...` and iOS `43df410f...`, `ota/tf-938` for iOS `62b33b49...`, `ota/test-c6a262a2` for the sideload build 1470978, `ota/r-81a99224` for Android 1471097.

### Runtimes of the 2026-10-19 Android build (master `060869c`)

Release Android run 39190705172 (AAB versionCode 1471837, Play alpha; sideload APK 1471849):

| Platform | Build | Runtime embedded in the binary |
| --- | --- | --- |
| Android | AAB 1471837 and APK 1471849 (`assets/fingerprint`) | `b8054fd8e97aebc2218a38e6b0b117bbf3452628` |

**Master Android OTAs target `b8054fd8...`.** Branch `ota/r-b8054fd8` marks the commit of this build.

The iOS TestFlight build 1.0 (202610190340, master `96a9076`, Release iOS run 39195739996) embeds the same `60ae9d289f32d564fee79956251795a11e147d56` as 202610181417: no native iOS change since. **Master iOS OTAs target `60ae9d28...`** and reach both builds.

### Runtimes of the 2026-10-26 store builds (master `3b858088` / `24e5be5d`)

Read from the binaries (`assets/fingerprint`, `EXUpdates.bundle/fingerprint`). `scripts/ota.sh --runtime` on these commits prints
android `d890d9c9...` and ios `78141fcc...`, so publish with `--runtime-version`:

| Platform | Build | Runtime embedded in the binary |
| --- | --- | --- |
| Android | Play alpha AAB 1482533, sideload APK 1482543 (Release Android run 40325811530, `24e5be5d`) | `a239d6c83ad2202e9ad232ce9167a505691cf88a` |
| iOS | TestFlight 1.1 (202610261252) (Release iOS run 40325806773, `24e5be5d`) | `dbe7aff58af45ad0b7cd989e1510416cba613938` |

OTAs published for them: #33 Huawei Scale (groups `d96332a3...` ios, `9f701897...` android) and master `276b89e3` (privacy link,
neutral Strava text, offline-map search; groups `bb45ff92...` ios, `7c1e4275...` android). Master after `276b89e3` carries native
changes (#35 JoyoNavi phone side, #39 manual Strava upload) and can no longer publish to these runtimes: JS-only fixes for them
go on a branch cut at `276b89e3`.

### Runtimes of the 2026-10-27 store builds (master `c7e52731`)

| Platform | Build | Runtime embedded in the binary |
| --- | --- | --- |
| Android | Play alpha AAB 1483205, sideload APK 1483219 (Release Android run 40423944217) | `fce68de9bfdc78401cfb69ead4b7585bb7491879` |
| iOS | TestFlight 1.1 (202610270004) (Release iOS run 40423947811) | `d6db9df49ebdcbda73dd9b8dfa5b7c1bc274ca08` |

**Master OTAs target these two** (with `--runtime-version`) until the next native change.

## When OTA is not enough

Anything that changes the runtimeVersion, or is on the "not over the air" list above, needs a new binary: build through `scripts/build-release.sh` / `scripts/build-ios-mac.sh` / the `Release *` workflows, and from that commit on updates target the new runtime. Binaries that stay on an older runtime keep getting updates from their own branch, see "Which branch publishes to which runtime" (`ota/1.0` for the pre-sensors builds).

Binaries built before expo-updates was added have no OTA and never will.

`scripts/build-ios-linux.sh` refuses to run: the Xcode-free pipeline does not embed the expo-updates resources (`app.manifest`, runtime in `Expo.plist`) [inference: a binary without them would start with updates on and nothing embedded]. Build iOS on the Mac or in the `Release iOS` workflow. `JOYO_ALLOW_IOS_LINUX_WITHOUT_UPDATES=1` overrides.

## Signing

EAS Update code signing (`codeSigningCertificate`, `eas update --private-key-path`) is **not enabled**: publishing with a key fails with "EAS Update code signing requires a subscription to the EAS Production or Enterprise plan" on the free account `dzulfikar08` (seen on 2026-10-18). A binary that embeds a certificate rejects unsigned updates, so config and plan must change together. Without it, trust rests on TLS to `u.expo.dev` plus control of the Expo account and the `EXPO_TOKEN` secret: keep 2FA on the Expo account.

To turn it on after upgrading the plan: `bunx expo-updates codesigning:generate --key-output-directory ~/.config/joyofit/ota --certificate-output-directory code-signing --certificate-validity-duration-years 10 --certificate-common-name joyofit`, add `updates.codeSigningCertificate` and `codeSigningMetadata` (`keyid: main`, `alg: rsa-v1_5-sha256`) to `app.json`, commit the certificate (`.gitignore` ignores `*.pem`: add `!/code-signing/certificate.pem`), pass `--private-key-path` in `scripts/ota.sh`, put the private key in an `OTA_PRIVATE_KEY` secret of the `release` environment and write it to a temp file in `ota.yml`. Then **every** binary built after that expects signed updates.

## Accounts and secrets

- Expo account `dzulfikar08`; project `joyofit` already existed; channels created with `eas channel:create production|preview`.
- `EXPO_TOKEN`: personal access token "github-actions-ota" (expo.dev, Account settings, Access tokens), stored as the `release` environment secret of `dzulfikar08/joyofit` and in `~/.config/joyofit/expo-token` (mode 600). Revoke it on that page if it leaks; local runs use the `eas login` session instead.

## Testing after the first OTA-enabled build

1. Install the build. Settings, About, Quick updates: "Built into the app", channel `production` and the 8-character runtime. `scripts/ota.sh --runtime` must print the same prefix for the platform.
2. Publish a visible JS change: `scripts/ota.sh --platform <p> "test"`. Cold start the app twice: the first start downloads (the banner "Update ready to install" appears when it finishes), the second runs it; the section shows "Update <id> (<date>)".
3. `bunx eas-cli update:rollback <group> --non-interactive`, cold start twice: back to "Built into the app".
4. Airplane mode, cold start: the app starts normally.
