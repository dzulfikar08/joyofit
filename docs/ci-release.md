# CI: checks and release builds

Written 2026-10-17. Three workflows in `.github/workflows/`. The repo is public, so GitHub-hosted runners (macOS included) cost nothing.

| Workflow | Runs on | Needs secrets | Does |
| --- | --- | --- | --- |
| `ci.yml` | pull requests, pushes to `master`, manual | none (safe for forks, read-only token) | jobs in parallel: app (`tsrs`, `bun test ./src/`, `check-api.mjs`, `packages/hwt` tests + types), server (`tsrs`, vitest), site (typecheck + build), Kotlin (unit tests of the three modules after `expo prebuild`, then Android Lint `NewApi` only, see below), Swift tests for `HuaweiProtocol` and `ModuleLogicTests` (Swift 6.4.1 on Ubuntu) plus `check-inert-shapes.mjs` |
| `release-android.yml` | **manual only** (`workflow_dispatch`) | yes, environment `release` | ubuntu, JDK 17, Bun, Gradle cache: `scripts/build-release.sh --play` (AAB + forbidden-permission guard) and/or `scripts/build-release.sh` (sideload APK); artifacts; optional Play upload |
| `release-ios.yml` | **manual only** | yes, environment `release` | `scripts/ios/mac-build.sh` on `macos-latest`: expo prebuild, pods, `xcodebuild archive` + export, IPA checks, optional TestFlight upload |

Android Lint `NewApi` (`./gradlew :huawei-wear:lintDebug :ble-sensors:lintDebug :replay-encoder:lintDebug`, config in `modules/newapi-lint.gradle`, applied by each module) fails the job on a call to an API newer than `minSdk` 29 that is not behind a `Build.VERSION.SDK_INT` check. Without it that kind of call compiles and works on the developer's phone and throws `NoSuchMethodError` on an older one (`PackageManager.ResolveInfoFlags.of`, API 33, crashed the notification app chooser on Android 12). Only `NewApi` is on, so unrelated lint findings never block a build; each finding is printed to the job log with its file and line.

The release workflows are ready but never fire by themselves. Tag triggers (`v*`) are commented out at the top of each file; uncomment them to build on tags (the `release` approval below still applies).

## Typecheck

