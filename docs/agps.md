# Satellite data (A-GPS) for the watch

The Huawei Watch Fit 4 Pro (and the rest of the family) shows a warning that its GNSS data has expired and says it needs Huawei Health.
That is the watch's satellite assistance data (ephemeris / almanac). Without it GPS fixes get slow. This page records what the protocol is,
what JoyoFit can and cannot do about it, why, and what is implemented.

**Short version.** JoyoFit answers the watch's request, serves the public Broadcom LTO file when (and only when) the watch asks for that
kind, declines every other kind, and shows honestly what happened. It cannot clear the warning on a watch that asks for Huawei's own predicted
data (`HW_PGNSS_PRED`): that data is prepared by Huawei's app from Huawei servers, with formats nobody has fully documented, and the watch does
not check what it is given. The `HW_AGNSS` kind (asked by the Band 11 Pro, and by the Fit 4 Pro in the Huawei Health capture of 2026-10-25) can be
rebuilt from open data: since 2026-10-25 an **experimental switch, off by default** (Settings > Tentang & lanjutan > Eksperimental), serves it
from JoyoFit's own server for a lab test on the owner's watch (owner decision, 2026-10-25). Its acceptance by any watch is unverified. Since stage 2
(2026-10-25) a **second, separate switch, also off by default**, answers `HW_PGNSS_PRED` with six files in Huawei Health's layout generated from public data
(`~/re/agps/FORMAT.md`; "Lab path for `HW_PGNSS_PRED`"); equally unverified, and riskier (three days of predicted orbits the watch keeps).

Code (Android): `modules/huawei-wear/android/.../Ephemeris.kt` (exchange, status, update now), `EphemerisDownload.kt` (HTTP, cache),
`AgpsSource.kt` (where the data comes from), `AgpsPolicy.kt` (schedule, validation), `PgnssBundle.kt` (the `HW_PGNSS_PRED` kind and bundle check), `AgpsStore.kt` (persisted state),
`AgpsModuleApi.kt` (JS API). Code (iOS, `modules/huawei-wear/ios`): `Ephemeris.swift` (`AgpsExchange`, `EphemerisLink`), `AgpsSource.swift` (source,
HTTP, Caches copy), `AgpsStore.swift`, `AgpsReachability.swift`, and in `HuaweiProtocol/Sources/HuaweiProtocol`: `AgpsWire.swift` (`AgpsPolicy`,
`AgpsMessages`, `AgpsLab`), `PgnssBundle.swift` and `Packet+FileChunk.swift` (the `1C/05` frames). UI: `src/features/device/AgpsSection.tsx`, `agps.ts`, the switches in
`src/app/settings/advanced.tsx`. Server: `server/src/agps.ts` with the encoder in `packages/agps-rtcm`, and `server/src/agpsPgnss.ts` with the generator in
`packages/agps-pgnss` ("PGNSS lab path"). **The Watch tab row is hidden** unless the
watch's last ask was download version 0, or exactly `HW_AGNSS` / `HW_PGNSS_PRED` with that kind's experimental switch on (`agpsVisible`; owner decisions 2026-10-18 and
2026-10-25). Wire details:
`protocol/README.md`, section "AGPS / ephemeris".

## How it works on the wire

- Service `0x1F` (ephemeris) with the file service `0x1C` carries it. **The watch drives**: it sends `1F/01` op 1 ("I need data", no useful
  content, like a permission check); the phone answers `100000` (or `100007` without network) and asks `1F/02` for the watch's parameters; the
  watch answers with a download **version**, a **tag list** and URLs; the phone says `1F/03` ready (3) / failed (4) / unsupported (5); the
  watch then pulls the files over `1C/01..06` (file list, consult, file info, data request, frames, done), one request after the other.
