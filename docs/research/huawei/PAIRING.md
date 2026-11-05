# Huawei Health 17.0.8.300 pairing flow vs JoyoFit's setup guide

Source: the owner's own pairing of a Watch Fit 4 Pro on 2026-10-25, Xiaomi 2506BPN68G, Android 16. The screen order and timings come from
`logcat.txt` (`wm_on_resume_called`); the screenshots of the first screens are in `pairing/`. The pairing-guide screen itself was not
screenshotted: the only other device in range was a stranger's Band 9, so CONNECT was not tapped again.

## Huawei Health, in order

| # | Time | Activity | What it does |
|---|---|---|---|
| 1 | 08:42:48 | `adddevice.OneKeyScanActivity` | Devices → Add device. The scan **starts at once** with a radar animation (permissions were granted earlier). Every device it finds becomes a row with its name and one **CONNECT** button. Two fallbacks sit at the bottom: **ADD MANUALLY** (searchable list of series with product photos: Watch Fit, Ultimate, Porsche Design, Watch Buds…) and **SCAN** (QR code). (`pairing/01_add_device.png`, `02_add_manually.png`) |
| 2 | 08:44:48 → 08:46:32 | `pairing.DevicePairGuideActivity` | Full-screen guide while the bond, the authentication and the watch's accept happen (about 1 min 44 s here). It shows the watch and what to tap on it. |
| 3 | 08:46:32 | `agreement.AgreementDeclarationActivity` | Device data / terms declaration, one screen. |
| 4 | 08:46:46 | `pairing.KeepAliveTipsActivity` | Keep-alive tips: battery optimisation and background running for this phone. |
| 5 | 08:46:46 | `AccountPickerSignInHubActivity` | HMS account (Huawei-only; no JoyoFit equivalent needed). |
| 6 | 08:46:56 | `notification.NotificationOpenActivity` | Turn on notification forwarding to the watch. |
| 7 | 08:47:16 | `homewear21.home.WearHomeOldActivity` | Device home. Meanwhile the **first sync and the satellite (A-GPS) update run by themselves**: two downloads at 08:47:12 and 08:47:14, about 30 s after pairing. No sync step asks the person to wait. |

## JoyoFit today (`src/features/onboarding/flow.ts`, `steps/PairStep.tsx`)

welcome → unbind (from Huawei Health) → **pair** → **sync** → notifications → health → weather → background → account → pro → cloud → done.

The pair step:
- **Before scanning:** a pre-prompt card with three numbered bullets and **Continue**. Bluetooth is asked for only after that.
- **The list:** the same `AvailableWatchesSection` the Watch tab uses (watch rows with connect/forget buttons), plus `WatchStatusCard`.
- **During the connect:** a one-line `Notice` ("keep the watch awake") and the `BindConfirmDialog` when the watch already has a phone.

## What is worth copying

1. **Scan on arrival, with one big card per watch found.** Huawei Health skips the text pre-prompt: the radar is the explanation. JoyoFit could open the permission prompt as soon as the pair step mounts and show each watch found as a card with the model's picture and one Connect button. The `WatchModels` catalogue already maps the advertised name to a model.
2. **A dedicated "confirm on your watch" screen during the connect**, in place of a one-line notice. A picture of the watch with the tick to tap, the elapsed time, and what to do if nothing appears. It covers the `connecting`/`authenticating`/`initializing` states; `navigationLocked` already locks the step then.
3. **"Add manually" by model, with photos**, for when the scan finds nothing. It goes to the model's help (how to put it in pairing mode) instead of a blank list.
4. **No separate wait for the first sync.** Huawei Health lands on the device home and syncs (and updates satellite data) in the background. JoyoFit's `sync` step could become a progress line on the next steps instead of a gate.
5. **Keep-alive tips as their own short step right after pairing.** JoyoFit has `background`, but four steps later. Huawei Health puts it straight after pairing, while the person is still paying attention to the watch link.

Not to copy: the account picker and the data declaration (Huawei-specific), and the QR scan (JoyoFit cannot read the watch's QR content in any useful way [INFERENCE: the QR carries the BT address and a model id, and the scan already gives both]).