Every type-only check runs [tsrs](https://github.com/oxc-project/tsrs) (`tsrs --noEmit`, a Rust port of the TypeScript 7 checker, same flags and `tsconfig.json`), pinned to an exact version as a devDependency in the root, `web/`, `site/`, `server/` and `packages/hwt/` (each has its own `package.json` and lockfile). Where it runs: `bun run typecheck` in each of those, `scripts/ota.sh` step 1 (it gates every OTA: `set -e`, a type error exits 2 and nothing is exported or published), the `app`, `server` and `site` jobs of `ci.yml` (the site one through `bun run build`), `web`'s `build`, and `modules/huawei-wear/ios/ModuleLogicTests/check-inert-shapes.mjs`.

`typescript` (6.0.3 at the root) stays as a devDependency: `expo lint` runs typescript-eslint through eslint-config-expo, which needs the `typescript` package, and so do editors; tsrs replaces only the `tsc` command. No script calls `tsc` any more. Bump tsrs by hand (its version names the TypeScript commit it follows) and re-run `bun run typecheck` in the five projects; on a mismatch with tsc, compare with `bunx tsc --noEmit` first.

Parity with tsc 6.0.3 on this tree (2026-10-21, tsrs 0.18.0-ts7.1.0-dev.20260929, Linux x64, shared laptop so times are rough): both pass clean on all five projects. With deliberate errors in scratch edits (not committed: a wrong argument type, a wrong assigned type, a missing property, an unknown name, plus one wrong type in each other project) the diagnostics were byte-identical in every project. Wall time, `--noEmit`, first run after install / mean of the next two:

| Project | tsc | tsrs |
| --- | --- | --- |
| root app | 23.7 s / 29.0 s | 1.9 s / 2.1 s |
| `web/` | 6.8 s / 7.9 s | 0.5 s / 0.4 s |
| `site/` | 6.8 s / 6.0 s | 0.3 s / 0.35 s |
| `server/` | 3.7 s / 3.7 s | 0.2 s / 0.2 s |
| `packages/hwt/` | 1.6 s / 1.6 s | 0.1 s / 0.1 s |

Neither tool writes an incremental cache here, so "cold" is the first run and "warm" is a repeat with the OS file cache hot.

## Build numbers

The workflows call the same scripts as the laptop, so the numbers follow the same scheme and CI and local builds never collide:

- Android `versionCode` = minutes since 2024-01-01 UTC (`(now - 1704067200) / 60`).
- iOS `CFBundleVersion` = `YYYYMMDDHHMM` in UTC (`BUILD_NUMBER` overrides).

## Running a release

Actions tab -> workflow -> **Run workflow**, or:

```bash
gh workflow run release-android.yml -R dzulfikar08/joyofit -f target=play-aab -f play_track=none   # artifact only
gh workflow run release-android.yml -R dzulfikar08/joyofit -f target=play-aab -f play_track=alpha -f play_status=draft
gh workflow run release-ios.yml -R dzulfikar08/joyofit -f upload_testflight=false
```

The job waits for the owner's approval (environment `release`): Actions run page -> **Review deployments** -> tick `release` -> Approve. Via API: `gh api -X POST repos/dzulfikar08/joyofit/actions/runs/<run-id>/pending_deployments -F 'environment_ids[]=<env-id>' -f state=approved -f comment=ok` (`environment_ids` from `GET .../runs/<run-id>/pending_deployments`).

Results are workflow artifacts (30 days): `joyofit-android-<run>` (AAB and/or sideload APK, checksums in the run summary) and `joyofit-ios-<run>` (IPA). Nothing is uploaded to a store unless you choose it:

- **Play**: `play_track` = `internal`, `alpha` (the API name of the closed-testing track the app is on today) or `beta`. `play_status` = `draft` (default, finish the rollout in Play Console) or `completed`. Production is deliberately not offered.
- **TestFlight**: tick `upload_testflight`. The IPA goes to App Store Connect (altool); add it to an internal testing group in App Store Connect.


## GitHub setup (done)

- Environment `release`: required reviewer `dzulfikar08` (self-review allowed, this is a one-person repo), deployments only from `master` and `v*` tags. All release secrets are **environment secrets**, so a workflow on any other branch cannot read them.
- Workflows use only `workflow_dispatch` (and optional tag push), never `pull_request_target`; PR runs (`ci.yml`) get no secrets. Every action is pinned to a commit SHA (version in the trailing comment); `GITHUB_TOKEN` is `contents: read`.
- Signing files are written to the runner at build time and deleted in a final `always()` step; secret values are never echoed.

## Secrets (environment `release`)

Set with `gh secret set NAME --env release -R dzulfikar08/joyofit` (value from stdin or `< file`). Never commit these files.

| Secret | Used by | Source |
| --- | --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Android | base64 of `keystore/joyofit-release.jks` (from `~/.config/joyofit/keystore.tar.gpg`) |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Android | `keystore/keystore.properties` in the same archive |
| `PLAY_SERVICE_ACCOUNT_JSON` | Android, Play upload | `~/.config/joyorogo/play-billing-sa.json` |
| `ASC_KEY_BASE64` | iOS | base64 of `AuthKey_BUU2CPKLGM.p8` (App Store Connect API key) |
| `ASC_KEY_ID` | iOS | `BUU2CPKLGM` |
| `ASC_ISSUER_ID` | iOS | `9e34111d-e39f-4122-9000-6eb4628fe9b9` |
| `IOS_DIST_CERT_P12_BASE64`, `IOS_DIST_CERT_PASSWORD` | iOS | `.p12` of the Apple Distribution identity the Linux pipeline signs with (`~/.config/joyorogo-ios/distribution/{cert.der,key.pem}`), made with a random password, see "iOS signing" |

Refresh commands (run on the laptop):

```bash
cd "$(mktemp -d)" && gpg --batch --pinentry-mode loopback --passphrase-file ~/.config/joyofit/keystore-backup-passphrase \
  --decrypt ~/.config/joyofit/keystore.tar.gpg | tar -xf -
base64 -w0 keystore/joyofit-release.jks | gh secret set ANDROID_KEYSTORE_BASE64 --env release -R dzulfikar08/joyofit
# the three passwords/alias: read them from keystore/keystore.properties and pipe each into gh secret set (no echo)
gh secret set PLAY_SERVICE_ACCOUNT_JSON --env release -R dzulfikar08/joyofit < ~/.config/joyorogo/play-billing-sa.json
base64 -w0 ~/Downloads/AuthKey_BUU2CPKLGM.p8 | gh secret set ASC_KEY_BASE64 --env release -R dzulfikar08/joyofit
```

## Android notes

- The keystore secrets restore exactly what `gpg --decrypt secrets/keystore.tar.gpg` restores locally; the workflow checks nothing else in your home directory.
- The sideload APK (`target = sideload-apk` or `both`) is built with the same `scripts/build-release.sh` and is only a workflow artifact; JoyoFit has no site publish step.
- The Play build is signed with the release key: the dry-run AAB's signer SHA-256 equals the keystore's (`E4:A5:12:CA:...:C8:A9:D2`).
- Play upload uses `PLAY_SERVICE_ACCOUNT_JSON` (`joyorogo-play-billing@joyorogo.iam.gserviceaccount.com`), which has release-management rights. Uploads to the alpha track work (versionCode 1483205 on 2026-10-27). Check what each track holds with the read-only **Play tracks** workflow (`play-tracks.yml`).
- **A Play upload cancels the review in progress.** Managed publishing is off, so every committed edit sends all pending changes (production, closed testing, App content) to review again and cancels the submission before it (Publishing overview, Submission activity: submissions 23 to 27 between 2026-10-23 and 10-26 were all canceled this way, so nothing was published after 2026-10-20 and testers saw no update). `status: completed` in the API only means the track holds the release; it reaches testers when Google approves the submission (up to 7 days). While a submission is in review, build with `play_track = none` (sideload APK, OTA) and upload to Play only after it is approved, at most once per review.

## iOS signing

Same split as `scripts/build-ios-mac.sh` (`docs/ios-mac.md`), because a fresh runner has no keychain identity and the API key cannot create a cloud-managed distribution certificate (`Cloud signing permission error`; the team also already holds the maximum of three Apple Distribution certificates):

The app embeds the rest-timer Live Activity extension (`targets/rest-timer`, target `RestTimerActivity`, bundle id `com.joyodigitama.joyofit.resttimer`), so there are two bundle ids and two App Store profiles. The extension needs no capability, no App Group and no entitlement (Live Activities are enabled by `NSSupportsLiveActivities` in the app's Info.plist only).

1. With `EXPORT_PROFILE` and `EXPORT_WIDGET_PROFILE` set (the CI and `scripts/build-ios-mac.sh` path), `mac-build.sh` sets both targets to manual signing (Apple Distribution identity, the target's profile) before the archive, so `xcodebuild` never signs in to the account. Without them it archives automatically with the API key and exports automatically.
2. The job imports `IOS_DIST_CERT_P12_BASE64` into a temporary keychain, `scripts/ios/asc-ci-profile.py` finds that certificate on App Store Connect by serial and, for each of the two bundle ids, reuses or creates the App Store profile `joyo-ci <bundle id> <cert id>` (separate from the `joyo-mac` and Linux profiles, so no flow invalidates another's). It registers the extension's bundle id in App Store Connect when it is missing (`asc-mac-profile.py` does the same through `asc.bundle_id`). `mac-build.sh` exports with both profiles in `provisioningProfiles`, then checks the IPA: Apple Distribution authority, no device list, `get-task-allow` false, entitlements and bundle contents of the app, and bundle id, version, extension point and signature of `PlugIns/RestTimerActivity.appex`.

No owner step is needed (the extension's App ID is created by the scripts with the API key, which has access to Certificates, Identifiers & Profiles): the `.p12` was made from the certificate and key the Linux pipeline already uses. To rebuild it (new certificate, new password):

```bash
cd ~/.config/joyorogo-ios/distribution
pw=$(openssl rand -hex 16)
openssl x509 -inform der -in cert.der -out /tmp/cert.pem
openssl pkcs12 -export -inkey key.pem -in /tmp/cert.pem -out /tmp/dist.p12 -name "Apple Distribution" \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 -password pass:$pw   # old algorithms: macOS `security import` needs them
base64 -w0 /tmp/dist.p12 | gh secret set IOS_DIST_CERT_P12_BASE64 --env release -R dzulfikar08/joyofit
printf %s "$pw" | gh secret set IOS_DIST_CERT_PASSWORD --env release -R dzulfikar08/joyofit
shred -u /tmp/dist.p12 /tmp/cert.pem
```

The certificate expires 2027-10-15; the profile `joyo-ci ...` is recreated by the script when it goes INVALID (for example after enabling a capability in the portal). The runner's Xcode is `latest-stable` (26.6 on the dry run); pick another with the `xcode_version` input. Apple requires Xcode 26 or later for App Store uploads.

## Measured on GitHub-hosted runners (2026-10-17)

| Run | Result | Time |
| --- | --- | --- |
| `release-android.yml`, `both` | green; AAB signed with the release key, permission guard passed, `versionCode` 1469611 on the first run | about 17 min (AAB 14 min, APK 1 min reusing the prebuilt `android/`) |
| `release-ios.yml`, upload off | green; IPA `com.joyodigitama.joyofit` 1.0 (202610171436), `iphoneos26.5`, signed `Apple Distribution: Dzulfikar Ats Tsauri (F6Q6UFUK69)` | about 16 min |
| `ci.yml` | green | longest job 3 min (Kotlin), Swift jobs 2 min, JS jobs under 30 s once cached |

## Switching to CI from the laptop / MacBook builds

1. Check the secrets table above is fully set (`gh secret list --env release -R dzulfikar08/joyofit`).
2. Run `release-android.yml` with `play_track = none` once and compare the AAB with a local one.
3. Run `release-ios.yml` with `upload_testflight` off once and compare with a Mac or Linux IPA.
4. From then on, choose the track / tick the TestFlight upload in the run form instead of running the scripts locally. The scripts stay as the fallback; do not run a local and a CI build in the same minute.

## Branch protection

`master` requires the six `ci.yml` checks to pass (`App, Server, Site, Kotlin, two Swift jobs`), but admins are not enforced, so the owner's direct pushes still go through (GitHub prints "Bypassed rule violations"). To make the checks binding for everyone, including the owner: Settings -> Branches -> `master` -> tick "Do not allow bypassing the above settings", or `gh api -X PATCH repos/dzulfikar08/joyofit/branches/master/protection/enforce_admins` (POST) after which every change needs a pull request with green checks.
