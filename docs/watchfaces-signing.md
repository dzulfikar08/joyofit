# Custom watch faces on Huawei watches: signing, what JoyoFit can and cannot do

Research of 2026-10-21. Read-only: no code was changed, nothing was sent to Huawei, no developer account was opened.

**Short version.**

- A face a user designs (or any `.hwt` Huawei did not sign for that account) is thrown away by the Fit 4 Pro: the upload is
  accepted, activation answers `100014`, the watch deletes the face about 3 s later (**VERIFIED** on the Fit 4 Pro, firmware 6.1.0.117,
  `protocol/README.md` → *Why a face did not install*). The signature is issued by Huawei's servers per face id, version, Huawei account
  and watch. Nobody except Huawei can produce it.
- JoyoFit cannot sign, and there is no legitimate way for a JoyoFit server to sign. Do not build anything that fetches, forges, replays
  or strips a signature, and do not point users at a modified Huawei Health (reasons in section 2).
- **Path (a), what we can build:** keep Photo face (works, no signature involved), and have PT Joyo Digitama register as a Huawei Themes
  publisher to ship **JoyoFit-original** faces through Huawei's own store; users install them from Huawei Health. JoyoFit links to them, it
  does not install them.
- **Path (b), for users who want their own design:** Huawei documents one route. A free individual developer account, a *certified designer
  (watch face)* permission granted after a Huawei review, Theme Studio Pro in the browser, and Huawei Health's hidden **Add watch faces**
  button. The file goes onto the watch through **Huawei Health, not JoyoFit**. The guide is in section 5 (Indonesian). Honest status: this is
  what Huawei's own pages say; no independent report of it working on firmware 6.1 was found, and the review of the designer application is
  at Huawei's discretion with no published time.

Evidence labels used below: **VERIFIED** (seen on our Fit 4 Pro), **DOCUMENTED** (Huawei says so in a page linked here), **REPORTED**
(users or Gadgetbridge contributors say so; not checked by us), **INFERENCE** (ours).

## 0a. Update 2026-11-05: Gadgetbridge calls it a dead end; a user report; the modded Huawei Health

