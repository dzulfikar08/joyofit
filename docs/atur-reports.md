# Watch reports in Atur

**Watch, Help support your watch, Send report** (and **Send report** in "Jam tersambung tapi tidak menjawab") files the support report as an issue on the JoyoFit board in [Atur](https://app.diatur.com), the owner's own tracker. It replaces "copy the text and mail it": the maintainers get the whole log, the device facts and a way to answer, as one issue per report. **Report on GitHub** and **Share text** stay.

No Atur code was needed: Atur already has a public, token-keyed feedback API (`docs/feedback-portal.md` in the Atur repo), the same one its own mobile app files reports with (`source: "native"`).

## What is sent

Only after the person taps **Send** in the form (`AturReportForm`):

| Part | Where it lands in the issue |
| --- | --- |
| Title `[Watch report] <model> (<support>)` | issue title |
| What the person wrote (optional, 1500 characters) + the summary (cut to 4000 characters in all) | description |
| Summary + the whole log, one `joyofit-report-<time>.txt` (`text/plain`, 10 MB cap; the log is at most 1000 lines, about 40 to 200 KB) | attachment, readable by workspace members only |
| `app_version`, platform, OS version, user agent | Context block |
| `report_id`, watch, model, support level, app, build (version + native build + OTA id), phone, product, transport, link state, created, locale, log line count | Context block (`extra`) |
| Email (optional, filled from the JoyoRogo account, editable) and the JoyoRogo account id and name when signed in | reporter line + `feedback_meta` |

The disconnect history and the latest disconnects are in the summary (right after `Link:`) and in the attachment. Bluetooth addresses and the serial number are redacted on the phone by `SupportReport` before anything leaves it.

The report is filed as `kind: "bug"`, `source: "native"`. The email is **unverified** in Atur's terms (no identify signature): the issue shows "submitted without verification", it creates no customer or ticket, and staff write back by email from the address on the issue. Verifying it would need a server of ours to sign `id:email` with the board's identify secret; not built.

## Calls

```
POST {ATUR_FEEDBACK_URL}/api/feedback/{token}/attachments   multipart "file"   -> 201 { id }
POST {ATUR_FEEDBACK_URL}/api/feedback/{token}/items         json               -> 201 { id, sequence_id, url }
```

The token is the board's **public token** (`pk_fb_...`). It can only create reports and upload files for that one board (Atur limits: 10 items and 15 uploads per minute per IP, 60 uploads per minute per board, 50 files / 200 MB of unclaimed uploads, files 10 MB). It cannot read issues, attachments or members; the only thing it reads is the board's public ideas, which bug reports never are. It is meant to ship in an app, so it is a plain constant, not a secret. Anyone who extracts it can file junk reports or post ideas on the board; rotate it by disabling and re-creating the board.

## Offline queue

`aturReportQueue.ts`: a report that fails with no network, 408, 425, 429 or 5xx is kept in `expo-sqlite/kv-store` (key `support.aturQueue`, newest 3) and the form says so. `flushSupportReports()` runs at launch and every time the app returns to the foreground (`src/app/_layout.tsx`). A refusal that will not change (400, 403, 404, 413, 415) is shown on the form, or dropped when it surfaces while flushing. A retry after a lost answer can file a report twice; both carry the same `report_id` in the Context block.

## Setup (once, by the owner)

1. In Atur, workspace `watchfit`, project Development: **Project settings, Feedback**, enable the board. Suggested: title "JoyoFit watch reports", voting and comments off, default state Triage (or Backlog), submit label `watch-report`.
2. Copy the board's **public token** into `PUBLISHED_ATUR_FEEDBACK_TOKEN` in `src/features/device/aturConfig.ts`. It is deliberately not in `app.json` `extra`: that would change the runtime version (`docs/ota.md`). A JS-only edit ships over the air. While the constant is empty the button is hidden.
3. Ship it as an OTA update. No native change is involved.
4. Update the privacy page (`site/src/Privasi.tsx`, already worded for this) by deploying the site.

Local test: run Atur (`cd apps/app && bun run dev`), create a board, and start Expo with `EXPO_PUBLIC_ATUR_FEEDBACK_URL=http://<lan-ip>:<port> EXPO_PUBLIC_ATUR_FEEDBACK_TOKEN=pk_fb_...`.

## Code

| File | Role |
| --- | --- |
| `src/features/device/aturConfig.ts` | URL and token, `ATUR_REPORTS_ENABLED` |
| `src/features/device/aturReport.ts` | `buildReport` (pure), `itemBody`, `sendReport` (upload then item) |
| `src/features/device/aturReportQueue.ts` | queue and flush with an injected store and sender |
| `src/features/device/aturReports.ts` | wires the phone: support report, temp file, kv-store, `fetch` |
| `src/features/device/AturReportForm.tsx` | the form |