- The update is started by the user **on the watch**: Settings > Workout settings > Location Services > Satellite updates > Update
  ([Huawei support](https://consumer.huawei.com/eg-en/support/content/en-gb16056995), lists the Watch Fit 4 Pro; it also says devices after the
  Watch 4 series can update through a Wi-Fi network or eSIM, and that data should be refreshed every 1 to 2 days).
- Gadgetbridge does **not download anything**: `HuaweiEphemerisManager` reads a user-supplied `ephemeris.zip` copied out of Huawei Health.
  Its maintainer's summary ([issue 3928](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/3928)): the phone cannot push data unasked;
  Huawei Health downloads from Huawei servers (some URLs need authorization) and converts the answers into proprietary binary files with a
  short time to live; every requested file is required; there is no way to skip a request; the watch does not validate the files, and wrong
  data bootlooped his watch and wedged its GPS (hard reset or firmware update to recover).
- Service `0x18` (`GpsAndTime`, `SendGpsDataRequest`) is something else: the phone's *location* streamed to the watch during a workout. The Fit 4
  Pro asks for it about every 20 s while an outdoor workout runs (`LiveWorkout.gpsPing`). It is what speeds up the first fix without any
  satellite file (Gadgetbridge reports 1 to 2 minutes instead of 10 or more).
  Android only: that stream needs precise location, and the one-time explanation at first launch is easy to dismiss with "Nanti saja", so the Watch tab shows
  `GpsAssistNotice` (a paired watch and no `ACCESS_FINE_LOCATION`) with an "Izinkan lokasi" button, or "Buka pengaturan" after "don't ask again". The stream runs in the
  `connectedDevice` foreground service, not one of type `location`; whether Android lets it keep reading GPS with the screen off is unverified [INFERENCE].

## What kinds the watch asks for

| Download version | Tags | Source | JoyoFit |
|---|---|---|---|
| 0 | none (URLs in the consult) | Broadcom LTO file, `https://gllto.glpals.com/7day/v6/latest/lto.dat` | served, only when the watch asks for version 0 |
| 1 to 3 | exactly one tag ending `/HW_AGNSS` | JoyoFit's server, built from BKG open broadcast ephemeris (`GET /v1/agps/hw-agnss`, see "Lab path") | **experimental switch on**: state 3, one file `HW_AGNSS_RTCM_33`; switch off (default): declined like the row below |
| 1 to 3 | exactly one tag whose last segment is `HW_PGNSS_PRED` (not the `SEVEN` variant) | JoyoFit's server, predicted ephemeris from public data in Huawei Health's layout (`GET /v1/agps/hw-pgnss`, see "Lab path for `HW_PGNSS_PRED`") | **its own experimental switch on**: state 3, six files `HW_PGNSS_GPS`, `_BDS`, `_GLONASS`, `_GALILEO`, `_QZS`, `_EXTRA`; switch off (default): declined like the row below |
| 1 to 3 | `HW_AGNSS` (`HW_AGNSS_RTCM_33`), `HW_PGNSS_*` (GPS, GLONASS, GALILEO, BDS, QZS, EXTRA, `HW_PGNSS_PRED`, `HW_PGNSS_TRANS`), `MTK_EPO_*`, `HW_RSMC_*`, `HW_PRECSION_ION` | Huawei servers and MediaTek EPO, converted by Huawei Health | declined: state 4 "failed", outcome `unsupported`; nothing else is ever offered instead |

What each watch asked for, from JoyoFit's own logs (consult answer, tag names only), plus the external captures:

| Watch | Asks | Evidence |
|---|---|---|
| Huawei Band 11 Pro (Candy-B49WG, software 6.0.0.130(SP3C00M03)), asks on its own (twice, 21 s apart, in the log) | **one kind**: download version 3, tag `higeo/v1/gnssinfo?type=0x0004/HW_AGNSS` (38 characters) | support-report log of 2026-10-19 23:26 +07:00 (the "often disconnects" report): `AGPS: consult answer: download version 3, tag 38 chars (HW_AGNSS), 0 urls`, then our `1F/03` state 4, the watch acknowledged `7f=000186A0` |
| Huawei Watch Fit 4 Pro (6.1.0.117), only when the update is started on the watch | to JoyoFit: **one kind**, download version 3, tag `com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2/HW_PGNSS_PRED;` (67 characters). To Huawei Health (17.0.8.300) on 2026-10-25: **three requests**, the PRED kind (six `HW_PGNSS_*` files), `higeo/v1/gnssinfo?type=0x0024/HW_AGNSS` (38 characters, download version 3) and a ~57-character one that HH itself declined [INFERENCE: `HW_PRECSION_ION`] | logcat 2026-10-18 22:06 to 22:07, see "Observed on the watch's own ask"; Bluetooth capture of 2026-10-25 08:47 WIB (`~/re/agps/FORMAT.md` section 8) |
| Huawei Watch GT 4 (not ours) | `HW_AGNSS_RTCM_33`, `HW_PGNSS_GPS/GLONASS/GALILEO/BDS/QZS/EXTRA`, `MTK_EPO_BDS_GAL`, `MTK_EPO_GPS_GLN`, one after the other | Gadgetbridge issue 3928, comments by Me7c7 (author of Gadgetbridge's Huawei ephemeris code) |

So "file status 4" in a support log is **JoyoFit's own answer** ("failed"), not a rejection by the watch: the watch accepted the answer and no file transfer
(`1C`) ever started. No payload of ours has been refused by a watch. The earlier note "the Fit 4 Pro asks only for `HW_PGNSS_PRED`" was wrong: it is
what the watch asked JoyoFit in the logs we had; with Huawei Health the same watch also asks `HW_AGNSS`. **Capture of 2026-10-25** (Fit 4 Pro 6.1.0.117,
HH 17.0.8.300, link-encrypted payloads, sizes and headers plain): for the `HW_AGNSS` consult HH answered `1F/03` state 3 (ready), and the watch then
pulled exactly one file over `1C`, **`HW_AGNSS_RTCM_33`**, 7 436 bytes in that run (9 `1C/05` chunks). HH writes the server's gunzipped answer
unchanged under that name (jadx `gty.e`). That settles the file name (it was an inference from the community decoder,
<https://codeberg.org/Me7c7/HDataResearch>, `pgnss/HW_AGNSS_RTCM_33_info.cpp`) and the size range (our generator writes 7.4 to 8 KB). The content bytes
were not seen (encrypted), so whether the chip takes exactly our mix of messages is still the open question.

JoyoFit logs the consult (version, tag names) to the status row and the full tag to logcat (tag `JoyoFit`, `AGPS:`) the first time it asks.

Format notes from the community (Me7c7, MIT, <https://codeberg.org/Me7c7/HDataResearch/src/branch/main/pgnss>): `HW_AGNSS_RTCM_33` is RTCM 3.x
ephemeris messages 1019 (GPS), 1020 (GLONASS), 1042 (BeiDou), 1046 (Galileo I/NAV), CRC-24Q; `HW_PGNSS_GPS` is a 72-slot header of
`{time, offset, size}` with 2564-byte blocks of 80-byte ephemeris records, built from `HiEE.dat` (JSON with base64 values, Huawei server);
`MTK_EPO_*` is 72-byte records per satellite with an XOR checksum. His attempt to match the PGNSS data with public ephemeris failed.

## Deep dive (2026-10-21): sources, terms, chips, and what a correct payload would be

### The two sources the owner named are about Huami / Zepp (Amazfit), not Huawei

- [Gadgetbridge "Huami GPS"](https://gadgetbridge.org/internals/topics/huami-gps/): Bip / Zepp OS watches take `cep_pak.bin` + `gps_alm.bin` (from `cep_7days.zip`,
  `cep_alm_pak.zip`), or on Zepp OS an EPO zip or a "UIHH" bundle, flashed by the phone; the page says not all newer devices can be updated this way. Nothing about Huawei.
- [AGPS Helper](https://codeberg.org/citizenserious/agps-helper-android) (MIT, alpha 0.1.0-alpha.6, adapted from `huami-token`, itself MIT) logs in **with the user's Zepp account**
  (`api-user-us2.zepp.com`, `api-mifit-us2.zepp.com`, headers copied from the Zepp app and a Firefox user agent; unofficial, "may stop working at any time"), asks the Zepp file
  service for file types `AGPS_ALM, AGPSZIP, LLE, AGPS, EPO, LTO` (`/apps/com.xiaomi.hm.health/fileTypes/<type>/files`) and builds a UIHH bundle (magic `UIHH`, CRC32, records `0x05`
  gps_alm, `0x0f` gln_alm, `0x86..0x8a` lle_bds/gps/glo/gal/qzss). Its data is Huami's own (CEP / LLE), not u-blox AssistNow, Broadcom LTO or Sony. None of it matches a Huawei
  watch: Huawei has a different protocol (the watch pulls, see below), different file kinds, and no Zepp account would help.
- What carries over is the idea Gadgetbridge uses for Huami: phone gets the vendor's file and hands it over. For Huawei that idea is exactly what is blocked (below).

### How a Huawei watch gets satellite data today

Gadgetbridge master `0735529275` (2026-10-21), `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/`: `service/devices/huawei/HuaweiEphemerisManager.java`
(last changed `29d01ddfe5`, 2026-02-11, "HW_PRECSION_ION workaround. URL contain lat/lon"), `devices/huawei/packets/Ephemeris.java` (service `0x1F`: `01` operator, `02` parameter
consult, `03` file status), `devices/huawei/packets/EphemerisFileUpload.java` (file service `0x1C`: `01` file list, `02` consult, `03` single file info, `04` data request, `05` chunks,
`06` done). It is **not** `HuaweiFileUploadManager`: that is the normal file upload (watch faces, music), a different service. `GpsAndTime` is the phone-location stream (service `0x18`).

1. The watch sends `1F/01` op 1 (no useful content). The phone answers `100000` (ok), `100007` (no network) or an error; on ok it asks `1F/02`.
2. The watch answers with a download version and a tag, which names what it wants and where Huawei Health has to fetch it: `higeo/v1/gnssinfo?type=0x0004/HW_AGNSS`,
   `com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2/HW_PGNSS_PRED;`. Huawei Health asks Huawei's servers (some need authorization; the URL of `HW_PRECSION_ION` carries
   latitude and longitude), converts the answer into the watch's own binary files and answers `1F/03` state 3 (ready; GB uses 5 for "error or timeout"; JoyoFit uses 4 for "failed").
3. The watch pulls: `1C/01` (type 0 or 1, product id) gets a `;`-joined list of file names; `1C/02` agrees protocol, transfer size, max data per request; `1C/03` per file gives size and
   CRC16 (init 0); `1C/04` offset and length of a window, the phone names the stored file `sha256hex(watch address without colons) + name` and streams `1C/05` frames; `1C/06` closes it.
   Codes: `100000` ok, `100001` refused. Type 1 is the one Gadgetbridge implements for versions 1 to 3; for version 0 its code says `fileList = "gpslocation.dat"` is a TODO,
   which JoyoFit does (Broadcom LTO).
4. File names are not `agps.bin` or `gnss_*`. Known names: `HW_AGNSS_RTCM_33`, `HW_PGNSS_GPS`, `HW_PGNSS_GLONASS`, `HW_PGNSS_GALILEO`, `HW_PGNSS_BDS`, `HW_PGNSS_QZS`, `HW_PGNSS_EXTRA`,
   `MTK_EPO_BDS_GAL`, `MTK_EPO_GPS_GLN` (a Watch GT 4; the list differs per watch and firmware). Gadgetbridge only replays an `ephemeris.zip` taken from Huawei Health
   (`time`, `ephemeris_config.json` with `ver`, `uuid`, `files` per tag, files under `<uuid>/`), and refuses it when `time` is older than 30 minutes.
5. Validity: Huawei Health's files live 1 to 30 minutes on the Huawei side (some hold three hours of data) and the server files refresh hourly or slower; Huawei tells owners to update every
   1 to 2 days. The Broadcom file is 7 days. Several requests follow each other and **all** are required; the watch does not validate the files; Gadgetbridge's author bootlooped a
   watch and wedged its GPS with wrong data.

Other Gadgetbridge issues on this: [3928](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/3928) (the research, open since 2024, Me7c7's comments are the source of most facts above),
[6283](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/6283) (Fit 4, closed: "not trivial to generate the necessary files"; Me7c7: at least one request carries longitude and latitude, sending that to Huawei is a privacy leak),
[6340](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/6340) (a Fit 4 user says he links the Huawei account and runs Huawei Health beside Gadgetbridge to update the GNSS data),
and PR 5444, after which a user reported a first fix in 1 to 2 minutes instead of 10+ (the PR itself was not read here; JoyoFit streams the phone's location over service `0x18` already).
The Gadgetbridge Huawei page lists slow GPS as a known issue for that reason.

### Data sources, terms and which watch they could serve

| Source | What it gives | Terms | Matches |
|---|---|---|---|
| Huawei servers (via Huawei Health's calls) | every `HW_*` kind | Huawei API agreement, see "Why Huawei's servers are not used"; some endpoints need Huawei authorization | the only source of `HW_PGNSS_*` / `HW_PGNSS_PRED`, and the format conversion is unknown. **Not used.** |
| Zepp / Huami file service (AGPS Helper) | CEP, LLE, EPO, LTO files for Amazfit | needs the user's Zepp account, unofficial, may break | no Huawei watch |
| u-blox AssistNow | UBX-MGA | needs a per-customer token ([user guide](https://content.u-blox.com/sites/default/files/products/documents/MultiGNSS-Assistance_UserGuide_%28UBX-13004360%29.pdf) section 8); the product page now lists the classic AssistNow as "no longer available" (replaced by a Thingstream service with pricing). Terms not read [INFERENCE: not redistributable] | u-blox chips only; none of the watches asks for UBX |
| Broadcom LTO (`gllto.glpals.com`) | 7-day LTO, version 0 | no published terms, best effort (see below) | watches that ask version 0 (none of ours has) |
| MediaTek EPO | `MTK_EPO_*` | vendor / project / device id service, no public terms, 403 for a dummy id | part of a GT 4's set only |
| BKG broadcast ephemeris | GPS, GLONASS, Galileo, BeiDou, QZSS broadcast orbits, every 15 min | IGS terms: open, commercial use allowed, cite IGS and providers, no warranty; BKG licence text not found | the **content** of `HW_AGNSS_RTCM_33` (see "Lab path") |
| CODE orbit products (AIUB Bern, `download.aiub.unibe.ch/CODE`) | GPS, GLONASS, Galileo precise orbits with predictions (ultra-rapid: ~25 h; 5-day prediction), SP3, every 6 h / daily | open access; acknowledge by citing the product DOI (10.48620/97774); CODE is an IGS analysis centre, so the IGS terms above apply; no further licence text found | the **content** of the `HW_PGNSS_*` files (see "PGNSS lab path") |
| Sony (CXD5603 / CXD5605) | Sony receivers show up in Garmin watches ([chipset list](https://logiqx.github.io/gps-details/devices/garmin/chipsets)); no public assistance service was looked up | | no evidence a Huawei watch uses one |

Chips (what could be found; Huawei publishes no GNSS vendor for these watches):

| Model | What is known |
|---|---|
| Watch Fit 4 Pro, Watch Fit 4 | Dual band: L1 GPS, GLONASS, Galileo, BDS, QZSS and L5 GPS, Galileo, BDS, QZSS ([Huawei specs](https://consumer.huawei.com/en/wearables/watch-fit4-pro/specs/)). Vendor not published. Asks `HW_PGNSS_PRED` and `HW_AGNSS` (Fit 4 Pro, observed; `type=0x0024`). |
| Band 11 Pro | Huawei markets "sports GNSS positioning". Vendor and bands not found. Asks `HW_AGNSS` (observed). |
| Watch GT 4 | Vendor not found. It requests `MTK_EPO_*` files, so its receiver takes MediaTek-format EPO data [INFERENCE]. |
| Watch Ultimate | Dual band GPS receiver by Airoha ([TechInsights](https://www.techinsights.com/blog/deep-dive-teardown-huawei-watch-ultimate-clb-b19-smartwatch)). Airoha is MediaTek's GNSS line (general knowledge, not sourced here), which fits the EPO files above [INFERENCE]. |
| Watch GT 5 Pro, GT 6, other GT | TechInsights teardown of the GT 5 Pro exists but is paywalled (HTTP 403 here); nothing public found. |

The watches ask for Huawei's own kinds, never for a UBX, LTO or Sony file (LTO only for version 0, which none of ours has asked), so u-blox, Broadcom and Sony feeds are not what they request.

### What JoyoFit sends and what the watch would need

- JoyoFit sends Broadcom LTO only to a watch that asks version 0, which neither the Band 11 Pro nor the Fit 4 Pro has asked. With the experimental switch on (off by default, since
  2026-10-25) it also sends `HW_AGNSS_RTCM_33` to a watch that asks exactly `HW_AGNSS`. Otherwise the "expired" warning stays, and GPS lock without a file takes minutes. The
  phone's location over `0x18` during a workout is what shortens it, and that is already on.
- `HW_AGNSS` (Band 11 Pro, Fit 4 Pro): the watch pulls one file, `HW_AGNSS_RTCM_33` (2026-10-25 capture, 7 436 bytes), which HH writes unchanged from the server's gunzipped answer.
  Everything the community knows says that file is a plain concatenation of RTCM 3 ephemeris frames; if so, a correct payload is what the shared encoder (`packages/agps-rtcm`)
  writes. Unconfirmed: whether Huawei's file has a header in front, whether Huawei sends fewer or other messages (the decoder lists 1019, 1020, 1042, 1046 and skips anything
  before the first `D3` byte), and the chip's tolerance of a different mix of satellites. That is what the lab test answers.
- Fit 4 Pro (`HW_PGNSS_PRED`): Huawei's predicted ephemeris, built by Huawei Health from Huawei's `HiEE.dat`-style data with a proprietary conversion. Its content is not public
  broadcast data (a community attempt to match it to public ephemeris failed). Not in `pgnss/` of the community repo either (no decoder for `PRED`). The on-disk layout of the six
  files was since read out of Huawei Health's `libPgnssJni.so` and matched byte-for-byte in size against a real transfer (`~/re/agps/FORMAT.md`); the content (ICD-style
  broadcast elements fitted to predicted orbits) can be generated from public data, which the second lab switch tests. Whether the watch takes it is unverified.

### Recommendation

1. **Fit 4 Pro `HW_PGNSS_PRED`**: by default, nothing except what exists: phone GPS over `0x18`, and the decline. Since 2026-10-25 a second experimental switch serves
   JoyoFit's generated files for a lab test ("Lab path for `HW_PGNSS_PRED`"). The watch's own satellite update over Wi-Fi (Settings, Workout settings,
   Location Services, Satellite updates) is the one route that is not blocked by us; Huawei's support page says watches after the Watch 4 series can do it over Wi-Fi or eSIM.
   Not tried on the owner's watch (it changes a watch setting and needs the watch on Wi-Fi). If it works for the owner, a help text could say so.
2. **`HW_AGNSS`: decided 2026-10-25 (owner) to lab-test on the owner's Fit 4 Pro**, after the capture showed the Fit 4 Pro asks this kind too and pulls exactly one file
   named `HW_AGNSS_RTCM_33`. The legal side is the cleanest of every source (open IGS data, no account, nothing about the user sent anywhere; IGS and BKG cited in the privacy
   page; BKG's own licence text still not found). It ships behind an experimental switch that is **off by default**; with it off the bytes on the wire are today's decline
   (tested on both platforms). The earlier plan step "answer state 3 and refuse `1C/01`" is skipped: the capture already shows the file list (one file, type 1 pull). How to run
   the test and where to record the result: "Lab test" below.
3. Keep the existing rule that nothing else is ever offered in place of a kind the watch asked for: the switch serves `HW_AGNSS` only to a consult that names exactly that one kind.

## Why Huawei's servers are not used

No document gives third-party apps permission to call the endpoints behind Huawei Health's satellite data (`geo-dra.platform.hicloud.com`, the config
server). They are not documented APIs. The only terms found are Huawei's [Agreement on Use of Huawei APIs](https://developer.huawei.com/consumer/en/doc/app/10129)
(2.4 access only by the documented means and without masking identity, 4.1c no reverse engineering, 5.4 no scraping or caching) and the
[Health Kit agreement](https://developer.huawei.com/consumer/en/doc/app/70941808), which covers the official Health Kit only. Gadgetbridge's maintainer
says some URLs need authorization and that he is unsure he may share them. Decision (owner, 2026-10-18): not used. An earlier build carried an
off-by-default switch for `HW_AGNSS`; it was removed with this decision, because serving a kind the watch does not validate is a risk to the watch
as well. The switch of 2026-10-25 is a different thing: it never touches Huawei's servers (the file comes from JoyoFit's Worker, built from BKG's open
data), and `LEGAL.md`, the privacy page and the Play data-safety notes say so.

## The Broadcom LTO file (what is served)

- Public, plain GET, no account, no key, no app identification. Behind Cloudflare / CloudFront; answers `200`, `binary/octet-stream`.
- Measured 2026-10-18: **115 749 bytes**, starts `FF CA DE 00`, `Last-Modified` a few hours earlier (regenerated several times a day),
  `cache-control: max-age=240`. It predicts **7 days** ahead (`/7day/`).
- Terms: Broadcom publishes none on the endpoint and it is not a documented public API. JoyoFit treats it as best-effort. The phone sends no
  location, no ID, no app name; the server sees the IP address (declared in `docs/play-store.md` and `LEGAL.md`). Risk: Broadcom can change or
  close it without notice; the result is a logged, retried download, never a broken watch.
- It is the data of Broadcom-GPS watches. Offering it to a watch that asked for another kind is **never done**: the watch does not validate it.

## Open alternatives that were checked

| Source | Finding |
|---|---|
| Broadcast ephemeris, BKG (`https://igs.bkg.bund.de/root_ftp/IGS/BRDC/<year>/<doy>/`) | Anonymous, public multi-GNSS RINEX navigation files. `BRDC00WRD_S_...` is "ephemeris from data streams, updated every 15 min" (checked 2026-10-21: GPS 231, GLONASS 703, Galileo 3318, BeiDou 520, QZSS 84 records, 719 KB gz); the `_R_` file of the same day is a smaller one built from a subset. Re-encoded to RTCM 1019/1020/1042/1046 this is exactly the content the community reads out of `HW_AGNSS_RTCM_33` (see "Lab path"). Data is from IGS stations: [IGS data terms](https://igs.org/wp-content/uploads/2020/09/IGS-Data-and-Product-Disclaimer-and-Terms-of-Use-200805.pdf) allow scientific, educational and commercial use, require citing IGS and the providers, give no warranty. No separate BKG licence text was reachable (the directory listing has none, the BKG page returned 503): confirm before shipping. |
| Broadcast ephemeris, NASA CDDIS | Needs an Earthdata login (HTTP 401). |
| MediaTek EPO (`wpepodownload.mediatek.com`, `vendor` / `project` / `device_id` query) | Vendor service, no public terms found; a GET with dummy values answered 403 on 2026-10-18. |
| u-blox AssistNow | UBX-MGA for u-blox receivers; free tier needs a token. Not this watch's chip. |
| Galileo GSC almanac | Almanac only; no ephemeris, wrong format. |
| Google SUPL | Network assistance protocol, no public terms, no file interface. |
| Predicted orbits for `HW_PGNSS_PRED` (checked 2026-10-25) | **CODE** ultra-rapid and 5-day predictions over plain HTTPS: used (see "PGNSS lab path"). IGS ultra-rapid at BKG: GPS only, 15 min, and the 00:00 solution was still missing there at 05:05 UTC. ESA ultra-rapid (`navigation-office.esa.int`): GPS and GLONASS only. GFZ ultra-rapid (GPS, GLONASS, Galileo, CC BY 4.0, `isdc-data.gfz.de`): every request timed out (40 to 100 s, three tries). Wuhan's multi-GNSS ultra-rapid (the only one with BeiDou and QZSS): FTP only, HTTP refused. IGN mirror: timed out. `ftp.aiub.unibe.ch` no longer resolves. CDDIS: login. So no reachable public prediction carries BeiDou or QZSS. |

### Lab path for `HW_AGNSS` (experimental switch, off by default)

The encoder: `packages/agps-rtcm/src/rtcm.ts` (tests `packages/agps-rtcm/test/rtcm.test.ts`, real records in `test/fixture.ts`), shared by the lab CLI
`scripts/agps-rtcm.ts` and the Worker. It reads a RINEX 3 navigation file (BKG's merged `BRDC00WRD_S_<year><doy>0000_01D_MN.rnx.gz`, rebuilt every 15 minutes)
and writes one RTCM 3 frame per healthy satellite: message 1019 (GPS), 1020 (GLONASS), 1042 (BeiDou), 1046 (Galileo I/NAV). A real run on 2026-10-21 13:55 UTC:
7 839 bytes, 32 GPS + 23 GLONASS + 28 Galileo + 37 BeiDou satellites, none skipped; on 2026-10-25 03:00 UTC: 7 788 bytes, 119 satellites (the move into the
package left the output byte-identical). Checked against an independent decoder (`pyrtcm` 1.2.1, run once on the output, not a repo dependency): every frame
passes CRC-24Q, all four message types decode, and the decoded orbit values (sqrt(A), e, af0, M0, BGD, week, GLONASS X and tau_n) equal the RINEX values.

What it proves: the bytes are valid RTCM 3 ephemeris messages for current satellites, the same size as Huawei Health's file. What it does **not** prove: that a
Huawei watch's GNSS chip takes exactly this file.

**Where the file is built: the Worker** (`GET https://api.fit.joyorogo.com/v1/agps/hw-agnss`, `server/src/agps.ts`). The Worker fetches today's BKG file (and
yesterday's in the first 4 h of the UTC day, when today's is short or missing), reads only records of the last 4 h, builds the file, checks it, and keeps it in
the Cache API for 15 minutes; every phone gets the same bytes. A failed build answers 503 with `Retry-After: 60` and is remembered for 60 s, so callers in that
minute do not each fetch BKG again. Cost measured in Bun on 2026-10-25 03:00 UTC data (157 KB compressed, 989 KB text, 996 records):
gunzip 2 ms, parse 6 ms, build 3.5 ms; a full day's file is about 8 times larger, and records older than 4 h are skipped before their numbers are read. That fits
the Workers paid plan's CPU limit easily; the free plan's 10 ms would be tight [INFERENCE: not measured on Workers]. Building on the phone was rejected: every
phone would download 0.2 to 1.5 MB instead of 8 KB, BKG would see every user's IP address, and the encoder would need Kotlin and Swift copies.

Checks before the watch gets anything, the same rules on the Worker (`validateHwAgnss`) and on the phone (`AgpsPolicy.validateRtcm` / `validateAgnss`, Kotlin
and Swift): 512 B to 16 KiB; every byte inside a frame (`D3`, reserved bits zero, CRC-24Q correct); only messages 1019, 1020, 1042, 1046; at least 20
satellites; on the phone also a server `Last-Modified` at most 2 h old. A file that fails is never cached or offered; the watch then gets today's decline.

The phone side: with the switch on (`setAgpsLab`, stored as `lab_agnss` in the `joyofit_agps` store) and a consult that is exactly one tag ending
`/HW_AGNSS` (versions 1 to 3), `NetworkAgpsSource` fetches the file (phone copy reused for 15 minutes), the exchange answers `1F/03` state 3 and serves
`HW_AGNSS_RTCM_33` over the existing `1C` sender with every existing safety rule (bounds, timeouts, CRC16 file info, stored name `sha256(address) + name`).
Logs: `AGPS: consult answer ... (HW_AGNSS)`, `HW_AGNSS: downloaded N bytes, S satellites`, then the usual file-list, file-info, data and upload-done lines.
Delivery source `joyofit_rtcm`; the row's validity is 4 h from the build time; the status line says the data is experimental. A failed or invalid download
counts into the same retry schedule as the Broadcom file (1 min, 5 min, 15 min, 1 h, then every 6 h; reset by a success or "Perbarui sekarang"), and the watch's
repeated asks inside the wait are declined without a request to the server (`AgpsLab.downloads`). Switch off, any other tag, two tags, or no valid file:
exactly today's decline (state 4); with the switch off a running retry wait does not touch that decline.

```sh
bun scripts/agps-rtcm.ts --out /tmp/HW_AGNSS_RTCM_33                 # fetches today's BKG file (and yesterday's after midnight UTC), checks it like the Worker
bun scripts/agps-rtcm.ts --in BRDC.rnx.gz --out out.rtcm --now 2026-10-21T13:55:00Z
(cd packages/agps-rtcm && bun test)
curl -sD - -o /tmp/served.rtcm https://api.fit.joyorogo.com/v1/agps/hw-agnss   # after the Worker deploy: 200, ~8 KB, Last-Modified = build time
```

### Lab test (owner's Fit 4 Pro; owner decision 2026-10-25)

Needs a native build with this change (Android build or TestFlight) and the Worker deployed. A factory reset of the watch must be acceptable.

1. **Baseline**, switch off: with the watch's satellite data expired, start an outdoor workout on the watch with the phone's Bluetooth off (so the phone's
   location over `0x18` does not help) and time how long the watch takes to find its position (TTFF). Three runs, same place, open sky.
2. Turn on Settings > Tentang & lanjutan > Eksperimental > "Data satelit HW_AGNSS dari JoyoFit (uji lab)". Phone online, watch connected.
3. Keep the watch connected and reconnect it once (Bluetooth off and on on the phone): the Fit 4 Pro asks `HW_AGNSS` by itself on connect. On 2026-10-25 it
   sent JoyoFit `higeo/v1/gnssinfo?type=0x0024/HW_AGNSS` six times between 08:38 and 08:44 (JoyoFit logcat, all declined with state 4), without any PRED request
   before them. The manual Settings > Workout settings > Location Services > Satellite updates > Update on the watch asks PRED instead (2026-10-18: four PRED
   requests, no other kind), so it is not the way to trigger this test. Watch the Data satelit row and logcat (`adb logcat -s JoyoFit`, lines `AGPS:`) and
   record every consult. The row appears once the watch has asked `HW_AGNSS`.
4. If the row says the experimental data was delivered: repeat step 1 (Bluetooth off, three runs) within the 4 h validity and compare. Also note whether the watch's
   "GNSS data expired" warning goes away.
5. If GPS misbehaves (no fix at all, reboots): turn the switch off; if it does not recover, factory-reset the watch. Record it.

Record every run in "Device findings" below, table "HW_AGNSS lab runs": date and time, file age (`Last-Modified`), what the watch asked, outcome, TTFF before
and after, warning cleared or not, logcat excerpt. The release entry stays `Jangan klaim: unverified` until a run there shows a shorter fix.

### Lab path for `HW_PGNSS_PRED` (second experimental switch, off by default)

The Fit 4 Pro's own kind. Format: `~/re/agps/FORMAT.md` (Huawei Health 17.0.8.300 `libPgnssJni.so`, checked against the 2026-10-25 capture, section 8): three-day mode,
no gzip, six files of exact sizes (`HW_PGNSS_GPS` 93 312, `HW_PGNSS_BDS` 209 808, `HW_PGNSS_GLONASS` 361 584, `HW_PGNSS_GALILEO` 99 648, `HW_PGNSS_QZS` 28 512,
`HW_PGNSS_EXTRA` 6 248), each ephemeris file a 1008-byte header of 84 `{u32 GPS-second slot time, u32 offset, u32 size}` (36 used, one per two hours) and
fixed blocks. The watch pulled them in the order GPS, BDS, GLONASS, GALILEO, QZS, EXTRA, one `1C/01` ... `1C/06` round each, every `1C/01` answered with all
six names. Stronger risk than `HW_AGNSS`: these are predicted orbits for three days, the watch keeps them and checks nothing, and our predictions are
unverified against Huawei's.

The Worker answers `GET https://api.fit.joyorogo.com/v1/agps/hw-pgnss` (same base address as `hw-agnss`) with one bundle: ASCII `JFPG`, u8 version 1, u8 count 6,
then per file in pull order u8 name length, ASCII name, u32 little-endian size, bytes; `Last-Modified` is the build time; a failure is 503 with `Retry-After: 60`.

Phone checks (`PgnssBundle.validate`, Kotlin and Swift, the same rules as the Worker's validator): magic, version, count; the six names in pull order with their
exact sizes and nothing after the last; in each ephemeris header entries 0 to 35 at the packed offsets `1008 + i * block` with the block size (GLONASS 10 016 =
8 sub-blocks of 1 252), slot times exactly 7 200 s apart, entries 36 to 83 all zero; the count byte of every block (GLONASS: every sub-block) at most its capacity
(GPS 32, BDS 63, GLONASS 24, Galileo 36, QZSS 10); `HW_PGNSS_EXTRA` by size only; the server's `Last-Modified` present and at most 6 h before the phone clock; and
the first slot of every ephemeris file within 2 h of that build time in GPS seconds (`unix - 315964800 + 18`, Huawei Health's own conversion), BeiDou's 14 s
offset taken off first. A bundle that fails is never kept or offered; the watch then gets today's decline.

With the switch on (`setAgpsPgnssLab`, stored as `lab_pgnss` in `joyofit_agps`, independent of `lab_agnss`) and a consult of versions 1 to 3 that is exactly one tag
whose last `/` segment is `HW_PGNSS_PRED` (a tag containing `SEVEN`, Huawei Health's gzipped seven-day mode, is not served), `NetworkAgpsSource` fetches the
bundle (phone copy reused while it still passes the checks, up to 6 h; its build time is kept apart as `pgnss_built`, because the watch's `HW_AGNSS` ask two
seconds earlier overwrites the general copy record), the exchange answers `1F/03` state 3, and the existing `1C` sender serves the six files with every
existing safety rule (bounds, timeouts, CRC16 file info, stored name `sha256(address) + name`, the 60 s pull wait between files). One delivery is recorded when the
watch closed the last of the six (source `joyofit_pgnss`, 799 112 bytes, validity shown 3 days from the build time). Failures share the retry schedule.
"Perbarui sekarang" downloads this bundle when the switch is on and the watch's last ask was exactly `HW_PGNSS_PRED`. Logs: `consult answer ... (HW_PGNSS_PRED)`,
`HW_PGNSS_PRED: downloaded N bytes`, then file-list, file-info, data and upload-done lines per file and `<name> delivered; k of 6 files so far`.

Both switches are independent: the Fit 4 Pro asks `HW_AGNSS` and then `HW_PGNSS_PRED` in a separate `1F/01` exchange two seconds after the first transfer closes
(device run of 2026-10-25), and each ask is served or declined by its own switch. A consult naming exactly both kinds at once (never seen) is served only with the
PRED switch on, with the files of every kind whose switch is on (the `HW_AGNSS_RTCM_33` file first when the tag lists it first); if either download fails nothing is
offered. With the PRED switch off that consult stays declined exactly as before. Switch off, any other tag list, or no valid bundle: today's decline (state 4,
bytes asserted in `AgpsExchangeTest` / `AgpsExchangeTests`).

Lab test (needs a native build with this change and the Worker deployed; a factory reset of the watch must be acceptable):

1. Baseline as in the `HW_AGNSS` test, step 1 (switch off, phone Bluetooth off during the timed fixes, three runs, same place, open sky).
2. Turn on Settings > Tentang & lanjutan > Eksperimental > "Data satelit prediksi HW_PGNSS_PRED dari JoyoFit (uji lab)". Phone online, watch connected.
3. Trigger: on the watch, Settings > Workout settings > Location Services > Satellite updates > Update. That manual update asks `HW_PGNSS_PRED` (2026-10-18:
   four PRED requests, no other kind). Watch `adb logcat -s JoyoFit` (`AGPS:` lines): consult, download, six file rounds, delivery. The row then says the
   experimental predicted data was delivered; note whether the watch's update screen reports success and whether "GNSS data expired" goes away.
4. Repeat the timed fixes (phone Bluetooth off, three runs) within the 3-day validity, also on the second and third day to see whether later slots work.
5. If GPS misbehaves (no fix, reboots): turn the switch off; if it does not recover, factory-reset the watch. Record it.

Record every run in "Device findings" in a table "HW_PGNSS_PRED lab runs", started with the first run (same columns as the `HW_AGNSS` table, plus which day of the three).

#### PGNSS lab path: data source, generator, quality gate, Worker

Code: `packages/agps-pgnss` (`src/sp3.ts` SP3 reader and interpolation, `src/orbit.ts` ICD models and the fit, `src/records.ts` byte layouts of FORMAT.md 2 to 4,
`src/bundle.ts` bundle codec and the validator the phone re-implements, `src/pgnss.ts` sources, build and quality gate; tests `test/pgnss.test.ts` on real data in
`test/fixture.ts`), the lab CLI `scripts/agps-pgnss.ts`, and the Worker route `server/src/agpsPgnss.ts` (tests `server/test/agpsPgnss.test.ts`).

**Data source (decided 2026-10-25).** CODE's products at `https://download.aiub.unibe.ch/CODE/` (a 301 to SWITCH's S3, plain anonymous GET, reachable from a Worker):

| File | Content | Measured 2026-10-25 |
|---|---|---|
| `COD0OPSULT.SP3` (static name) | ultra-rapid GPS + GLONASS + Galileo, 48 h at 5 min, "observed/predicted 23/25 hours" | 3.4 MB uncompressed (no gzip offered), `Last-Modified` 00:07 UTC for data up to 23:00 the day before; renewed every 6 h |
| `COD0OPSPRD_<year><doy>0000_05D_05M_ORB.SP3` | 5-day prediction of the same three systems at 5 min, named for the last observed day, starting 00:00 the next day | 9.6 to 9.8 MB; yesterday's name appeared at 00:07 UTC with the ultra-rapid file. The static `COD0OPSPRD_05D.SP3` still held the previous day's prediction at 05:30 UTC, so the dated name is used (yesterday's, then the day before's) |
| BKG `BRDC00WRD_S_...` (as in "Lab path") | broadcast records | health (only satellites with a healthy record not older than stage 1's limits get records), TGD / BGD, and each satellite's broadcast clock at the build time |
| BKG `BRDM00DLR_S_<yesterday>...` header | GPS Klobuchar, GPS UTC, leap seconds | the 15-minute WRD files have an empty header; the Worker unpacks this file only up to `END OF HEADER` |

Terms: the DataCite record of DOI 10.48620/97774 says "open access"; CODE asks users to acknowledge its products with that reference (`AIUB_AFTP.TXT`); CODE is an
IGS analysis centre and the IGS terms (open, commercial use allowed, cite IGS and the providers, no warranty) apply. No separate licence text was found. `LEGAL.md`
cites CODE. BeiDou and QZSS: no reachable public prediction carries them (see "Open alternatives that were checked"), so `HW_PGNSS_BDS` and `HW_PGNSS_QZS` are sent
well-formed with every block count 0. The generator fills them by itself when an orbit product with `C`/`J` satellites is added (packers, BDT +14 s slot times and
the 18-bit BDS range check are implemented and tested on synthetic records).

**Generator.** Slot times exactly as FORMAT.md 2.3 (GPS seconds `unix - 315964782`, `base = floor(t/7200)·7200`, slots `base + 7200 (k+1)`, BeiDou +14 s). For every
slot and healthy satellite: the source orbit at toe ± 2 h every 300 s (49 epochs; Lagrange interpolation, from the freshest product that covers all 49: ultra-rapid
first, then the 5-day prediction); a Gauss-Newton/Levenberg fit of the 15 broadcast elements with the ICD constants of the system (run on h = e·sin ω, k = e·cos ω,
L = M0 + ω, because Galileo's e of about 2·10^-4 makes e, ω and M0 degenerate; 3 iterations on real data, RMS 0.03 to 0.6 m). Clock: a straight line through the
product's clocks over the same 4 h, shifted per satellite so that it equals the satellite's broadcast clock at the build time (GPS: the L1/L2 reference TGD belongs
to; Galileo: I/NAV E1/E5b, BGD E5b/E1 in the record; GLONASS: GLONASS time), af2 = 0. Fixed fields as Huawei writes them (GPS aodo `0xFF`, GLONASS p1 = 1,
the rest 0). A value outside its field drops the satellite from that slot, like Huawei's range check. GLONASS: every 900 s the product's position and velocity
(km, ECEF), the luni-solar acceleration from low-precision Sun and Moon positions, tauN and gammaN from the product clock on the same broadcast alignment. The
900 s epochs are true GLONASS epochs (Huawei's formula with L = 18; Huawei's first run in a process has L = 0 and labels its states 18 s off, FORMAT.md 3.5).
Slots no product covers stay in the header with count 0, as Huawei's own files skip a satellite without a fit and leave no hole; nothing is extrapolated. With the
5-day prediction every slot of the three days is normally covered.

`HW_PGNSS_EXTRA`: GPS UTC (A0, A1, tot, WNt, dtLS, WNlsf, dtLSF, DN as the raw ICD integers; field order [INFERENCE] from the code's signed and unsigned bytes, and
while no leap second is announced, dtLS = dtLSF, every reading consistent with the signedness gives the same UTC), GPS ionosphere (the 8 Klobuchar raw
integers), and the trailer (start = slot base, end = the validity end of the last covered GPS slot [INFERENCE: the watch may read it as the data's expiry],
Huawei's last-slot field 0 as on every first run in a process, leap seconds). The other nine sections are zeros, which is what Huawei Health writes for a section
its seed lacks: their meaning (almanac satellite numbering, integrity flags, the third GLONASS AUX byte) is not known well enough to fill them without guessing.
Without the BRDM header the UTC and ionosphere sections are zeros too.

**Quality gate** (`qualityGate`, in the build, in the tests and in the CLI). Every record is decoded back from the finished bytes, evaluated with the ICD
algorithm (GLONASS: the ICD Runge-Kutta with J2 and the record's accelerations) and compared with the source orbit. A Kepler record more than 5 m off at any of its
49 epochs is not written (Huawei's fitter rejects a sigma above 1.0 the same way), nor a GLONASS record more than 10 m off within ±450 s (the next record takes over
after that). The build is refused if a system's RMS over all epochs exceeds 1.5 m or its maximum 5 m (GLONASS: RMS 3 m, maximum 10 m at ±450 s), or if the
first slot has fewer than 8 GPS, 6 Galileo or 6 GLONASS records, or fewer than 6 GPS slots (12 h) are covered. Why these numbers: broadcast ephemerides are fitted
at the decimetre level and their total error is about 0.5 to 2 m, so a few metres is generous for an honest fit and still far below the tens of metres where a
receiver would be misled; the floors only catch nearly empty inputs (a real build has 31, 28 and 21 satellites).

Real run, 2026-10-25 05:34 UTC, today's public data (`bun scripts/agps-pgnss.ts --out /tmp/pgnss`): six files of exactly 93 312, 209 808, 361 584, 99 648,
28 512 and 6 248 bytes, bundle 799 230 bytes, passes `validatePgnssBundle`; prediction covers all 36 slots (72.4 h ahead): GPS 1 116 records (31 satellites, 279
from the ultra-rapid file, 837 from the 5-day prediction), Galileo 1 008 (28), GLONASS 6 048 (21 satellites × 288 epochs), BeiDou and QZSS 0, nothing dropped.
Decoded-record error against the source orbit, RMS / maximum:

| System | At the record epoch | At ±2 h (GLONASS ±450 s) | All epochs (GLONASS up to ±900 s) |
|---|---|---|---|
| GPS | 0.29 / 0.91 m | 0.72 / 2.52 m | 0.29 / 2.52 m |
| Galileo | 0.19 / 0.59 m | 0.44 / 1.39 m | 0.19 / 1.39 m |
| GLONASS | 0.49 / 0.82 m | 0.66 / 1.37 m | 0.84 / 2.45 m |

Checks against independent data, run once on that build: the first GPS slot (toe 06:00) against the real broadcast records with the same toe: orbit within 1.1 to
3.5 m over ±2 h (broadcast error plus the antenna offset; SP3 is the centre of mass), af0 within 0 to 2 ns, af1 and TGD equal to 1 unit; Galileo against the
broadcast records of 04:40: 0.7 to 2.3 m, af0 within 3.4 ns; GLONASS at 04:15 and 04:45 UTC against the broadcast records of the same tb: position within 1 to 12 m,
velocity within 2 mm/s, accelerations within one 2^-30 km/s^2 unit, tauN within 5 ns. How good the predictions themselves are, measured with CODE's own older
5-day predictions against the observed part of the 2026-10-25 ultra-rapid orbit: RMS 0.4 to 0.7 m on the first predicted day, 0.8 to 1.0 m on the second, 1.4 to
1.8 m on the third (maximum 7.3 m, GLONASS). Clock drift over a day against the next solution's broadcast-aligned clocks: median 0.6 to 1.5 m GPS, 2 to 3 m
Galileo, 5 to 7 m GLONASS, worst single satellites 10 m (GPS) to 49 m (Galileo) [the reference clocks are themselves broadcast-derived, so part of this is
theirs]. Not verified: what the watch's chip does with any of it.

**Where it is built: on request, in the Worker** (`GET /v1/agps/hw-pgnss`). The Worker fetches the four inputs in parallel (about 14 MB, the CODE files are not
compressed), builds, gates and validates, and keeps the bundle in the Cache API until the next full hour (`Cache-Control: public, max-age=<seconds to the hour>`,
recomputed for every cached answer; the slots move every 2 h, CODE's file every 6 h). Either CODE file alone is enough. A failure answers 503 `agps_unavailable`
with `no-store` and `Retry-After: 60` and is remembered for 60 s. Cost measured in Bun on an Apple laptop with the 05:34 inputs: parsing both SP3 files 53 to
61 ms, build and gate 556 to 563 ms; JavaScript heap after the parse about 18 MB (20 MB after the build). That fits the Workers paid plan's default CPU limit of
30 s per request many times over (the free plan's 10 ms would not), so no Cron Trigger or R2 copy is needed [INFERENCE: not measured on Workers]. The fetch took
21 s from Indonesia; a Worker's network is faster [INFERENCE].

```sh
bun scripts/agps-pgnss.ts --out /tmp/pgnss          # fetches today's inputs, writes the six files and bundle.jfpg, prints the gate's statistics
bun scripts/agps-pgnss.ts --out /tmp/pgnss --ultra COD0OPSULT.SP3 --prediction COD0OPSPRD_..._ORB.SP3 --nav BRDC.rnx.gz --header BRDM.rnx.gz --now 2026-10-25T05:34:00Z
(cd packages/agps-pgnss && bun test)
curl -sD - -o /tmp/served.jfpg https://api.fit.joyorogo.com/v1/agps/hw-pgnss   # after the Worker deploy: 200, 799 230 bytes, Last-Modified = build time
```

## What is implemented

| What | Value |
|---|---|
| Broadcom file size accepted | 16 KiB to 1 MiB, header `FF CA DE` |
| Validity shown | 7 days from the server's `Last-Modified` |
| Phone copy reused for | 6 h (`AgpsPolicy.CACHE_FRESH_MS`) |
| Offered to the watch again after | 24 h (`DELIVER_EVERY_MS`) |
| Download retry after failures | 1 min, 5 min, 15 min, 1 h, then every 6 h; reset by a success or by "Perbarui sekarang"; Broadcom and, with their switches on, HW_AGNSS and HW_PGNSS_PRED |
| HW_AGNSS file (experimental) accepted | 512 B to 16 KiB, CRC-24Q of every frame, messages 1019/1020/1042/1046 only, at least 20 satellites, built at most 2 h ago |
| HW_AGNSS validity shown | 4 h from the build time (`AGNSS_VALID_MS`) |
| HW_AGNSS phone copy reused for | 15 min (`AGNSS_CACHE_FRESH_MS`); the Worker caches its build 15 min as well |
| HW_PGNSS_PRED bundle (experimental) accepted | exactly 799 230 bytes, six files in pull order at exact sizes, header layout and counts as in "Lab path for `HW_PGNSS_PRED`", built at most 6 h ago, first slot within 2 h of the build |
| HW_PGNSS_PRED validity shown | 3 days from the build time (`PgnssBundle.VALID_MS`) |
| HW_PGNSS_PRED phone copy reused for | up to 6 h (`PgnssBundle.MAX_AGE_MS`) while it still passes the checks |

When data is sent:

1. **When the watch asks** (`1F/01` op 1): the exchange above, answered from the phone copy when it is under 6 h old.
2. **Kept ready**: every completed sync, app or background (Android `WearRuntime.syncComplete` -> `EphemerisLink.onSyncCycle`; iOS
   `WearRuntime.handleSyncComplete` -> `EphemerisLink.onSyncCycle`), refreshes the phone copy when
   it is missing or 6 h old, with the retry schedule, so the watch's next ask is answered at once. Only while the watch has not asked for another kind.
3. **"Perbarui sekarang"** (Watch tab, Data satelit): downloads fresh data; with a watch connected it also asks the watch for its parameters
   (`1F/02`, phone-started) and carries on if the watch answers. The Fit 4 Pro answers `7f=118001` ("no request open"), so the row then says
   the watch has to start the update itself, and the data stays ready on the phone.
4. **Before a phone-started outdoor workout**: a workout recorded by the phone uses the phone's GPS, not the watch's; the watch's own data does not
   matter there. Workouts started on the watch trigger the watch's own ask (item 1) and receive the phone's GPS (service `0x18`).

Watch safety rules:

- A file is validated before it is offered (size bounds, LTO header; for the experimental HW_AGNSS file the RTCM checks of "Lab path"). A bad download is never
  cached and never sent.
- Every watch request is bounded: data per answer (1 MiB), frames per answer (65 535, at least one byte each), offsets and names checked; anything
  else is answered `100001` and ends that transfer.
- A transfer that goes silent for 30 s is dropped and recorded as a timeout; a "ready" nobody collects within 60 s is dropped; the download has a
  120 s timeout. Cancelling in the app, or a failed download, tells the watch "failed" (state 4); a lost connection drops everything.
- Only the services `1F` and `1C` of the already authenticated session are used; nothing touches pairing, bonding or keys.
- A delivery is recorded only when the watch closed the transfer after every byte had been sent.

The status row (Watch tab) shows last delivery, size, the phone copy, the kinds the watch last asked for (tag names only), the outcome in words,
and, when the watch asked for a kind JoyoFit cannot provide, what to do instead: the watch's own Wi-Fi update if available (Settings > Workout
settings > Location Services > Satellite updates), and that outdoor workouts get the phone's GPS.

## Device findings (Fit 4 Pro, Seiya-B29F, firmware 6.1.0.117)

- 2026-10-18, build 1470889 (run 39120670776): after connect the log shows `AGPS: ready`; the watch listed none of `1F/01..03`, `1C/01`, `1C/04` in
  SupportedCommands, but that list also omits services that work (`0x28`, `0x37`), so it is not authoritative.
- The watch sent no `1F/01` by itself during workouts or in the minutes watched. A phone-started `1F/02` was answered `7f 0001CCF1` (118001), no `0x81`
  container: the watch implements the service and has no request open.
- The Broadcom file downloaded and was cached (115 749 bytes, 113 KB in the row).
- Pending: the consult (version and tag names) after the user starts the update on the watch. (Answered 2026-10-18: `HW_PGNSS_PRED`, see "Observed on
  the watch's own ask"; with Huawei Health the watch also asks `HW_AGNSS`, capture of 2026-10-25.)

HW_AGNSS lab runs (see "Lab test"):

| Date, time | File age | Watch asked | Outcome | TTFF before (3 runs) | TTFF after (3 runs) | Warning cleared | Notes / logcat |
|---|---|---|---|---|---|---|---|
| 2026-10-25 11:53 WIB, lab APK 1480579 (tag `v1.1-lab.1`), Worker version `6a5f797d` | fresh build, downloaded in 1.5 s (6 666 B, 97 satellites) | `higeo/v1/gnssinfo?type=0x0024/HW_AGNSS` 17 s after the first bind of a factory-reset watch, then `HW_PGNSS_PRED` 2 s after the transfer (declined, state 4) | **transfer accepted**: state 3 acked `100000`, `1C/01` type 1 one file, `1C/02` protocol 1.0.0 / transfer size 862, `1C/03` crc16 `bf54`, 8 frames, `1C/06` result 1 after 6 666 of 6 666 bytes | not measured (the reset wiped the watch's data; the baseline needs a run after this file expires, switch off) | pending | pending | logcat of the run kept on the owner's machine (`~/re/agps/e2e/agnss_exchange.log`); the Data satelit row was hidden after the PRED decline (fixed in `08ce40b`: the row keeps a valid lab delivery) |
| 2026-10-25 12:07 WIB, same build, same file (14 min old on the watch) | the 11:53 delivery | no new ask (the watch already held the file) | outdoor walk started on the watch, open sky | not measured yet (see row above) | **about 3 s**, watch alone, timed by the owner; **4.7 s** in the log, from the watch's GPS request when the walk started (`Live workout: the watch asked for the phone's GPS` 12:07:22.025) to its withdrawal once its own receiver had a fix (`the watch stopped asking for the phone's GPS` 12:07:26.679); later starts within the minute withdrew after about 1 s | not checked | one run, not three, and no baseline yet: before this file the same watch took minutes for a first fix (section "What JoyoFit sends and what the watch would need"), but the comparison is only valid against a run with the switch off after this file expired |

Unexplained so far, same session: at 12:08:36 the link dropped and the watch showed its "reset to pair with this phone?" prompt again, about 15 minutes after JoyoFit's
first bind of the reset watch (no Huawei Health involved, it was suspended). On reconnect the watch no longer knew JoyoFit's identity (`authType 5`,
`firstConnection=true` while a bind key was stored) although the Bluetooth bond still worked (RFCOMM connected); Back on the prompt did not bring the binding back.
Lanjut on the bind confirmation and the accept on the watch re-bound it at 12:13:45 with nothing lost: the watch then asked only `HW_PGNSS_PRED`, so it still held the
HW_AGNSS file, i.e. an unbind, not a reset. Watch for it to recur; the phone Bluetooth was switched off and on for the fix-time test just before (12:08:24).

## iOS

The Swift port mirrors the Kotlin code one to one: `AgpsExchange` (an actor; the watch's messages go through one inbox and are handled in order,
the download runs on its own task), `EphemerisLink` (a `LinkObserver` that `WearRuntime` attaches to every new session, poked after every
completed sync), `AgpsStore` (UserDefaults suite `joyofit_agps`), `NetworkAgpsSource`, `AgpsPolicy` and `AgpsMessages`. The constants, outcome
strings, wire bytes and safety rules are the Android ones, and the Swift tests (`AgpsTests`, `AgpsExchangeTests`, in
`ModuleLogicTests`) are ports of `AgpsTest` and `AgpsExchangeTest` with the same cases and spec bytes. JS API: `getAgps`, `refreshAgps`,
`cancelAgps`, `setAgpsLab`, `setAgpsPgnssLab` on the Swift module; the Watch tab row shows on iOS wherever `HuaweiWear.getAgps` exists.

Differences, all forced by the platform:

- **Network**: `URLSession` with an ephemeral configuration, no cookies, credentials or cache, https only, bodies capped while they arrive (a
  delegate cancels the request once the cap is passed), 30 s without data and 120 s overall. URLSession's default `User-Agent` names the app, so
  it is replaced by the plain `CFNetwork`; no other identifying header is sent. The Android `HttpURLConnection` sends only its platform agent.
- **Copy on the phone**: the `Caches/agps` directory (iOS may empty it; that costs a refetch), pruned after a day, aged by the file's
  modification time.
- **Online check**: `NWPathMonitor` instead of `ConnectivityManager`.
- **Watch address**: the stored file name the watch is told (`sha256(address) + name`) is built from the peripheral identifier iOS gives the
  app, since iOS never exposes the watch's Bluetooth address. The watch only stores the file under the name it is given.
- **Console log**: the full consult tag and URLs go to the unified log (category `JoyoFit`, line `AGPS: consult tag=...`), never to the support log.
- **Background**: the prefetch after a sync runs on the process's own task. An iOS background sync that ends the app's run time may suspend it
  mid-download; the next sync tries again (the download timeout and the retry schedule are unchanged).
- **Not verified on a device**: like the Android side, UNVERIFIED on the Fit 4 Pro until a device run; "Device findings" is the place for it.

### Observed on the watch's own ask (2026-10-18 22:06 to 22:07, build 1471119, master 375f052)

Settings > Workout settings > Location Services > Satellite updates > Update ended with "Update timed out. Open Huawei Health and check the internet connection".
Logcat (tag `JoyoFit`), repeated four times, about 20 s apart (22:06:29, 22:06:51, 22:07:01, 22:07:20):

- `RX svc=1f cmd=01 ... AGPS: watch asks for ephemeris data: op 1`, answered `100000` and `1F/02` sent; the watch answered the consult in 0.07 to 0.15 s.
- `consult answer: download version 3, tag 67 chars (HW_PGNSS_PRED), 0 urls`; full tag `com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2/HW_PGNSS_PRED;`.
- JoyoFit sent `1F/03` state 4 (failed); the watch acked `7f=000186A0` (100000). No `1C` request followed.

So the Fit 4 Pro asked JoyoFit for version 3 / `HW_PGNSS_PRED` (Huawei's predicted ephemeris, Huawei servers only), never version 0 (Broadcom LTO), and repeated
that same request after each decline instead of moving on to another kind. There is no handler, parse or timing fault: the phone answered within milliseconds each
time. The watch's "timed out" text is its wording for an update that ended without data. Nothing in the policy (Broadcom LTO only, no Huawei servers) can satisfy
this kind, so there is no code fix; the decline is the intended behaviour. The same watch also asks `HW_AGNSS`, on its own after connecting: to Huawei Health
(capture of 2026-10-25, after PRED) and to JoyoFit (six requests on 2026-10-25 08:38 to 08:44, with no PRED before them). That second kind is what the lab path serves.

**Consequence for the UI (owner decisions, 2026-10-18 and 2026-10-25):** the "Data satelit" row in Watch is not shown for a watch whose asks can only be declined. It
appears if a watch asks for version 0, or asks exactly `HW_AGNSS` or `HW_PGNSS_PRED` while that kind's experimental switch is on (then with a lab-test help text), and it
stays while experimental data delivered with its switch on is valid. The switches sit in Settings > Tentang & lanjutan > Eksperimental with their risk texts; no help text
or onboarding step mentions them.