**Gadgetbridge [#6005](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/6005)** (read 2026-11-05; #6199, #6098, #5968,
#6465, #6466 closed as its duplicates). REPORTED by contributors, not checked by us:

- Affects GT 6 / GT 6 Pro (6.1), GT Runner 2, Fit 4, Fit 5, Fit 5 Pro. "188 is the last [GT 6] version that can use old install method."
- `contentSign` is 384 bytes (RSA-3072) and differs on every install of the same face (probably RSA-PSS). The signed content holds the
  file hash, so "a modified or custom watchface can't be activated without Huawei's private key". A trial face was removed by the
  watch after about 5 minutes with no phone connected, so the watch enforces licences on its own.
- Not region- or account-dependent: a German GT 6 with no Huawei account fails the same way.
- Replay of a captured response: one contributor thinks it may work for the identical store face (untested); Me7c7 says it fails
  because server sync data is also checked. A "sleep mode" install is reported to vanish after a restart. Developer account: "heard",
  unconfirmed.
- Me7c7, 2026-10-28: "Installation path without signature checks completely removed from 6.1 firmware." Firmware is signed too;
  "Only hope is private key leak or jailbreak of firmware." No Gadgetbridge fix is planned.

**User report (Threads DM, Jeremy, Watch Fit 3, 2026-11-04/05).** His `.hwt` files fail in JoyoFit with the "not signed" message and
install with (1) a modded Huawei Health from a Telegram channel or (2) Gadgetbridge, following a guide (`Guide(EN).docx`, read
2026-11-05 in a signed-in browser; downloads disabled by its owner).

The guide's Gadgetbridge route has **no signature step**. It copies the Huawei account's numeric `userId` (17 digits, from the
`userId` cookie of `cloud.huawei.com`), enters it in Gadgetbridge's per-watch *authentication* setting before pairing, then uploads the
`.hwt` normally. The guide's stated reason: if the phone does not send the account the watch was set up with, the watch asks for a
factory reset. Gadgetbridge sends that setting only in `1A/05` SendExtendedAccountToDevice (`SendExtendedAccountRequest.java`,
`PREF_HUAWEI_ACCOUNT`, read 2026-11-05), the packet where JoyoFit sends an empty account (`HuaweiInitializer.kt`).

**Correction to the first reading of this report.** The "not signed" text does not prove his Fit 3 enforces signatures: the install
treats a face the watch removes after the upload as refused (`WatchfaceManager.kt`, `removedByWatch`), whatever the reason. A plain
upload working in Gadgetbridge means his watch most likely does **not** enforce signatures (the Fit 3 is not among the watches in
#6005). What differs from JoyoFit is the account sent in `1A/05` (his ID vs empty) and the install id (JoyoFit's random
`<nine digits>_<version>`). Which one matters is UNVERIFIED; his firmware version and a JoyoFit support log of a failed install would
tell.

**Implemented (branch `feat/huawei-account-id`, UNVERIFIED on a watch).** JoyoFit can now send the user's Huawei account id in
`1A/05` instead of the empty default. `WearSettings.huaweiAccount` (Android) / `WearSettings.huaweiAccount` (iOS) stores it,
`HuaweiInitializer` sends it, and `HuaweiWear.get/setHuaweiAccount` expose it. The watch-face screen has a "Huawei account" section
(`HuaweiAccountSection.tsx`): in-app sign-in opens `id1.cloud.huawei.com` in a WebView and reads the `userId` cookie
(`huaweiAccount.ts`, `extractUserIdFromCookies`), with a manual-entry fallback for when Huawei marks the cookie httpOnly. Default
empty = the old behaviour. **Risk to re-check on a real watch:** a wrong id, or adding an id to a watch first bound under the empty
account, can trigger the watch's factory-reset prompt (`1A/06`); the UI warns to re-pair after setting it. Needs a device to confirm it
(a) does not reset a correctly-matched watch and (b) actually lets an unsigned face install on a non-enforcing watch like the Fit 3.

**The modded Huawei Health (`Huawei+Health+15.1.4.340_HookUtils.apk`, inspected 2026-11-05).** It is an LSPatch repackage: the original
APK is kept unchanged in `assets/lspatch/origin.apk`, `config.json` sets `sigBypassLevel: 2` and embeds Huawei's original signing
certificate (so the app still sees Huawei's signature after re-signing), and the Xposed module `cn.wwl.xposed.hook` (DexKit plus an
obfuscated WebView script `assets/code.js`) adds buttons to Huawei Health's face pages that call its own JS bridge
(`JsInteraction.sendStartDownload` / `sendStartTryoutDownload` by store `hitopId`, `jumpHwWatchFaceDesigner`). Huawei Health still does
the install, so Huawei's server still signs it. Nothing in it gives JoyoFit a way to install a local `.hwt` on an enforcing watch, and it
stays out of scope per section 2.

**"Let already-signed `.hwt` files through" is not a feature.** No `.hwt` carries a signature; it is issued per install for one account,
one watch, one face id and version, and the file's hash. A file that installed for someone else arrives unsigned. On a watch that enforces signatures, sending
the user's account ID in `1A/05` cannot help, because the signature still has to come from Huawei's server. It may matter on watches
that do not enforce them (see the user report above).

## 0. Correction and open question (2026-10-21, after a contributor report)

**Report.** Contributor David4rr (GitHub @David4rr; merged PRs #3 watchfaces and #15 smart replies) says JoyoFit installs already-signed
free `.hwt` files found online, for example from the Telegram channel `t.me/s/gt_gt2_aut_whatchfaces`. The claim is **REPORTED, not
reproduced here**. It is not written in any PR, issue or comment of the repository (PR #3 and #15 threads, issues #1 to #14 read
2026-10-21), and nothing in the repository records which watch or firmware he used. It must be re-tested before the rest of this
document is changed; nothing above is withdrawn yet.

**What the channel is (VERIFIED by reading its public view, 25 posts, posts 6904 to 6928).** "GT / GT2 / GT3 / GT3 Pro / HWM2 / ES / Fit
Author's Watchfaces - GAW". Files seen: `Pop391.2.1.1.hwt` (282 KB), `Pop392.2.1.1.hwt` (656 KB), `Pop BMW.2.1.1.hwt` (27 KB), `Pop393.hwt`
(285 KB), `Pop394.hwt` (233 KB), all forwarded from user HPopov, and `VAFBNBlue.watch4_pro.1.1.1.hwt` (1.3 MB),
`VAFElectroReV.watch4_pro.1.1.1.hwt` (3.1 MB). The `watch4_pro` suffix and the "Huawei Watch 4 Pro" captions mean the Huawei Watch 4
Pro (a round 466 class watch), **not the Watch Fit 4 Pro**. No post says "signed", "unsigned" or names a firmware. The Fit 4 Pro is not
named in any visible post. Also in the same feed, post 6907: **`Huawei_Health-14.1.6.310(mod).apk` (141.5 MB, 11.7K views)**, the modded
Huawei Health that section 2 says must not be shipped or linked. The public `t.me/s` page lists file names and sizes but **no download
link**; the `.hwt` files could not be fetched over plain HTTP (only Telegram clients can), so no sample was inspected.

**Is there a universal signature inside a `.hwt`?** Evidence says no, but it was not tested on a store-downloaded file:

- Every `.hwt` in `packages/hwt/fixtures` (4 for Fit 4 Pro, `FocusWGTru` GT 6, `Unnamed` HWHD02) is a ZIP of `com.huawei.watchface`,
  `description.xml`, `preview/*` only (VERIFIED, `unzip -l`). `description.xml` has no face id, account or signature field. The only
  integrity datum in any fixture family is the GT 3 era `hashCode` entry, a SHA-256 list, which is a hash, not a Huawei signature
  (`packages/hwt/README.md`). The 8 bytes at the start of the face binary (`55 55 55 55 01 00 00 01`) are a format marker, not a signature.
- The signature Huawei Health sends is a separate server response (`result.content.{huid, hitopId, version, deviceId, watchContentHash}` plus
  `contentSign`), fetched at install time with the account token and sent in tag `08` of the `27/03` announcement
  (`protocol/README.md` → *What the signature covers*; analysis of Huawei Health 17.0.8.300, REPORTED in GB #6005). It names the account
  and a hash of the watch id. A file cannot carry it, and a copy made for one account/watch would not match another.
- JoyoFit's installer sends **no** signature and installs under a **random** `<nine digits>_<version>` id (`WatchfacePackages.randomName`),
  so even a store-signed face (whose signature names its own `hitopId`) would not match. `installWatchface(uri, signature, fileName)` takes
  the signature only from the caller; nothing in the app supplies one.
- The 100014 handling (`WatchfaceManager.kt` `refusedMessage`) fires only when the watch deletes the face after activation; the signature
  hint is conditional on `screen.supportsSignature` (capability bit 8 of `27/01` tag `0x11`).

**Most likely explanations for David's report, in order [all INFERENCE]:**

1. **His watch or firmware does not enforce signatures.** The channel's faces target Watch 4 Pro, GT 2/3 and older; those, and any watch
   whose capability word lacks bit 8, never ask for a signature (JoyoFit's own log line `watch face signature=false` shows it). GB
   reports unsigned installs working on older Lite OS and pre-6.0.0.328 firmware (section 1.3). A pass on those watches says nothing
   about a Fit 4 Pro on 6.1.0.117, which is VERIFIED to refuse unsigned faces.
2. **Different file path.** The face was first installed through the channel's modded Huawei Health (which claims to be a designer) and
   later seen in JoyoFit's installed list, or the face was already on the watch.
3. **A true embedded or reusable signature.** Not found anywhere; would contradict the account/watch-bound `content`. Possible only if
   the store package is a different container than a Theme Studio export (store downloads in Huawei Health are not saved as `.hwt`, so
   their format is unknown here).

**Does the answer hold on a Fit 4 Pro 6.1?** Our VERIFIED result is: unsigned (Facemaker-made) faces fail with 100014. David's claim is
untested on that watch and firmware. Treat "channel faces install" as unproven for the Fit 4 Pro.

**Consequence for 'publish via Huawei Themes, install via JoyoFit'.** Not viable on current evidence. The signature is generated by the
server per install for the installing account and watch, so a face PT Joyo publishes is signed only when Huawei Health installs it for a
user. The Themes console documents upload, review and sale, not a download of a signed package; the **only** documented copy of the
file is the one PT Joyo uploads, which is unsigned (DOCUMENTED, Uploading Watch Face, Testing a Watch Face on a Device; absence of a
"download signed package" feature is INFERENCE from not finding one). Shipping a store-downloaded `.hwt` inside JoyoFit would also
break the licence terms of section 3. Path (a) in section 4 (publish, link, install in Huawei Health) stays the plan.

**Legal.** A user installing a `.hwt` they chose and own the right to use is the user's act, as it is with any file picker. JoyoFit
hosting, bundling, mirroring or deep-linking a catalogue of third-party faces (Telegram, Faces4Watch, store extracts) needs a licence from each
designer and is not OK without one; the licence of the channel's faces is unknown (HPopov and VAF are named authors). Pointing users to
the modded Huawei Health is also out (section 2).

**Next test for the owner (Fit 4 Pro, firmware 6.1.0.117).** Do exactly one controlled test and keep JoyoFit's log:

1. In Telegram open the channel and pick a face for **408 x 480** (`HWHD13`). Do not use the `watch4_pro` files (`VAFBNBlue`,
   `VAFElectroReV`): they are built for the Watch 4 Pro and the app will refuse or mis-size them. No post read is visibly named for the
   Fit 4 Pro, so search the channel for `fit4` / `Fit 4`, unzip the candidate and check that `description.xml` says
   `<screen>HWHD13</screen>` (for example `Pop392.2.1.1.hwt`, only if it does). Do not use any file that does not.
2. Check the log first: JoyoFit logs `WatchfaceParams capability: watch face signature=true` for this watch. If `true`, the watch will
   ask for a signature.
3. Import the `.hwt` with **Import .hwt file** and install. Expected, from our verified result: `100014` and the face deleted after
   about 3 s. If it **stays installed**, record the file's SHA-256, `description.xml`, the whole log of the attempt and the exact
   firmware; then the claim is real for this watch and sections 1 and 2 need rewriting.
4. Ask David for: watch model, firmware, whether `signature=true` was logged, the file name, and whether Huawei Health was ever used
   on that watch before the install.

## 1. How Huawei signs watch faces

### 1.1 What is signed and by whom

A `.hwt` is a ZIP (`description.xml`, `preview/…`, and `com.huawei.watchface` or, for Honor, `com.honor.watchface`; newer files wrap an
inner zip holding `watchface.bin`, older ones hold the raw `watchface.bin`). The design file itself carries no signature that Theme Studio
adds. The signature is a **separate message fetched at install time**:

1. Huawei Health downloads the face, then asks a Huawei server to sign it for this install and puts the answer in tag `08` of the `27/03`
   announcement (REPORTED by a Gadgetbridge contributor who captured Huawei Health's flow on HarmonyOS 6.1,
   [GB #6005](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/6005) and [GB #5968](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/5968);
   field-by-field analysis from Huawei Health 17.0.8.300 in `protocol/README.md` → *What the signature covers*).
2. The answer is JSON: `result.content.{huid, hitopId, version, deviceId, watchContentHash, status, recycle}` plus `result.contentSign`.
   `huid` is the Huawei account, `hitopId` the face id, `deviceId` a hash of the watch's identifier, `watchContentHash` a SHA hash of the face
   binary. `contentSign` is an RSA signature, so it cannot be made without Huawei's private key (REPORTED, same issue #6005, comment of
   2026-07-30).
3. The watch checks it **at activation, not at upload**. Observed: a garbage tag `08` is accepted at the announcement; the refusal (`100014`)
   comes when the face is activated (VERIFIED).

Consequences: the signature is per face version, per account, per watch. It is not a certificate you can attach to a file once and reuse.
The request needs the user's Huawei account token (see `protocol/README.md`), so even the *capture and replay* idea only ever works for the
capturing account and watch.

**Not found in any Huawei source:** a test-device whitelist, a device serial/UDID registration step in the console, separate debug and
release signing, or a signature validity period. Huawei's model is **account-level**: a HUAWEI ID with the *HUAWEI Themes certified
designer (watch face)* permission can use Huawei Health's **Add watch faces** entry; other accounts do not see it
([Testing a Watch Face on a Device](https://developer.huawei.com/consumer/en/doc/content/watch-face-test-0000001252363479),
[Theme Studio FAQ](https://developer.huawei.com/consumer/en/doc/content/watchface-faq-0000001174035539): "Why couldn't I add a watch face in
the Huawei Health app? Only a HUAWEI ID (team account holder or team member) with the HUAWEI Themes certified designer (watch face)
permission can add watch faces." Huawei's CN support page says the same,
[设计师如何申请入驻华为主题发布资源](https://consumer.huawei.com/cn/support/content/zh-cn15808434)). All DOCUMENTED. If a whitelist exists it is
internal to Huawei's signing service. What `status` and `recycle` in the signed content mean is unknown (INFERENCE only).

### 1.2 Tools

| Tool | What it is | Source |
|---|---|---|
| Theme Studio Pro | Web tool (`themestudio.cloud.huawei.com.cn`, Chrome 95+). Login only with a HUAWEI ID that has the certified designer (watch face) permission. Creates 466×466, 408×480 and 286×482 faces. Export gives the `.hwt`. | [Preparations (Pro)](https://developer.huawei.com/consumer/en/doc/content/preparation-pro-0000001633687081), [Watch Face Creation (Pro)](https://developer.huawei.com/consumer/en/doc/content/watch-face-production-pro-0000001583647406) |
| Theme Studio | Windows / macOS desktop tool. Older and wider resolution range (390, 454, 466, 280×456, 336×480, 408×480, 194×368 …). Huawei says faces **must** be made with Theme Studio, otherwise the package fails Huawei Themes verification on upload. | [Preparations](https://developer.huawei.com/consumer/en/doc/content/preparation-0000001574244245), [Downloading Development Tools](https://developer.huawei.com/consumer/en/doc/content/themes-design-tools-0000001054531194) |
| "Watch Face Maker" / third-party makers (Facemaker, `hwt-gt2e` and similar) | Not Huawei tools. They build `.hwt` files by reverse-engineering the format or by reusing a template. Output is unsigned. | [hwt-gt2e](https://github.com/Silenttttttt/hwt-gt2e), [Reddit](https://old.reddit.com/r/HuaweiWatchGT/comments/1gccu6e/installing_custom_watchfaces_on_the_huawei_watch/) |

Huawei's "Watch Face Studio" is Samsung's tool name for Wear OS/Tizen faces and unrelated to Huawei; a Wear OS face does not convert.

### 1.3 Which watch takes which format

From [Resolutions and Version Numbers](https://developer.huawei.com/consumer/en/doc/content/resolution-version-0000001252603441) (DOCUMENTED,
page updated 2026-09-30). The face version is `x.y.z`; `x.y` decides which watches take it.

| Watch | Resolution (code) | Face versions | Pro or desktop tool |
|---|---|---|---|
| Watch Fit 4, Fit 4 Pro | 408×480 (HWHD13) | `2.1.z`; `2.9.z` (Fit 4/5, adds emotion data) | Pro (408×480) |
| Watch Fit 3 / 5 | 408×480 | `2.1.z`, Fit 5 also `2.11.z` (video) | Pro |
| Watch GT 4, 5, 6 (46 mm class) and Watch 3+ | 466×466 (HWHD09) | `2.1.z` mandatory; `2.4.z` GT 4+; `2.5.z`; `2.9.z` only HarmonyOS 6.0+; `2.10.z` (video) GT 6+; `1.y.z` variants for Watch 3+/GT 5+ | Pro (466×466) |
| Watch GT 2 (42 mm) | 390×390 (HWHD01) | `3.5/3.6/3.7.z` | desktop Theme Studio only (Pro does not list 390) |
| Band 6/7/8/9/10, Watch Fit mini | 194×368 (HWHD07) | `2.1.z`; `2.2.z` with AOD (Band 8/9/10) | desktop Theme Studio only |
| Band 11 | 286×482 (HWHD14) | `2.1.z` | Pro (286×482) |
| Watch GT 2 (46 mm), GT 2 Pro | 454×454 (HWHD02); GT 2e uses 454×454 too ([hwt-gt2e](https://github.com/Silenttttttt/hwt-gt2e)) | `2.5–2.7.z` (46 mm), `2.8.z` (GT 2 Pro) | desktop Theme Studio only |

The GT 5 spec page shows 466 for its screen; sizes such as 41 mm GT 4/5/6 are not in Huawei's table and were not checked here. "Lite OS vs HarmonyOS" is not a
format switch in these tables; it is the firmware generation. Older Lite OS watches (GT 2 family, Band 6 era) and pre-6.0.0.328 firmware
accepted unsigned faces via Gadgetbridge (REPORTED: [GB #6199](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/6199), which
Gadgetbridge's own page now summarises as "HarmonyOS 6.1 and later are unable to install watchfaces",
[Huawei/Honor](https://gadgetbridge.org/basics/topics/huawei-honor/)). Whether every model and every region enforces the signature is not
established: a German GT 6 without a Huawei account fails silently on 6.1 (REPORTED, GB #6005, 2026-09-08), so it is not China-only; one
Reddit user says Gadgetbridge still installs on a GT 5 (REPORTED, [r/HuaweiWatchGT](https://old.reddit.com/r/HuaweiWatchGT/comments/1pt0o37/how_to_install_a_hwt_file_on_huawei_watch/));
a Fit 4 Pro (VERIFIED) and the GT 6 / GT Runner 2 / Fit 4 reports do not.

### 1.4 Can a personal developer ID sign faces for one's own watch?

DOCUMENTED yes in principle, with two gates:

1. **Individual developer account.** Free ("Individual and enterprise accounts on HUAWEI Developers are free to register for and use",
   [Identity Verification FAQ](https://developer.huawei.com/consumer/en/doc/help/identityverfication-0000001053292680)). Individual
   verification takes an ID card or passport plus a bank document, a legal adult, review 1 to 2 working days
   ([For Individual Developers](https://developer.huawei.com/consumer/en/doc/start/ibca-0000001062388135)). Indonesia is marked as supported
   for registration, identity verification and Merchant Service for individuals
   ([Service Countries/Regions](https://developer.huawei.com/consumer/en/doc/start/scindividual-0000001055114891), page dated 2022-07-27).
2. **Certified designer (watch face) permission.** A separate Huawei review: "We will conduct a qualification review on designers…";
   applicants provide "complete works, copyright registration certificates, or work source files"; Huawei bans the account on copyright
   infringement; a rejected application can be resubmitted only after the interval named in the rejection; resubmitting the same work inside
   the interval is "regarded as malicious" and can block applying for one to three months. The step list also tells you to check that
   **Merchant Service** (bank, tax and contact information) is enabled before waiting for the result
   ([Registration & Certification](https://developer.huawei.com/consumer/en/doc/content/settlement-guidance-0000001056348857)). No review
   time is published. Whether Merchant Service is truly required for someone who only wants to test, and whether Huawei approves a
   designer who never intends to publish, are both unknown.

With the permission, the designer signs into Huawei Health, uses **Mine → Add watch faces**, and installs the exported `.hwt` on the paired
watch ("Watch face resource packages can be pushed only to a paired watch/band for testing",
[Testing a Watch Face on a Device](https://developer.huawei.com/consumer/en/doc/content/watch-face-test-0000001252363479), last updated
2025-12-17; the codelab says the same, [Watch Face codelab](https://developer.huawei.com/consumer/en/codelab/theme-Watchface/)).
This is Huawei's own test path; it is documented to work for a designer's own watch. Huawei's FAQ also says "Do not lend your approved
designer account to others." DOCUMENTED, but see the gap: a user on HarmonyOS 6.1 wrote that "there is now a server-side approval required"
and could not install a self-made face, and that the free tool does not even export the newer `2.4` version for the GT 6 Pro because "they want to
reserve it to people in their developer program with access to theme builder pro" (REPORTED, [Reddit](https://old.reddit.com/r/HuaweiWatchGT/comments/1gccu6e/installing_custom_watchfaces_on_the_huawei_watch/)).
That comment sits in a thread about the modded-app route and does not say the user had a certified designer account, so it neither confirms
nor contradicts the documented path [INFERENCE].

**Does such a face install through JoyoFit?** No. The signature is fetched by Huawei Health with the account token and sent in the
announcement; JoyoFit has neither the token nor a lawful way to get one. With JoyoFit the face is announced without a signature and
deleted (VERIFIED). So the user installs through Huawei Health and reconnects JoyoFit afterwards. A watch is usually bound to one app at a
time; a Gadgetbridge video description says reconnecting to Gadgetbridge after using Huawei Health requires pairing again
([video](https://www.youtube.com/watch?v=GL1CnhGJTcw), description seen in a search snippet only) [INFERENCE for JoyoFit, check on a real watch].

## 2. Can JoyoFit sign on behalf of users?

**No, and a server cannot either.**

- The key is Huawei's. `contentSign` is an RSA signature over `content` that names the Huawei account, the face id and version, the
  watch and a hash of the face. The only issuer is Huawei's theme service, and it answers only for an id and version it already holds
  (`protocol/README.md`: "There is no file hash and no file content in the request"; the server "answers for an id and version it already
  knows"). The request also needs the user's Huawei token and Huawei Health's client identity (`x-appid`, headers listed there). A JoyoFit
  server posing as Huawei Health, or JoyoFit calling that endpoint, would be using an undocumented private API under a user's credentials.
- Huawei's public SDK does not offer it. Wear Engine lets a phone app list paired watches, exchange messages and files with a watch app, send
  template notifications, and (enterprise) read heart-rate alerts and the serial number. There is no watch-face install or signing capability
  ([Wear Engine service introduction](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/service-introduction-0000000000018585)).
  Huawei Health must be installed and signed in for it to work at all.

**PT Joyo Digitama as a publisher: yes, it can register, and publish through Huawei Themes only.**

- Enterprise developer verification needs a business licence (and, in some countries, an ID plus bank document of a contact person);
  review 1 to 2 working days; free
  ([With a Business License](https://developer.huawei.com/consumer/en/doc/start/mracoei-0000001062678404)). Then Console → Content services →
  HUAWEI Themes → apply, sign the Themes Publisher Agreement, create a Watch Face product, upload `.hwt` packages, wait for review
  ([Uploading Watch Face](https://developer.huawei.com/consumer/en/doc/content/sportwatch-upload-0000001054469759), 2021 text).
- A publisher may publish its own faces **or those of copyright owners it has licensed**; a face can be free or paid. Terms that matter
  ([HUAWEI Themes Service Agreement](https://developer.huawei.com/consumer/en/doc/content/protocol-0000001054239369), 2025-07-20):
  the publisher grants Huawei a licence to distribute and promote the content and to use the publisher's name and logos in marketing (1.10);
  the publisher warrants it owns or is licensed for everything in the face and indemnifies Huawei (3.2, 3.2.7); Huawei does a form check
  only and the publisher answers end-user disputes (6.1, 3.2.4); Huawei can remove content, freeze settlement and block the HUAWEI ID on
  suspicion of infringement (3.2.5, 3.3.6); Huawei may delete or move content at will (3.3.2); revenue split for non-member sales
  `Huawei 30 : Publisher 70` after an "operation cost rate", or `30 : 20–50 : 50–20` with a copyright owner (4.1, 4.2); price tiers are
  Huawei's ([Content Pricing Specifications](https://developer.huawei.com/consumer/en/doc/distribution/content/content-pricing-specifications-0000001096951357));
  payouts need Merchant Service (bank, tax; [Merchant Service](https://developer.huawei.com/consumer/en/doc/start/merchant-service-0000001053025967)).
  Which Huawei entity contracts with an Indonesian developer (Aspiegel SE under Irish law, Huawei Services (Hong Kong) under Hong Kong law, or
  another) is decided by Clause 14 and Exhibit A of the Developer Agreement; the Exhibit A list was not on the page read, so it is not known
  from here. Read it at sign-up.
- **Distribution outside the Themes store:** no Huawei page grants or forbids a publisher handing out its own `.hwt` elsewhere. It would not
  help: a face handed out elsewhere cannot get a signature unless the installing account is a certified designer (section 1.4). The
  only DOCUMENTED consumer install channel is the store inside Huawei Health.
- **Per-device signing a server could do:** none that is lawful. See above.
- The Developer Agreement forbids helping anyone bypass Huawei's content protection or reverse-engineer its security components
  ([HUAWEI Developers Service Agreement](https://developer.huawei.com/consumer/en/doc/start/agreement-0000001052728169): 3.1(e), 4.4, and 4.3
  on Huawei Content). That applies to a PT Joyo developer account once it exists.

### What bypasses signing, and why we must not ship any of it

| Method | How it works | Why not |
|---|---|---|
| Modded Huawei Health APK | "It tricks the app into thinking you are a designer and gives you a link to load up your watchface" (REPORTED, r/HuaweiWatchGT). Defeats the client-side check that hides **Add watch faces**. | Third-party-patched APK of a health app holding the user's account and health data: a malware and credential-theft vector Reddit commenters themselves flag. Breaks Huawei's licence terms and risks the user's HUAWEI ID. Reported not to work on 6.1 because the server now signs (REPORTED). JoyoFit must not distribute, link to or document it. |
| Gadgetbridge path before firmware 6.0.0.328 | Pre-6.x firmware accepted unsigned faces over the file-upload service. | Gone on current firmware (VERIFIED on the Fit 4 Pro). Nothing to ship. |
| Firmware downgrade, patched firmware, rooted watch | Install firmware that skips the check. | Not documented anywhere; bricking risk; unlawful circumvention exposure; never. |
| Replaying a signature captured from Huawei Health | The signature is bound to account, face, version and watch. | Obtains it by using Huawei Health's private flow; only helps the capturing user; users would need to sniff their own Bluetooth. The current code exposes `installWatchface(uri, signature, fileName)` for exactly this experiment (`src/HuaweiWearModule.ts`). **Recommendation: do not surface it in any UI, do not document it for users, and consider removing it.** |
| Forging or calling Huawei's signing endpoint | Impersonate Huawei Health's request (headers, token) from JoyoFit or a server. | Private API, user credentials, violates 3.1(e) / 4.4 of the Developer Agreement. Same reasoning as `protocol/README.md`: "JoyoFit never requests a signature from Huawei". |

Copyright-law exposure for circumventing a technological protection measure in Indonesia (UU Hak Cipta No. 28/2014 has a provision on
disabling technical control measures) was **not verified** [INFERENCE]. Ask counsel before any such feature is considered; the answer in
this document is "do not ship" regardless.

## 3. Already-signed faces JoyoFit could legally offer

- **Faces from Huawei's store: no.** Free store faces by third-party designers belong to those designers, and Huawei only gets a
  distribution licence for its own channels (Themes Agreement 1.10, 3.2.2). Huawei-made faces are Huawei Content: the Developer Agreement
  lets no one copy or redistribute it without written consent (4.3). Even a lawfully obtained copy would be useless: the watch checks
  the signature per face, version, account and watch, so JoyoFit cannot hold a file "already signed" for its users.
  Community sites that offer unsigned `.hwt` downloads for older watches ([Faces4Watch](https://faces4watch.com/), Telegram groups) have
  unknown licensing [INFERENCE] and stopped installing on 6.x anyway; JoyoFit should not mirror them.
- **JoyoFit's own faces, published by PT Joyo Digitama through Huawei Themes.** We would own the copyright, Huawei signs per install, users
  install from Huawei Health. JoyoFit can list them and open Huawei Health's face store for the user. Whether Huawei Health supports a
  deep link to one specific face was **not checked** [INFERENCE: probably not documented; verify before promising one-tap].
- **Third-party designers.** The Themes agreement has a model for exactly this: the *Publisher* publishes the *Copyright Owner's* face with
  an agreed split (30 : 40 : 30, 30 : 30 : 40, 30 : 20 : 50 or 30 : 50 : 20 Huawei : Publisher : Owner). Either PT Joyo is the Publisher
  with signed licences, or the designer publishes under their own account and JoyoFit only links to it.
- **What already works without a signature:** Photo face (picture chosen and cropped on the phone, upload **VERIFIED** on the Fit 4 Pro
  2026-10-14, the watch's "add photo" prompt still open per `protocol/README.md`). Customize the editable faces the watch already holds
  (implemented, UNVERIFIED on the watch). Huawei's own OneHop route (Gallery picture to watch face) is Huawei Health's feature, not ours
  ([Huawei support](https://consumer.huawei.com/en/support/content/en-us00760382)).

## 4. Recommendation

### (a) What we can build

1. **Keep Photo face as the in-app answer to "I want my own face".** It needs no signature and is the only user-owned design that installs.
   Improve it before anything else (more crop/filters, video/kaleidoscope if the watch supports them: type bits 4 and 7 in `27/02`).
2. **PT Joyo Digitama as a Huawei Themes publisher.** Register as an enterprise developer with the business licence, apply for the watch-face
   designer role, enable Merchant Service, and publish a small catalogue of JoyoFit-original faces built in Theme Studio Pro
   (408×480 for Fit 4 / 4 Pro, 466×466 for GT 4+ and Watch, 286×482 for Band 11, 194×368 in the desktop tool for Band 10). The app side is a
   catalogue screen that explains the faces and opens Huawei Health's face store; installing happens in Huawei Health. Cost: no fee to
   register; bank and tax paperwork; revenue share applies if paid; Huawei review of every face. Risk: designer-role approval is
   discretionary and its time is not published.
3. **Keep the `.hwt` export for Theme Studio Pro** (already stated in the export screen) and keep the friendly `100014` message.
   Add a link from that message to the user guide in section 5 once the owner approves it.
4. **Do not surface `installWatchface(..., signature)`** and do not build signature fetching or replay (section 2).
5. **Re-test** the whole thing on a real Fit 4 Pro if the owner opens a designer account: install a Theme Studio Pro export through Huawei
   Health, then check that JoyoFit's face list shows it. Until then every statement about the designer path is DOCUMENTED, not VERIFIED.

### (b) Guide for users

See section 5. It sends users to Huawei Health for the install; JoyoFit cannot do that step. Time and cost summary for the guide:

| Item | Time | Cost |
|---|---|---|
| Developer account and identity verification | 1 to 2 working days after upload (DOCUMENTED) | free |
| Designer (watch face) application | Not published by Huawei | free (Merchant Service paperwork: bank, tax) |
| Designing one face | hours to days | free |
| Install via Huawei Health | minutes | free |

Pitfalls: a rejected application locks resubmission of the same work; Pro refuses to export until every placeholder is replaced; names in
English only; the face is too bright (more than 50 % of pixels with R>168, G>168, B>128, A>168) or the AOD has more than 20 % non-black
pixels (10 to 20 % depending on resolution) and the tool warns on export; do not lend the designer account; a modded Huawei Health is not an
alternative.

## 5. Panduan untuk pengguna (Bahasa Indonesia)

> **Status.** Langkah-langkah ini berasal dari halaman resmi Huawei (dirujuk di bawah). Belum ada laporan pengguna independen yang
> membuktikannya di firmware HarmonyOS 6.1, dan lulus tidaknya pendaftaran designer ditentukan Huawei. JoyoFit **tidak bisa** memasang
> berkas ini ke jam; pemasangan lewat Huawei Health.

**Yang perlu disiapkan:** KTP atau paspor, dokumen bank (kartu, buku tabungan, atau rekening koran; nama sama dengan KTP, ditulis huruf
latin, masa berlaku minimal 6 bulan), laptop dengan Chrome 95 atau lebih baru, HP Android dengan Huawei Health dari AppGallery, dan jam
Huawei yang sudah terhubung ke Huawei Health.

**Bagian A. Akun developer dan izin designer (sekali saja)**

1. Buka developer.huawei.com, klik **Sign in**, lalu daftar HUAWEI ID dengan email atau nomor HP. Ini gratis.
2. Klik **Console**, pilih **Identity verification**, pilih **Individual**, pilih negara **Indonesia** (tidak bisa diubah nanti), isi data,
   unggah KTP atau paspor dan dokumen bank, lalu **Submit**. Hasil keluar sekitar 1 sampai 2 hari kerja lewat email.
3. Setelah terverifikasi, masuk ke **Console → Content services → HUAWEI Themes → Personal Center**. Isi **Personal information** dan
   **Qualification application**, lalu kirim. Siapkan karya jadi, file sumber, atau sertifikat hak cipta. Huawei menilai originalitas karya.
4. Di menu **Settings → Merchant Service**, kalau statusnya belum aktif, daftarkan dulu (butuh data rekening bank, pajak, dan kontak).
5. Tunggu hasil penilaian. Huawei tidak menyebut lamanya. Kalau ditolak, tunggu sampai masa jeda di pesan penolakan selesai. **Jangan kirim
   ulang karya yang sama di masa jeda**: dianggap berniat buruk dan bisa memblokir pendaftaran 1 sampai 3 bulan.

**Bagian B. Membuat tampilan jam**

6. Buka Theme Studio Pro di `themestudio.cloud.huawei.com.cn` dan masuk dengan HUAWEI ID yang sudah lulus. Kalau tidak bisa masuk, izin
   designer belum diberikan.
7. Buat karya baru dan pilih ukuran sesuai jam:
   - Watch Fit 4 dan Fit 4 Pro: 408 × 480.
   - Watch GT 4, GT 5, GT 6 ukuran 46 mm: 466 × 466. Ukuran lain (misalnya 41 mm, 390 × 390, 454 × 454) dan Band 10 tidak ada di Pro;
     Band 10 (194 × 368) memakai aplikasi Theme Studio untuk Windows atau macOS. Cek ukuran layar jam kamu lebih dulu.
   - Band 11: 286 × 482.
8. Siapkan gambar potongan (PNG 32-bit, ukuran persis sama dengan jam) untuk latar, angka jam, tanggal, dan widget. Gantikan **semua**
   gambar placeholder, kalau tidak, ekspor ditolak.
9. Jangan buat terlalu terang: lebih dari separuh piksel yang sangat terang membuat tampilan ditolak. Untuk AOD (layar mati), piksel
   non-hitam maksimal 20 % (10 % untuk sebagian ukuran).
10. Klik **Export**. Pastikan gambar pratinjau benar, isi nama jam (huruf Inggris, tanpa karakter Mandarin; nama paket cuma huruf dan
    angka), isi nama developer sesuai nama designer di Huawei Themes, lalu **OK**. Browser akan mengunduh berkas **.hwt**.

**Bagian C. Memasang di jam**

11. Pindahkan berkas `.hwt` ke HP.
12. Buka Huawei Health di HP. Masuk dengan **HUAWEI ID yang sama** (yang sudah lulus designer). Pastikan jam terhubung ke Huawei Health.
13. Buka **Watch faces → Mine → Add watch faces**, pilih berkas `.hwt`, tunggu sampai selesai, lalu terapkan di jam.
14. Kalau tombol **Add watch faces** tidak ada, akun kamu belum punya izin designer. Itu penyebab yang Huawei sebutkan.
15. Buka JoyoFit lagi. Jam hanya terhubung ke satu aplikasi pada satu waktu; kamu mungkin perlu menyambungkannya ulang ke JoyoFit
    (belum diuji di jam nyata).

**Perhatian:** (a) pasang hanya lewat Huawei Health; JoyoFit akan menolak berkas ini dengan kode 100014. (b) Jangan pakai Huawei Health
hasil modifikasi dari internet: berisiko mencuri akun dan data kesehatan, melanggar aturan Huawei, dan akun Huawei bisa diblokir. (c) Jangan
pinjamkan akun designer ke orang lain. (d) Waktu dan biaya: akun dan verifikasi gratis, 1 sampai 2 hari kerja; izin designer tidak ada
perkiraan waktu; mendesain beberapa jam.

## Sources

Huawei (all read 2026-10-21):

- Testing a Watch Face on a Device: <https://developer.huawei.com/consumer/en/doc/content/watch-face-test-0000001252363479>
- Theme Studio FAQs: <https://developer.huawei.com/consumer/en/doc/content/watchface-faq-0000001174035539>
- Theme Studio Pro Preparations / Watch Face Creation / FAQs: <https://developer.huawei.com/consumer/en/doc/content/preparation-pro-0000001633687081>, <https://developer.huawei.com/consumer/en/doc/content/watch-face-production-pro-0000001583647406>, <https://developer.huawei.com/consumer/en/doc/content/watchface-faq-pro-0000001733080717>
- Theme Studio Preparations; Downloading Development Tools; Watch Face codelab: <https://developer.huawei.com/consumer/en/doc/content/preparation-0000001574244245>, <https://developer.huawei.com/consumer/en/doc/content/themes-design-tools-0000001054531194>, <https://developer.huawei.com/consumer/en/codelab/theme-Watchface/>
- Resolutions and Version Numbers: <https://developer.huawei.com/consumer/en/doc/content/resolution-version-0000001252603441>
- Registration & Certification (HUAWEI Themes): <https://developer.huawei.com/consumer/en/doc/content/settlement-guidance-0000001056348857>
- Identity verification: <https://developer.huawei.com/consumer/en/doc/help/identityverfication-0000001053292680>, <https://developer.huawei.com/consumer/en/doc/start/ibca-0000001062388135>, <https://developer.huawei.com/consumer/en/doc/start/mracoei-0000001062678404>, <https://developer.huawei.com/consumer/en/doc/start/scindividual-0000001055114891>
- HUAWEI Themes Service Agreement: <https://developer.huawei.com/consumer/en/doc/content/protocol-0000001054239369>; Developer Service Agreement: <https://developer.huawei.com/consumer/en/doc/start/agreement-0000001052728169>; Merchant Service: <https://developer.huawei.com/consumer/en/doc/start/merchant-service-0000001053025967>; Content pricing: <https://developer.huawei.com/consumer/en/doc/distribution/content/content-pricing-specifications-0000001096951357>; Uploading a watch face: <https://developer.huawei.com/consumer/en/doc/content/sportwatch-upload-0000001054469759>
- Wear Engine service introduction: <https://developer.huawei.com/consumer/en/doc/connectivity-Guides/service-introduction-0000000000018585>
- Huawei CN support, designer permission for "添加表盘": <https://consumer.huawei.com/cn/support/content/zh-cn15808434>

Gadgetbridge and community:

- GB #5968 (Fit 4, 6.0.0.328, signature flow): <https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/5968>
- GB #6005 (GT Runner 2; signature JSON, `contentSign` RSA, EU/Germany GT 6 data point): <https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/6005>
- GB #6199 (HarmonyOS 6.1 cannot install `.hwt`), #6465 (Fit 4/5, duplicate): <https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/6199>, <https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/6465>
- Gadgetbridge Huawei/Honor page: <https://gadgetbridge.org/basics/topics/huawei-honor/>; `HuaweiFwHelper.parseAsWatchFace` (zip layout): <https://codeberg.org/Freeyourgadget/Gadgetbridge/src/branch/master/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/huawei/HuaweiFwHelper.java>
- r/HuaweiWatchGT: <https://old.reddit.com/r/HuaweiWatchGT/comments/1gccu6e/installing_custom_watchfaces_on_the_huawei_watch/>, <https://old.reddit.com/r/HuaweiWatchGT/comments/1pt0o37/how_to_install_a_hwt_file_on_huawei_watch/>, <https://old.reddit.com/r/HuaweiWatchGT/comments/1pmq1sr/guide_how_i_got_custom_watch_faces_working/>; r/hwatch: <https://old.reddit.com/r/hwatch/comments/1621vfw/how_to_install_hwt_files_to_huawei_band/>
- `hwt-gt2e` (format of GT 2e faces): <https://github.com/Silenttttttt/hwt-gt2e>

No XDA or 4PDA thread was found that documents a working designer-account install on firmware 6.x; the XDA thread on free store faces
(<https://xdaforums.com/t/get-some-free-watchfaces-from-huawei-store.4446999/>) only covers store faces.

In this repository: `protocol/README.md` (*Why a face did not install*, *What the signature covers*, *Photo faces*), `docs/watch-reference.md`,
`modules/huawei-wear/android/src/main/java/com/joyodigitama/huaweiwear/WatchfaceManager.kt`.
