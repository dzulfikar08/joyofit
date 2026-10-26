# Strava in JoyoFit

JoyoFit sends a watch workout to the wearer's own Strava account, from Settings → Strava (button on a workout's screen,
and automatically for workouts that finish after connecting). It is **free while slots are spare**, the same for every
user (owner rule 2026-10-26; Strava API Policy 5.8 forbids charging for anything built on the Strava API, so no plan
changes any Strava behaviour or wording):

- The Strava application's athlete capacity (10) is shared with JoyoRogo (section 1).
- Anyone may connect while a slot is free. An account whose Strava connection has not been used for a while is
  released automatically to give the slot back (JoyoRogo's rule).
- A user who cannot connect (or was released) is pointed to the manual upload on the workout page ('Unggah ke Strava
  (manual)'), which needs no slot (section 7).

JoyoRogo's Worker enforces it (it owns the tokens); JoyoFit's Worker only passes the result on (section 2a).

How it is built is in the README ("Strava"). This page is the owner's runbook: set up the Strava API application, set the
Worker secrets, register the webhook, and pass Strava's review.

Source of truth:

- Authentication: <https://developers.strava.com/docs/authentication/>
- Webhook events: <https://developers.strava.com/docs/webhooks/>
- Brand guidelines: <https://developers.strava.com/guidelines/>
- API Agreement: <https://www.strava.com/legal/api>
- Review/quota request form: <https://share.hsforms.com/1VXSwPUYqSH6IxK0y51FjHwcnkd8>

## 1. One Strava application, shared with JoyoRogo

JoyoFit and JoyoRogo (<https://joyorogo.com>, which imports burned calories from the athlete's Strava activities) use the
**same** Strava API application, client id `287873` (<https://www.strava.com/settings/api>), because the athlete capacity
(10) is per application and a second application would split it. What that means:

- **Scopes.** JoyoFit asks for `activity:write` (and, only when the athlete turns on gear linking, `profile:read_all`, see
  section 3b), JoyoRogo for `read,activity:read_all`. Strava's docs do not say what a
  second authorization does to the first one's scope; they say the athlete can opt out of any scope on the page, that
  the scopes that come back "may differ from the originally-requested list", and that the application must check them
  (<https://developers.strava.com/docs/authentication/>, "Details About Requesting Access" and "Token Exchange"). So
  neither product ever requests only its own scopes once the athlete has granted others: the authorize URL asks for the
  product's scopes **plus every scope already granted** (JoyoRogo computes it: `requestedScope` in
  `packages/api/src/lib/strava-grant.ts`), and each product refuses a grant that lacks the scope it cannot work without
  (`activity:write` for JoyoFit, `activity:read_all` or `activity:read` for JoyoRogo). A connect in one product can
  therefore only widen the grant, never narrow what the other uses.
- **One token store.** Strava keeps one access token and one refresh token per athlete and application: "If the
  application has an access token for the user ...", "Once a new refresh token is returned, the older refresh token is
  invalidated immediately" (same page, "Refreshing Expired Access Tokens"). Two stores, each keeping "the latest" token,
  would invalidate each other whenever one refreshes. So the tokens live **only in JoyoRogo's D1**, table
  `strava_account` (`rogo_linked_at`, `fit_linked_at`, `scope`), and JoyoFit's Worker asks JoyoRogo's Worker for them
  (`POST https://api.joyorogo.com/internal/joyofit/strava/{status,exchange,token,disconnect,deauthorized}`,
  HTTP Basic with the Strava client id and secret, which both Workers hold). The phone still only talks to JoyoFit's
  Worker and still only receives the short-lived access token. JoyoFit's old table `strava_connection` is gone
  (migration `0004_drop_strava_connection.sql`, after its rows were copied into `strava_account`).
- **Disconnect.** A product only unlinks itself. The grant is revoked at Strava (`oauth/revoke`, which "invalidates all
  refresh tokens and access tokens that the application has for the athlete") only when the **last** product unlinks,
  so disconnecting in JoyoFit never cuts JoyoRogo off and the other way round. Deleting the account revokes it outright.
- **Deauthorization.** Strava allows one webhook subscription per application, and it points at this Worker
  (`/strava/webhook`). A deauthorization event (the athlete removed the app on strava.com) is forwarded to JoyoRogo,
  which deletes the tokens for both products and what JoyoRogo imported from Strava. If the forward fails the Worker
  answers 503 so Strava retries the event (the delete is idempotent).
- **No double counting.** A workout JoyoFit uploads carries `external_id = joyofit-<workout start>`. JoyoRogo gets that
  workout from Health Connect / Apple Health (JoyoFit's **Write to Health Connect**), so JoyoRogo's Strava import skips
  every activity whose `external_id` starts with `joyofit-`. Without that export a JoyoFit workout does not appear in
  JoyoRogo's diary; turn the export on.
- **Consent screen.** Strava shows the application's name and description to every athlete who connects, from either
  product. See the recommendation under "Branding" in section 3.

## 2. Owner setup

1. In the Strava application settings set **Authorization Callback Domain** to exactly

   ```
   joyorogo.com
   ```

   (no scheme, no path). Strava accepts any redirect on that domain and its subdomains, which covers all three callbacks:
   JoyoRogo web `https://joyorogo.com/profil/strava/callback`, JoyoRogo's Android/iOS app `joyorogo://joyorogo.com/strava`, and
   this Worker's `https://api.fit.joyorogo.com/strava/callback`. The callback URL of this Worker is derived from the
   request host, so connect only through that host; the old `joyofit-api.dzulfikar-at.workers.dev` host stays up for older
   builds but Strava rejects its callbacks.
2. Set the Worker secrets (from `server/`, never in `wrangler.jsonc`, never in the app). `STRAVA_CLIENT_SECRET` must be
   the **same value on both Workers**: JoyoFit's Worker uses it for the signed OAuth state and to authenticate to
   JoyoRogo, JoyoRogo's Worker uses it to talk to Strava and to check that authentication.

   ```bash
   # JoyoFit (from server/)
   bunx wrangler secret put STRAVA_CLIENT_SECRET          # the application's client secret
   bunx wrangler secret put STRAVA_WEBHOOK_VERIFY_TOKEN   # any random string you choose, e.g. `openssl rand -hex 24`
   # JoyoRogo (from apps/server/ in the joyorogo repo): STRAVA_CLIENT_ID=287873 and
   bunx wrangler secret put STRAVA_CLIENT_SECRET
   ```

   `STRAVA_CLIENT_ID` (`287873`) is a plain var in `server/wrangler.jsonc` (a client id is public).
3. Deploy JoyoRogo first (its D1 migration `0032_strava_shared_grant` adds the scope and link columns to `strava_account`),
   then JoyoFit. The first time, copy JoyoFit's existing connections across before JoyoFit's new code runs, and drop the
   old table afterwards:

   ```bash
   # copy each row of joyofit.strava_connection into joyorogo's strava_account (fit_linked_at = connected_at * 1000,
   # expires_at * 1000, scope as stored), then:
   bun run deploy                  # JoyoFit Worker
   bun run db:migrate:remote       # 0004_drop_strava_connection
   ```

4. Register the **deauthorization webhook**. Strava allows one subscription per application. It validates the callback
   with a `GET` carrying the verify token, so the secret from step 2 must exist first:

   ```bash
   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
     -F client_id=287873 \
     -F client_secret="$STRAVA_CLIENT_SECRET" \
     -F callback_url=https://api.fit.joyorogo.com/strava/webhook \
     -F verify_token="$STRAVA_WEBHOOK_VERIFY_TOKEN"
   ```

   An answer `{"id": N}` means it is live. Check later with
   `curl -G https://www.strava.com/api/v3/push_subscriptions -d client_id=287873 -d client_secret=...`. The Worker only acts
   on the `athlete` / `authorized: "false"` event (it forwards it to JoyoRogo, which deletes that athlete's tokens for both
   products); activity events are acknowledged and ignored. The subscription already exists for application 287873 (it
   points here); do not create a second one from JoyoRogo's side.
5. Capacity. Per Strava's getting-started page (<https://developers.strava.com/docs/getting-started/>): a new application starts in
   single-player mode, where only the owner's own Strava account can authenticate. The owner can upgrade from the API
   settings dashboard to an athlete capacity of 10; once 10 athletes are connected, the application has to be submitted for
   review (the form linked above) before it can grow. **The capacity is shared by JoyoFit and JoyoRogo**: an athlete who
   connects both counts once, but two different athletes count twice. Until the review passes, Strava sync is
   invite-only: people leave their email and Strava profile on <https://fit.joyorogo.com/strava> (stored in D1 table
   `waitlist`, kind `strava`; read it with `scripts/waitlist.sh strava`, see `server/README.md`).

Worker routes (all in `server/src/strava.ts`; none of them touches Strava's token endpoint any more, JoyoRogo does):

| Route | Auth | |
|---|---|---|
| `GET /v1/strava` | JoyoRogo session | `{ configured, connected, athleteId, connectedAt, gearScope }`; `connected` means JoyoFit is linked **and** the grant has `activity:write`; `gearScope` is true when the grant also has `profile:read_all` (JoyoRogo's `requestedScope` is JoyoFit's own scope plus everything granted, and JoyoFit's own never contains it) |
| `GET /v1/strava/authorize[?gear=1]` | JoyoRogo session | `{ url }`: Strava's `oauth/mobile/authorize`, scope `activity:write` plus whatever the athlete already granted JoyoRogo (plus `profile:read_all` with `gear=1`), signed `state` |
| `POST /v1/strava/token` | JoyoRogo session | `{ accessToken, expiresAt, athleteId }`; refreshed by JoyoRogo when it expires within 10 minutes; `409 strava_not_connected` otherwise |
| `POST /v1/strava/disconnect` | JoyoRogo session | unlinks JoyoFit; JoyoRogo revokes at Strava (`oauth/revoke`, Basic auth) and deletes the grant only if JoyoRogo is not linked too (`revoked` says which) |
| `GET /strava/callback` | none (Strava redirect) | hands the code to JoyoRogo, redirects to `joyofit://settings/strava?status=connected` (or `status=error&reason=...`) |
| `GET /strava/webhook` | verify token | Strava's subscription validation: echoes `hub.challenge` |
| `POST /strava/webhook` | none (Strava) | deauthorization event is forwarded to JoyoRogo (tokens of both products deleted); `503` when the forward fails so Strava retries, `200` otherwise |

The refresh token never leaves JoyoRogo's database; the client secret is in both Workers' secrets and the phone never sees
either. The phone receives only the access token (6 h lifetime).

JoyoRogo's side of the same contract (joyorogo repo): `apps/server/src/strava.ts` (the `/internal/joyofit/strava/*` routes) and
`packages/api/src/lib/strava-grant.ts` (scopes, exchange, refresh with the rotation race handled, unlink, deauthorization).

### 2a. Slots (capacity)

JoyoRogo's `POST /internal/joyofit/strava/status` adds two optional fields while the user is not connected:
`slotsFull` (every slot is taken, so the user may not connect now) and `released` (`{ at }`, unix seconds: the last
grant was released because it had not been used for a while). `GET /v1/strava` passes them through (nothing else
JoyoRogo might add); `GET /v1/strava/authorize` answers 409 `{ error: "slots_full" }` instead of a URL when the user is
not connected and `slotsFull` is true (a connected user's re-authorization, `?gear=1`, is unaffected). If JoyoRogo
refuses an exchange for capacity (409 `{ error: "slots_full" }`, the fresh grant already revoked), the callback
redirects with `reason=slots_full`. The app then shows "Slot Strava penuh" (or "Koneksi Strava dilepas karena lama
tidak dipakai" after a release), hides the connect button and points to 'Unggah ke Strava (manual)'. An older JoyoRogo
without these fields behaves as before.

**Manual upload switch.** The manual Strava upload (the user saves a file and uploads it on strava.com) is a workaround
for everyone while Strava capacity is limited, not tied to any plan. `GET /v1/strava` carries `manualUpload: boolean` in
every shape (not configured, not connected, connected), read from the Worker var `STRAVA_MANUAL_UPLOAD` in
`server/wrangler.jsonc`: `"on"` (the default; unset or anything else counts as on) or `"off"`. **Turn it off when Strava
grants extended capacity (9,999 athletes); turn it back on if the slots fill up again.** Change the var and run
`bunx wrangler deploy` in `server/`; the app reads it with the next status check, no app update needed.

## 3. What Strava's rules mean here

| Rule | How JoyoFit follows it |
|---|---|
| Strava sync must be free (API Agreement 5.8, API Policy 5.8) | No plan check anywhere: not on any Strava route, not in the app, not in who gets one of the 10 slots (first come, idle accounts released, the same for everyone). The manual upload needs no connection. |
| No Strava data into AI/analytics (5.3 / 5.4) | The app reads nothing from Strava except the status of its own upload and, only after the athlete grants `profile:read_all`, their own shoes and bikes (section 3b). JoyoRogo's database holds the athlete id and tokens only on JoyoFit's behalf. JoyoFit sends no Strava data anywhere; only the athlete id and the user id travel between the two Workers. |
| Show Strava data only to its owner | The only Strava data shown is the link to the activity the wearer uploaded and, in the gear picker, their own shoes and bikes, on that wearer's phone. |
| Deauthorization webhook | `POST /strava/webhook` forwards the deauthorization of an athlete who revokes the app on strava.com to JoyoRogo, which deletes the tokens (both products) at once. |
| Tokens in the Authorization header | Uploads and polling use `Authorization: Bearer`; the client secret only appears in the Worker's server-to-server calls. |
| Brand | Official "Connect with Strava" button and "Compatible with Strava" logo, unmodified (`assets/strava/`), linking to `oauth/mobile/authorize`; "View on Strava" text link in `#FC5200`, bold, underlined; the app name does not contain "Strava". |

**Branding (recommendation, not applied).** Strava shows the application's name, icon and description on the consent
screen of both products, so a JoyoRogo user currently sees "JoyoFit". Rename the application to **JoyoRogo & JoyoFit**
(still no "Strava" in the name, the brand guideline), keep the website `https://joyorogo.com`, and describe both uses
in the description, for example: *"JoyoRogo (calorie diary) and JoyoFit (Huawei watch app) from Joyo Digitama.
JoyoFit sends your watch workouts to your Strava account; JoyoRogo reads your Strava activities to count the calories you
burned. Free while slots are spare. Remove access any time in Strava or in either app."* Use a neutral Joyo mark as the icon if there is one
(JoyoFit's icon alone would again name only one product). Do the same in the review form, and show both apps' own names
in their screenshots.

Upload details (so the numbers on Strava are the watch's): a FIT activity file (`data_type=fit`, binary multipart body;
<https://developers.strava.com/docs/uploads/#fit-flexible-and-interoperable-data-transfer>) with every sample from start
to end as a `record` (position, heart rate, altitude, per-record cumulative distance: the watch's distance spread over the
active time, so the stretches before the first and after the last GPS fix move at the average speed instead of reading as
stopped), timer start and stop `event`s, one `lap` and one `session` carrying `total_elapsed_time`, `total_timer_time` (the watch's active
time), `total_distance`, `total_calories`, heart rate, `total_ascent`/`total_descent`, speeds and, for running, walking and
hiking, `total_cycles` (strides = steps / 2) and `avg_cadence`, and an `activity`. The sport comes from the FIT
`session.sport`/`sub_sport` mapped from the Huawei sport type; the form's `sport_type` overrides what Strava detects from the
file. The recording device is the watch (section 3a); Strava shows no device line for it yet. `external_id = joyofit-<workout start>` (a second upload of the same workout is refused by Strava
as a duplicate and the app then links the existing activity). Per-sample speed, cadence and step length are written only where the stored points have
them (watch workouts synced after migration 12, FIT imports, phone recordings): a foot sport's cadence goes out per leg with `fractional_cadence`
(FIT counts one foot), and the session and the single lap carry the cadence the workout screen shows (`cadenceFigures`: samples, then the summary, then
the watch's per-km blocks, then the step count over the active time), its maximum and `avg_step_length`; a phone recording's laps carry their own cadence.
Nothing is invented per record. The watch gives no list of pauses. Strava's moving time (<https://support.strava.com/en-us/articles/15401804-moving-time-speed-and-pace-calculations>)
comes from the file's timer events when it has any and is otherwise recomputed from the GPS and distance stream (it ignores
`total_timer_time`: the first FIT showed 32:33 for 36:09 walked). So when the watch's elapsed time exceeds its active time by
30 s or more, the file gets a timer stop and start `elapsed - active` long, centred on the longest gap between GPS fixes
(else between samples), and the record distance is flat across it. The pause's length is the watch's; its exact position is
not stored by the watch, so it can be off by the difference between the GPS gap and the pause (seconds).

**The app shows the numbers Strava shows.** One set of figures serves the workout screen, the list, the analysis card, the
share image, the JoyoRogo post and this file (`src/features/workouts/times.ts`, `analysis/elevation.ts`,
`analysis/series.ts`):

| Figure | Rule | Why |
|---|---|---|
| Distance | The watch's total (`workouts.distance`) everywhere. The GPS track only draws the map and shapes the splits: its path length is scaled so the last sample is exactly the watch total, and the unrecorded start and end (before the first fix, after the last) move at the average speed, as in the file's `withDistance`. | The GPS path of the owner's 18 Oct walk was 1.97 km, the watch and Strava 2.01 km. |
| Moving time | The watch's active time (`workouts.duration`) when it is at least 30 s shorter than the elapsed time (`end - start`), a pause; otherwise the elapsed time. The file's `total_timer_time` follows the same rule. "Elapsed" is shown next to it only when they differ. | Strava takes the moving time of our file from its timer events and record stream, which cover the whole workout except a pause. The watch timer and `end - start` differ by 3 s on the owner's walk (25:23 against 25:26); the stored data cannot say why (rounding cannot make 3 s; a timer starting after the start stamp or a stop stamp written after the timer stops can). It is not a pause, and Strava shows 25:26 for moving and elapsed time. The app used to detect pauses from the GPS speed (24:18). |
| Pace, speed | Distance over moving time. | Strava's 12:39 per km is 2,010 m over 25:26; the watch's own 12:38 is over its timer. |
| Elevation gain and loss | A 60 s centred moving mean of the altitude, then a 1 m hysteresis (`ELEVATION_SMOOTH_SEC`, `ELEVATION_HYSTERESIS_M`); the file's `total_ascent` and `total_descent` are the same figures. An imported file keeps its own totals. | The watch's value is the sum of every barometer rise (59 m); Strava replaces the altitude with its terrain model (24 m on the owner's walk) and the method is fitted to its results, see the comment in `elevation.ts`. |
| Calories, heart rate, steps | The watch totals, as before. | They already matched Strava (143 kcal, 127/156 bpm, 2,672 steps). |

The regression tests are `src/features/workouts/analysis/stravaParity.test.ts`, with the altitude and heart rate of the walk
and of two others in `stravaWalks.fixture.ts` (positions left out: a route is a home address). To get more data points:
open `https://www.strava.com/activities/<id>/export_original` in a logged-in browser for the original file; the figures
Strava shows are in `https://www.strava.com/athlete/training_activities?...` (`elevation_gain_raw`, `moving_time_raw`).

### 3a. The device line ("HUAWEI WATCH FIT 4 Pro")

What Strava does (checked 2026-10-18, owner's account):

- Strava documents it (<https://developers.strava.com/docs/uploads/>, "Device and Elevation Data" and "Device Mapping"): the device
  is detected from the **manufacturer and product ids of the FIT `file_id`**, matched against Strava's own list of known
  devices; `product_name` is not part of the match. A device is added to that list on request (form below) and the
  manufacturer id "must be assigned to your company by ANT+".
- **Huawei Health's own uploads show no device line either.** Activity 20575074754 (Huawei Watch Fit 4 Pro, exported with
  "Export Original" and decoded with `@garmin/fitsdk`): `file_id` = manufacturer 255 (development), product 1, no
  `device_info`, no `lap`/`event`, session sport 11 (walking) / sub_sport 30 (casual walking); the activity page's device section
  holds only "Shoes". The text "Walk 2026-10-14 06:13:07 HUAWEI WATCH FIT 4 Pro" is the **activity description** Huawei Health
  writes, not a device line. A Garmin upload (activity 18400565455) has `file_id` manufacturer `garmin`, product 4432 (fr165),
  `device_info` with `product`/`software_version` and shows "Garmin Forerunner 165".
- The FIT SDK profile (21.218) has a `huawei` manufacturer (348), none for Honor, and no Huawei product list.
- **Test (owner's OK, one upload, deleted straight after):** a FIT with `file_id` manufacturer 348, product 20196 and
  creator `device_info` named `HUAWEI WATCH FIT 4 Pro` (what `buildFit` writes now) was uploaded through strava.com's upload
  page. Strava showed no device line (device section: "Shoes" only). So writing the fields is necessary but not enough: Strava
  has to add (348, product) to its device list.

What JoyoFit writes (`src/features/strava/device.ts`, `activityFile.ts`): `file_id` manufacturer, product, `product_name`, and a
creator `device_info` (device_index 0, manufacturer, product, `product_name`, `software_version` = firmware major.minor in
hundredths, source_type local) for the watch that recorded the workout (the most recently synced row of the `device` table;
never for imported workouts), then a second `device_info` (index 1, manufacturer 255, product 1, `JoyoFit`) for the software that
wrote the file. A Huawei watch is written as manufacturer 348, the brand that made it; Honor and unknown names stay
manufacturer 255 (the SDK has no Honor id), so a brand is never replaced by another. The product id is a CRC-16 of the model name
(1..65534), because Huawei publishes none: it only keeps models apart. The regression test
`src/features/strava/device.test.ts` compares with Huawei Health's file (`huaweiHealth.fixture.ts`: totals and layout, no route).

**Device Mapping request** (only Huawei, or someone it authorizes, can honestly file it; the form asks for the company's exact
name, the exact device name, a product page, official support contact, whether it has a barometer, and a sample file per type):
<https://form.asana.com/?k=k1dbH0mkk6GTUXy1IL8vsQ&d=8527572679841>. Text for the owner to send to developers@strava.com or use in the
form if Strava allows a third-party app to file it:

> Application: JoyoFit (Strava client id 287873), by Joyo Digitama. JoyoFit uploads workouts recorded by Huawei watches as FIT
> activity files. We would like the activity page to show the recording watch. The files carry `file_id.manufacturer` = 348
> (huawei, FIT SDK 21.218) and a stable `product` per model, with the model name in `file_id.product_name` and in the
> creator `device_info.product_name`:
>
> | Device name | manufacturer | product |
> |---|---|---|
> | HUAWEI WATCH FIT 4 Pro | 348 | 20196 |
> | (every other model: `productId(name)` in `src/features/strava/device.ts`, CRC-16/CCITT-FALSE of the lower-cased model name, mod 65534, plus 1) | 348 | |
>
> These product numbers are ours: Huawei has not published any. Samples attached (activity files from the owner's watch).

Alternatives that work today without Strava: write the watch name in the activity **description**, as Huawei Health does
(`description` upload field; JoyoFit uses that field only for the opt-in link). Not done: it is not the device line the owner asked for.

### 3b. Gear (shoes and bikes)

JoyoFit keeps gear on the phone (Settings, Gear; tables `gear`, `gear_default`, `workout_gear`, created from JS so the change
ships over the air, see README "Gear") and, for JoyoRogo Pro accounts, in the Worker (`gear_doc`, `GET`/`PUT /v1/gear`). The Strava
side is a link per gear:

- The Strava API cannot create gear. `PUT /api/v3/activities/{id}` with `gear_id` (`g12345` shoes, `b12345` bike, `none`) sets an
  existing Strava gear on an activity and needs `activity:write` (we have it). `GET /api/v3/athlete` returns the athlete's `bikes`
  and `shoes` only with **`profile:read_all`** (<https://developers.strava.com/docs/authentication/>, scopes).
- **Re-consent.** Settings, Strava, "Link gear to Strava" opens the authorize URL with `?gear=1`: the athlete sees one more
  permission (read all profile information), and `GET /v1/strava` reports `gearScope: true` afterwards. Declining it on Strava's
  page leaves everything else working. JoyoRogo's grant keeps the scope (`requestedScope` is the union) and a later JoyoRogo
  connect asks for it too, so neither product drops it.
- **Link.** In a gear's editor "Strava gear" lists the athlete's shoes (or bikes) from `GET /athlete`; the choice stores the Strava id
  on the gear. The list is read only to show it to its owner on their own phone; the **Strava gear name is kept on the phone only**
  (the cloud document carries the id, never the name), and shoes and bikes are only offered for matching sports (Strava refuses
  a bike on a run).
- **After each upload** (`src/cloud/strava.ts`), and whenever a workout's gear is changed afterwards, JoyoFit sets `gear_id` with
  `PUT /activities/{id}`; `strava_gear_sent` remembers what Strava has so nothing is sent twice. A failure leaves the upload `done` and is retried on the next run.
- **Review.** The review form (<https://share.hsforms.com/1VXSwPUYqSH6IxK0y51FjHwcnkd8>) has no scope field; it asks for the
  application description (use cases of Strava data) and "screenshots of ALL places Strava data is shown". The gear list is Strava
  data shown to its owner, so the description must say it and a screenshot of the gear picker must be included. Section 4 has the text.
  The application is at **10 of 10 athletes** (Settings, My API Application, 2026-10-18), so the review is the only way to
  connect an 11th athlete.

## 4. Review submission checklist

Submit through the form <https://share.hsforms.com/1VXSwPUYqSH6IxK0y51FjHwcnkd8> (it asks for the application, what it does,
screenshots and how athlete data is handled). Before sending:

- [ ] Application name does not contain "Strava" and names both products (see Branding above); icon is ours, not a Strava
      mark. Website `https://joyorogo.com`, Authorization Callback Domain as in section 2.
- [ ] Both Workers have the same `STRAVA_CLIENT_SECRET` and the webhook subscription exists (`GET push_subscriptions` shows it).
- [ ] A test run with a second Strava account works end to end: connect, finish a workout, it appears on Strava with the
      watch's distance, calories, heart rate and route; disconnect; removing the app on strava.com then makes
      `strava_account` lose the row (`bunx wrangler d1 execute joyorogo-database-live-dzul-unqpixpckdt72ct3 --remote --command "select count(*) from strava_account"`).
- [ ] Privacy policy (<https://fit.joyorogo.com/privasi>) mentions Strava: what is sent (workout file), that tokens are kept
      on JoyoRogo's server until you disconnect or revoke, and how to remove them.
- [ ] Screenshots (Android, light theme is fine), each showing the app's own name:
  1. Settings → Strava, not connected: the official **Connect with Strava** button and the "Compatible with Strava" logo.
  2. Strava's authorization page with the `activity:write` permission ("Upload your activities").
  3. Settings → Strava, connected: the connected state, the description switch (off) and **Disconnect Strava**.
  4. A workout screen with **Send to Strava** (before) and **View on Strava** in orange (after).
  5. The same activity on strava.com or in the Strava app, with the watch's distance, calories and heart rate.
  6. (If asked) the webhook: the `push_subscriptions` view output, or the Worker log of a deauthorization event.
- [ ] State in the form: free for every user, JoyoFit uses `activity:write` (JoyoRogo adds `read,activity:read_all` for its own
      import) and, only when the athlete turns on gear linking, `profile:read_all` to list their own shoes and bikes and put one on
      the uploaded activity (`PUT /activities/{id}` with `gear_id`). JoyoFit uploads only to the wearer's own account; the one thing
      it reads is that gear list, shown only to its owner on their phone (the gear id, never the name, is kept on JoyoFit's server for Pro
      accounts); nothing is shown to others or used for analytics or AI; tokens are deleted on disconnect and on deauthorization.
- [ ] Screenshot 7: Settings, Gear, a gear's editor with the "Strava gear" list (Strava data shown). Screenshot 8: the activity on
      strava.com with the gear JoyoFit set.

## 5. Troubleshooting

- `redirect_uri invalid` on Strava's page: the callback domain in the Strava application is not `joyorogo.com` (section 2),
  or the build still uses the old cloud host.
- Connecting in JoyoFit ends with `reason=scope_missing`: the athlete unchecked "upload your activities" on Strava's page.
  A grant nobody else uses is revoked; one that JoyoRogo uses is left as it was.
- Connecting in JoyoFit ends with `reason=strava_unreachable` or the status call answers 502: JoyoRogo's Worker
  (`api.joyorogo.com`) is not answering `/internal/joyofit/strava/*`; check that both Workers have the same `STRAVA_CLIENT_SECRET`
  (JoyoRogo answers 401 on a different one, 503 on none).
- The app says Strava is "not set up on the JoyoFit server": `STRAVA_CLIENT_SECRET` is not set (`GET /v1/strava` answers `configured: false`).
- Subscription creation fails: the verify token secret is missing or differs from `verify_token`, or the Worker is not
  deployed with this change; test with
  `curl 'https://api.fit.joyorogo.com/strava/webhook?hub.mode=subscribe&hub.challenge=x&hub.verify_token=<token>'`.
- Connected but nothing uploads: only workouts that **ended after** the connect time go up automatically; older ones need
  **Send to Strava**. Imported (Huawei export) workouts are never sent automatically.
- iOS: connecting opens Strava in an `ASWebAuthenticationSession` (`WebBrowser.openAuthSessionAsync`, which takes the
  callback scheme `joyofit` from `joyofit://settings/strava`). The Worker's 302 to that URL ends the session and returns to
  the app; the Strava app is not opened from inside the session, the web page is used. Automatic uploads on iOS only run
  while the app is in front (and each time it comes back): iOS suspends the app, and the keychain item holding the JoyoRogo
  session cannot be read while the phone is locked. A workout the watch synced in the background is therefore sent when
  JoyoFit is opened.
- iOS: Strava says `redirect_uri invalid` although the callback domain is right: that build still carries the old cloud host
  (`joyofit-api.dzulfikar-at.workers.dev`) in its embedded `app.config` (TestFlight builds up to 202610160308 did, because the
  pipeline never regenerated it; see `docs/ios-linux.md`). Install a newer build.
- A workout shows "Strava refused the file": the message is Strava's; the button retries after you fix the cause.

## 6. Tests

- `bun test ./src/` (also `bun run test`): `src/features/strava/fitEncoder.test.ts` (CRC, header, every field type, buffer
  growth) and `activityFile.test.ts` (the file built from workouts, decoded back with Garmin's `@garmin/fitsdk`, a devDependency
  used only by the tests: totals, record count, positions, heart rate, distance scaling, full-span samples, sport mapping,
  duplicate detection, upload form), `device.test.ts` (device fields, compared with Huawei Health's own file in
  `huaweiHealth.fixture.ts`) and `src/features/gear/*.test.ts` (gear model, store over `bun:sqlite`, cloud merge).
- `cd server && bun run test`: `server/test/strava.test.ts` (signed state, authorize URL with the granted scope, code hand-off
  and the error reasons, status and token mapping, disconnect, webhook validation and forwarding; JoyoRogo's grant API is
  faked in `test/helpers.ts`). The grant logic itself is tested in the joyorogo repo, `packages/api/src/lib/strava-grant.test.ts`.
- Manual upload (section 7): `src/features/strava/manualUpload.test.ts` (the file is the API upload's FIT byte for byte under the
  API upload's name, which requests get the file, waiting for the file, the screen's state), `manualStore.test.ts` (the mark, and
  that the API flow and the mark leave each other alone), the web view's navigation rule in `WebPolicyTest.kt` (with the desktop
  user agent) and its Swift twin `modules/strava-upload-web/ios/WebLogicTests` (`swift test`).

## 7. Manual upload (no API connection)

The shared Strava API application has room for a limited number of athletes until Strava approves it for more (section 1),
so not everyone can connect. **Upload to Strava (manual)** puts one workout on Strava without the connection: it is the
upload a person does on a computer at `https://www.strava.com/upload/select`, made as close to one tap as Strava's rules
allow. It is offered on the workout screen's Strava card whenever the API upload cannot run (not connected, not signed in
to JoyoRogo, or Strava refused the file) and always in the workout menu (⋮).

**Flow.** The app builds the same FIT file the API upload sends (`buildWorkoutFit`, `manualUploadFile`), writes it to the
cache as `joyofit-<workout start>.fit` (`fitFileName`, the API upload's file name too) and opens
`app/workouts/strava-upload.tsx`: Strava's upload page in a web view (`modules/strava-upload-web`), requested as the desktop
site because Strava offers the file upload only there. The person logs in to Strava there themselves and taps Strava's own
**Choose files**. When the page's file input asks the browser for a file, the app answers that request with the workout's
file instead of opening a picker; the person then finishes on Strava. Taps with a Strava login in place: **Upload to Strava
(manual)**, **Choose files**, then whatever Strava asks to confirm the activity (its "Save & View"); **Already uploaded**
marks it on the phone.

| Platform | How the file reaches the page |
|---|---|
| Android | `WebChromeClient.onShowFileChooser` (API 21): every file request goes to JS (`onFileRequest`), which answers with the file's `file://` URI (`answerFileRequest`). No system picker. |
| iOS 18.4 and later | `WKUIDelegate.webView(_:runOpenPanelWith:initiatedByFrame:completionHandler:)`, available on iOS since 18.4 (<https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:runopenpanelwith:initiatedbyframe:completionhandler:)>, WebKit commit 284471@main). Same as Android. |
| iOS 16.4 to 18.3 | WebKit always shows its own picker and gives the app no say. The screen says so and offers **Save to Files** (the share sheet); the person picks `joyofit-<start>.fit` from Files in Strava's picker. A "Files › JoyoFit" folder is not offered: it would need `UIFileSharingEnabled`, which shows the whole Documents folder, and expo-sqlite keeps `joyofit.db` there. |

Only a request from `https://(www.)strava.com/upload…` whose input is not a photo, video or audio picker gets the file
(`takesWorkoutFile`); any other is cancelled. A request that comes before the file is written waits for it.

**Strava's terms.** The Terms of Service (<https://www.strava.com/legal/terms>, the version of 2026-09-28) say: "Automated
access to or collection of data from the Services—by any means, including data mining, robots, screen scraping, scripts, or
similar data-gathering tools or software such as browser extensions and crawlers—is prohibited." So the web view is a plain
browser for the person:

- JoyoFit injects no JavaScript, presses nothing, fills nothing in, and reads nothing from Strava's pages (no status, no
  activity id, no HTML). The page's own scripts run, as in any browser.
- The only hook is the browser's file request, answered with the person's own file after the person tapped Strava's own
  **Choose files**: the same file a computer's file dialog would give.
- The login happens on Strava's page; its cookies stay in the web view's own store (Android `CookieManager`, iOS the default
  `WKWebsiteDataStore`). JoyoFit never sees or stores the Strava password or cookies.
- Asking for the desktop site (Android: the user agent Chrome sends with "Desktop site" ticked, `WebPolicy.desktopUserAgent`;
  iOS: `WKWebpagePreferences.preferredContentMode = .desktop`, Safari's "Request Desktop Website") is what the person would
  otherwise have to switch on in their browser.
- Links to other apps (`strava:`, `intent:`, `mailto:`) do not open from the web view (`WebPolicy.opensInWebView`).
- No Strava logo: the entry is plain text ("Upload to Strava (manual)"), as the brand guidelines allow (`docs/brand-marks.md`).

**Login.** Google does not allow its sign-in in embedded web views (Google OAuth 2.0 Policies,
<https://developers.google.com/identity/protocols/oauth2/policies>, "Use secure browsers"; blocked since 30 September 2021),
so **Sign in with Google** on Strava's page fails inside the app. The screen says to log in with email and password. Apple and
Facebook sign-in were not tested in the web view and are not promised. Someone with a Google-only Strava account uses **Open
in browser**: it saves the file (Android: the export folder picker, remembered like the Export card's Save; iOS: the share
sheet, "Save to Files"), then opens `strava.com/upload/select` in the phone's browser with a note to switch on its desktop
site and pick the file.

**State.** Nothing is read back from Strava. **Already uploaded** stores the time in `strava_manual_upload`
(`workout_start`, `marked_at`; `src/features/strava/manualStore.ts`), shown on the workout's Strava card with **Not uploaded
after all** to undo it. It is apart from `strava_upload` on purpose: that table is the API upload's own state, emptied when the
connection goes or changes athlete, and its rows decide what the automatic upload sends. A workout uploaded by hand and later
sent through the API (the button, or the automatic upload of a workout that ended after connecting) gets Strava's duplicate
answer, which the API flow already turns into `done` with a link to the existing activity. Strava itself also refuses a second
upload of the same file on its upload page. The mark is user data (`USER_DATA_TABLES`) and, like `strava_upload`, stays when
the workout is deleted.

Differences from the API upload: Strava names the activity itself and takes the sport from the file (`session.sport`), and no
description, gear or `external_id` is set (those are API form fields, not in the file).

**Build.** `modules/strava-upload-web` is a native module (Kotlin + Swift), so this needs a new binary; the fingerprint
runtime (`docs/ota.md`) keeps an OTA of it away from older binaries. Nothing new leaves the phone toward JoyoFit's or
JoyoRogo's servers: the file goes from the phone to Strava, sent by the person.
