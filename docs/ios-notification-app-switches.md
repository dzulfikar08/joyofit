# iOS per-app notification filter for Huawei watches: second pass

Read-only research, 2026-10-19. Nothing was sent to a watch or phone. Confidence: **[HIGH]** read in a primary source, **[MED]** inferred from primary sources that agree, **[LOW]** plausible, **[UNKNOWN]** not determinable without a capture or test.

## 0. Verdict

1. **The owner's user is right.** Huawei Health (HH) on iPhone has per-app notification switches for a *fixed* list of apps plus one **"Other"** switch. It does not list every installed app (iOS forbids that). [HIGH: Huawei's own support pages and screenshots, 3 user reports, section 1]
2. **`ios-notif-filter.md` was wrong on one point.** It said the 02 service has no per-app command. The 02 service has one: **02/0B "app list"**, `{app_id: string, notification_enable: u8}` per app. Gadgetbridge (GB) never implemented it because GB is Android-only and filters on the phone. It exists in HH 17.0.8.300's own wire schema, HH Android sends it to the owner's Fit 4 Pro on every connect, and an independent open-source client (huac) implements it. [HIGH that it exists and what it looks like; section 2]
3. **Not proven: that HH iOS uses 02/0B for its iOS switches, with which id strings, with which polarity, and what "Other" maps to.** Nothing public shows iOS-side traffic. The mechanism is almost certainly a watch-side filter on the ANCS AppIdentifier (the watch reads iOS notifications itself; HH cannot see them), and 02/0B is the only per-app carrier found. [MED]
4. **The cheapest decisive test needs no capture:** from JoyoFit's own authenticated session, send 02/0B for one bundle id and see whether the watch stops showing that app's ANCS notifications (section 3). The capture route (section 4) answers the same question plus what HH really sends, and can discriminate id style from frame length even though the payload is encrypted.

## 1. What Huawei Health on iOS actually offers

### 1.1 UI evidence

| Source | HH / device | Apps with their own switch | Notes |
|---|---|---|---|
| consumer.huawei.com/ca/support/content/en-us15867276 (also `en/…`, `id/in-id15867276`) | older iOS UI | **WeChat, Messages, WhatsApp, Other** | Huawei's text: "The restriction prevents the app from obtaining the detailed list of your phone apps. In addition, to improve user experience, we have customized separate switches for some frequently used apps. Other apps are combined into 'Other' and notifications for them cannot be disabled separately." Applies to Fit 2/3/4/**4 Pro**/5/5 Pro, GT 2/3/4/5/7 (+Pro/e/SE/Runner/Cyber), Watch 5/6/6 Pro, D/D2/D3, Ultimate (+2), Band 2 Pro/4/4 Pro/6/7, Honor Band 4/5/6 and more. GT 6 and Band 9/10 are not named (the list looks partial). [HIGH] |
| consumer.huawei.com/en/support/content/en-us16077634, step 3 (screenshot, GT 5 Pro, current HH iOS UI, undated) | iPhone, new UI | **Messages, WeChat, Huawei Health, Calendar, WhatsApp, Gmail, Outlook, Other** | Master switch "Notifications" on top; app icons; list order is fixed. [HIGH] |
| consumer.huawei.com/cn/support/content/zh-cn16032312, step 5 (screenshot, newest UI) | iPhone, China | master "同步手机消息通知至手表", section "支持的应用" (Supported apps) with "全部开启" (turn all on) and a **search box**; first rows 微信 (WeChat), 信息 (Messages), more below the crop | The page also says: enable the app in iOS Settings > Notifications, set Show Previews to Always/When unlocked, and enable Share System Notifications for the watch. [HIGH] |
| App Store release notes, HUAWEI Health: Global 16.1.4.308 (15 May 2026, per the version list on the PH App Store page) | iOS | n/a | "Optimized search and notification settings-related functions." Matches the search box. [HIGH] |
| r/Huawei `1q6g4qq` (Watch Fit 4, iPhone 12) | user | messages, WeChat/WhatsApp, Huawei Health, Calendar, **Instagram**; "rest show as Other" | Also: "Only 30 contacts can be selected." [HIGH as a user report] |
| r/HuaweiWatchGT `1nzcdsy` (GT 5 + iPhone) | user | emails, **WhatsApp, Instagram, FB, Outlook**, "others category that doesn't show what it includes" | [HIGH as a user report] |
| r/HuaweiWatchGT `1sg4512` (GT 6 Pro + iPhone 15) | user | "for the most important apps you can toggle … a misc category" | [HIGH as a user report] |
| r/Huawei `1dgyubk` (Fit 3 + iPhone) | user | "some apps in the notifications tab … and then others which means all the other apps" | [HIGH as a user report] |

**Union of apps seen with their own switch on iOS:** Messages, WeChat, Huawei Health, Calendar, WhatsApp, Gmail, Outlook, Instagram, Facebook, plus **Other** (and, in China builds, QQ/Alipay-type apps, see 1.2). The list differs by HH version, region and watch. **Not seen with a switch: Telegram, LINE, TikTok, Slack, X, Indonesian apps (Shopee, Tokopedia, Gojek, Grab).** They fall under "Other". I found no source that lists the exact current iOS set; an HH iOS screenshot of the full Notifications screen is the cheap way to get it (the owner or the user in question can send one).

### 1.2 The catalogue behind it: Huawei's own cloud mapping with iOS bundle ids

HH downloads a cloud config `com.huawei.health_common_config` / file `message_notification_switch` (JSON `package_mappings`, deviceType `notificationMonitor`). The owner's logcat from 2026-10-14 (`/home/dzul/re/huawei-health/sign-capture.log`, lines 300823 ff., tag `Notify_ConnectManager`) printed the first ~2000 characters of it (the app's logger dropped 14,327 more, so the file is ~16 KB, about 100 apps). Each entry: `appid`, `android[]`, `homony[]` (sic, HarmonyOS), **`ios[]`**.

| appid | App | android | ios |
|---|---|---|---|
| 1 | SMS / Messages | com.android.mms, com.hihonor.mms, com.oneplus.mms, com.samsung.android.messaging, com.google.android.apps.messaging, … | **com.apple.MobileSMS** |
| 2 | WeChat | com.tencent.mm | **com.tencent.xin** |
| 3 | Huawei Health | com.huawei.health | **com.huawei.health** |
| 4 | Calendar | com.android.calendar, com.huawei.calendar, com.google.android.calendar, … | **com.apple.mobilecal** |
| 5 | QQ | com.tencent.mobileqq | **com.tencent.mqq** |
| 6 | MeeTime | com.huawei.meetime | none |
| 7 | Huawei Assistant | com.huawei.intelligent | none |
| 8 | Alipay | com.eg.android.AlipayGphone | **com.alipay.iphoneclient** |
| 9 | Smart Life | com.huawei.smarthome | **com.huawei.smarthome** |
| 10 | Honor suggestion | com.hihonor.suggestion | none |
| 11 to ~100 | not captured (log truncated) | | |

Facts and caveats:

- The same log (`printAppSwitchStatus`, line 295776) shows the phone's switch state as a 100-element array indexed by `appid - 1`, values 0 closed / 1 open / 2 default. So Huawei's catalogue is **top-100 apps, one stable `appid` each, per-platform ids**, and the state syncs through the Huawei account (cloud sample `900500035`). [HIGH, decompile of `msb.java`, `classes11.dex`]
- The iOS screenshots list apps in **appid order** (Messages 1, WeChat 2, Huawei Health 3, Calendar 4, then WhatsApp, Gmail, Outlook from appids above 10). That fits "iOS list = catalogue entries with a non-empty `ios[]`, filtered by region/watch". [MED, inference from order]
- I verified with the iTunes lookup API (country=id, 2026-10-19) that `com.apple.MobileSMS`, `com.apple.mobilecal`, `com.tencent.xin` (WeChat), `com.tencent.mqq` (QQ) and `com.alipay.iphoneclient` (Alipay) are real bundle ids. **`com.huawei.health` and `com.huawei.smarthome` are not found** there, and HH's real iOS bundle ids are `com.huawei.global.health` (id6740115642, 17.0.8.318, 2026-10-13) and `com.huawei.iossporthealth` (id1325481372, 17.0.8.315). So the `ios[]` strings are **not guaranteed to be the strings the watch matches** against the ANCS AppIdentifier. Do not hard-code them as the wire ids without the test in section 3. [HIGH for the lookup, UNKNOWN for what it implies]
- Third-party bundle ids that exist (iTunes lookup, id storefront): `net.whatsapp.WhatsApp`, `net.whatsapp.WhatsAppSMB`, `com.google.Gmail`, `com.microsoft.Office.Outlook`, `com.burbn.instagram`, `com.facebook.Facebook`, `com.facebook.Messenger`, `ph.telegra.Telegraph`, `jp.naver.line`, `com.tinyspeck.chatlyio` (Slack), `com.hammerandchisel.discord`, `org.whispersystems.signal`, `com.atebits.Tweetie2` (X), `com.microsoft.skype.teams`, `com.shopee…` (`com.beeasy.shopee.id`), `com.tokopedia.Tokopedia`. `com.gojek.app`, `com.grab.GrabTaxi`, `com.zhiliaoapp.musically` returned nothing in the id storefront (wrong guess or region-locked). That these ids exist is verified; that Huawei's list uses them is not.

## 2. Mechanism

### 2.1 Why the filter has to be on the watch

- Huawei: "iOS will read new messages from your phone's Notification Center and then push them to your watch/band" (en-us15945720) and "Watch-based push notifications are supported by iPhone's built-in Apple Notification Center Service (ANCS)" (en-us16077634). [HIGH]
- iOS gives HH no access to other apps' notifications (HH cannot even list apps; Huawei says so). JoyoFit's `docs/ios.md` already notes the watch is the ANCS client. So HH cannot filter in the phone; whatever HH iOS's switches do, the result must reach the watch, which sees `AppIdentifier` (bundle id) on each ANCS notification. [HIGH for the premise, MED for the conclusion]
- There are two layers, as Huawei's pages say: iOS Settings > Notifications per app (what ANCS exposes at all) and HH's switches (what the watch lets through). [HIGH]

### 2.2 Service 0x02 command table (HH 17.0.8.300 wire schema)

Source: the owner's APK, `assets/arkui-x/arkuix/resources/rawfile/serviceId_2.json` (HH's own machine-readable schema; "encode" = phone to watch, "decode" = watch to phone). [HIGH]

| Cmd | Name (my label) | Fields (tag: name) | In GB? |
|---|---|---|---|
| 01 | notification | 1 message_id, 2 message_type, 3 motor_enable, 4 content{12 text_list{14 type,15 format,16 content}}, 17 message_pkgname, 18 category, 19 reminder_status, 20 sub_id, 21 time, 23 phone_number, 25 key, 26 id, 27 channel_id, 29 live_struct{…}, 42 ping_list, 50 receive_time, 51 extras; reply 127 error, 2 id, 3 type, 4 pkgname, 5 cost | yes (partly) |
| 02 | constraints | req 1 restriction_list; resp 1 restriction_list{3 message_type, 16 text_restriction_list{18,19,20}} | yes |
| 04 | switch | 1 message_enable_struct{**2 notification_enable, 3 incoming_call_enable**} | yes (`NotificationStateRequest`; GB writes both with one bool) |
| 05 | capabilities | 1 supported_notify_message_type (bitmap) | yes |
| 06 | remove | 1 type, 2 package_name, 3 key, 4 id, 5 channel, 6 category | yes |
| **0B** | **app switch list** | **1 app_list[ { 3 app_id: string, 4 notification_enable: u8 } ]** (same shape both directions) | **no** |
| 0D | watch app list | decode: 1 app_list[{3 app_package_name, 4 app_name, 5 app_version_code}]; encode: 127 error_code | no |
| 0E | app info + icon | 1 app_package_name, 2 app_name, 3 app_version_code, 4 app_icon | no |
| 0F | ping | 1 requestId, 2 deviceType, 3 timeout; reply 127, 1 | no |
| 10 | reply | 1 app_type, 2 encode_format, 3 sub_id, 4 send_destination, 5 attachment_id, 6 msg_content, 7 result_code | yes |

GB (`devices/huawei/packets/Notifications.java`, HuaweiPacket.java:502-509, checked at efb0ae5c) implements only 01, 02, 04, 05, 06, 08, 10. Not in GB or in zyv/huawei-lpv2 (`huawei/services/notification.py`): 0B, 0D, 0E, 0F. Me7c7's `HDataResearch` (offvmp, pgnss) and `HBtCaptureParser` contain nothing on it; Me7c7's **huac** does (below).

### 2.3 02/0B in detail

**Layout (HH Android sender `nlz.java`, class in `classes11.dex`, method `sendAllSubSwitchStatusToDevice`):**

```
service 0x02, command 0x0B, TLV:
81 <len> {                    // container, tag 1
  82 <len> {                  // one per app, container tag 2
    03 <len> <app id, UTF-8>  // string
    04 01 <v>                 // one byte
  } ...
}
```

Example plaintext for `com.apple.MobileSMS` (28 bytes, `v` = 0x01 shown):
`81 1a 82 18 03 13 63 6f 6d 2e 61 70 70 6c 65 2e 4d 6f 62 69 6c 65 53 4d 53 04 01 01`. For a bundle id of `n` bytes a one-entry frame is `n + 9` plaintext bytes; each extra entry adds `n + 7`.

**Facts from HH Android (decompiled, owner's APK, jadx on `classes11.dex`):**
- Sent from `sendAllSubSwitchStatusToDevice(type 1..3)`; gated by **ExpandCapability 161** (`egs.e(deviceInfo, 161)`, same numbering as GB `supportsExpandCapability(n)`) and by the HH master notification switch. [HIGH]
- The candidates are a hard-coded list `cin.e` (40 Android packages: WeChat, QQ, SMS apps, calendars, WhatsApp(+w4b), Instagram, Messenger, LINE, Facebook, Twitter, …) plus the Huawei Assistant package. That is the Android twin of iOS's "customized separate switches for some frequently used apps". [HIGH]
- Watch to phone: HH handles an inbound 02/0B (`msa.java`) where the watch reports one app turned off (tag 3 = app id, tag 4 = 1); HH then writes state 0 locally and to the cloud array (`msb.java`). [HIGH]
- **Polarity is ambiguous.** In `nlz` the wire value is `0` for apps in the phone's "push-enabled" list and `1` otherwise, and in `msa` a watch report with `4 = 1` means "closed" (log text "app switch status is not close"). Read literally: **wire 1 = off, 0 = on**. The tag is named `notification_enable` in the schema, and huac sends `enabled ? 1 : 0` (opposite). GB's neighbouring `WearMessagePush` (02/08) is also inverted ("Value sent is the opposite of the switch status"). [MED that 1 = off; UNRESOLVED, must be tested]

**Proof the Fit 4 Pro accepts it:** HH Android, same phone, same watch (`HUAWEI WATCH FIT 4 Pro-40A`), `sign-capture.log` 2026-10-14 22:14:45 to 22:14:46: `sendCommand serviceId: 2 commandId: 2` (line 291308), `2/5` (291621), `sendAllSubSwitchStatusToDevice enter type: 3` (291632), **`2/11` (291634)**, `2/4` (292846). No "device is not support switch send deal" line follows. So the Fit 4 Pro passes bit 161 and HH's init order is 02/02, 02/05, **02/0B**, 02/04. (JoyoFit logged only "ExpandCapability: 40 bytes", not the bitmap, so bit 161 itself is inferred; SupportReport.kt prints it.) [HIGH for the traffic, MED for "bit 161 set"]

**Independent implementation:** `codeberg.org/Me7c7/huac` (commit 6e0d4ea2, 2026-10-05): `devices/huawei/src/services/notifications_service.cpp:132 sendAppSwitches` builds exactly the TLV above (polarity `enabled ? 1 : 0`), waits for the reply, treats result `0x7F` = OK (`RESULT_OK`) or absent as success; `capabilities.hpp:172 supportsNotificationAppSwitches() = supportsExpandCapability(161)`; `ui/app_filter_dialog.py` titles it "Which apps the watch accepts notifications from" (so its author treats it as a watch-side filter keyed by app id). I found no evidence in that repo that it was verified on hardware. [HIGH for the code, UNKNOWN for validation]

### 2.4 What the iOS app might do differently (not knowable from public sources)

| Question | Candidates | Evidence |
|---|---|---|
| Does HH iOS send 02/0B at all? | yes / uses something else | Only per-app carrier found. DataSync (`37/01`, module `hw.unitedevice.configManager`) has `CONFIG_ID_*_NOTIFY_SWITCH` strings in HH's ArkTS code, but those are HarmonyOS-phone and cloud-config switches, not iOS. P2P `hw.unitedevice.notificationpushapp` (6001) pushes Android app icons and cannot work on iOS. [MED] |
| `app_id` string | bundle id (`com.apple.MobileSMS`) / numeric `appid` ("1") / something else | Android sends package names. The cloud `ios[]` ids do not even match HH's own bundle id (1.2). [LOW-MED bundle id] |
| Polarity | 1 = off (HH decompile) / 1 = on (schema name, huac) | 2.3. [UNRESOLVED] |
| "Other" | special id, or the watch's default for ids not in the list | [UNKNOWN] |
| Does the watch reply? | `7F 04 00 01 86 A0` (100000 = OK, like 02/04's reply in our log) | huac code. [MED] |

## 3. Decisive test with no capture (recommended first)

Run from JoyoFit's own session (iPhone + Fit 4 Pro; the watch takes one session, so HH must not be connected). It only changes a reversible watch-side filter.

1. Confirm ANCS works first: log line `ANCS … authorized: yes`, and a Messages and a WhatsApp notification reach the watch.
2. Send 02/0B `[("com.apple.MobileSMS", off)]` with **off = 1**, check the reply code, then send an SMS/iMessage to the iPhone. Does the watch still show it? Send a WhatsApp message as control (must still show).
3. If it still shows, repeat with **off = 0**. If still no effect, repeat both with id `"1"` (the cloud `appid`). Then try the "Other" candidates (`"other"`, `"0"`, empty).
4. Always finish by sending the all-on list and confirming normal delivery.

Outcomes: any combination that blocks only Messages proves a watch-side per-app filter exists and fixes id style and polarity (then also test WhatsApp `net.whatsapp.WhatsApp`, Gmail, Outlook, Instagram, Facebook). No effect for any combination does not disprove HH iOS using a different carrier: go to section 4. Four runs, about 15 minutes.

## 4. Capture route: HH iOS to watch over BLE

### 4.1 What is on the wire

On iOS the Fit 4 Pro talks BLE GATT, service `FE86`, write char `FE01` (write without response), notify char `FE02` (`docs/ios.md` lines 98-135; the Classic RFCOMM channel in `protocol/README.md` is Android-only). HCI-level capture shows ATT payloads **after** link-layer encryption is removed, so the Huawei frame is visible. But after auth the Huawei TLVs are AES-encrypted by HH itself, so the 02/0B *content* is ciphertext. What is cleartext:

```
5A | len:u16 | 00 | svc | cmd | 7C 01 01 | 7D 10 <iv16> | 7E <len> <ciphertext> | CRC16        (unsliced)
5A | len:u16 | 01 | flag | svc | cmd | …                                                       (first of sliced fragments)
```

- `svc` and `cmd` are cleartext: **02 0B** is findable. [HIGH, from our own log: `5A00320002047C01017D10…7E18…` is NotificationState]
- On JoyoFit's own Fit 4 Pro session the cipher is AES-GCM-like: `7E` length = plaintext TLV length + 16 (ExpandCapability request: plaintext 2, `7E 12` = 18; response: 42, `7E 3A` = 58; NotificationState: 8, `7E 18` = 24). If HH iOS's link uses the same method, **`7E len - 16` is the exact plaintext length**. With CBC it would round to 16 bytes. [HIGH for the arithmetic on our session, MED that HH iOS's session matches]
- The watch's reply is cleartext: `5A 00 09 00 02 0B 7F 04 00 01 86 A0 CRC`-style (100000 = OK; compare 02/04's reply in our log). [MED for 0B]
- The content cannot be decrypted from a capture: the key comes from HH's own bonding (HiChain), not from HCI. HBtCaptureParser (`-k` master key) needs a key we cannot get from an iPhone. Length analysis is the substitute.

### 4.2 Setup (iPhone, once)

1. On the iPhone open `https://developer.apple.com/bug-reporting/profiles-and-logs/?name=bluetooth` and install **Bluetooth for iOS** (the Bluetooth SIG blog lists an Apple developer account as a requirement; Settings > General > VPN & Device Management > Install; Apple's profile text says it expires after 4 days). [HIGH: Apple page text, Bluetooth SIG blog 2019-10-15]
2. Restart the phone and unlock it before starting. (Apple developer forum thread 770914 reports PacketLogger showing zero packets on some iOS versions; the thread's fix was not readable. If that happens, reinstall the profile or use sysdiagnose, 4.4.) [MED]
3. Install HH (Global `com.huawei.global.health` outside China) and pair the Fit 4 Pro to it. Disconnect JoyoFit from the watch (one session).

### 4.3 Live capture (Mac, as asked; or Linux with no Mac)

**Mac:** download *Additional Tools for Xcode* (developer.apple.com/download/all, search "Additional Tools for Xcode"), open `Hardware/PacketLogger.app`, plug in the iPhone with a cable, accept the trust prompt, **File > New iOS Trace**. A pulse icon appears in the iPhone status bar. Save as `.pklg`, and File > Export > btsnoop if you want Wireshark. (Bluetooth SIG blog; novelbits.io guide.)
**Linux (no Mac needed):** `idevicebtlogger -f pcap hh-notif.pcap` (libimobiledevice; same profile and USB cable; man page: "Capture HCI traffic of a connected device … Requires Bluetooth logging profile … iOS 13 or higher"). `pymobiledevice3` has a `bt_packet_logger` service too.

**Script (start the trace BEFORE step 1; iOS may skip GATT discovery for a bonded watch, so also force-quit HH and reopen it to see the init burst):**

| # | Action in HH iOS (Devices > watch > Notifications) | Expect |
|---|---|---|
| 1 | Force-quit HH, reopen it so it reconnects | init burst; look for 02/02, 02/05, **02/0B**, 02/04 in that order (Android order) |
| 2 | Master "Notifications" off, then on | two 02/04 frames (`7E 18`) |
| 3 | WhatsApp off, wait 3 s, on | 02/0B per change; note frame length each time |
| 4 | Messages off, then on | same, different id length |
| 5 | **Other** off, then on | 02/0B; its length reveals the "Other" id |
| 6 | "All on" (CN UI) or turn a second app off, then screenshot the screen | whether HH sends the changed entry only or the whole list |
| 7 | Stop the trace | |

**Reading it without Wireshark.** `bun scripts/hh-notif-capture.ts hh-notif.pklg` (or the `.pcap`) rebuilds the Huawei frames from the
ATT writes and notifications and prints each 0x02 frame with its time, direction, `7E` length and the GCM plaintext length; `--all` lists every
service, for the case where no 02/0B shows up. Note the clock time of each toggle so it can be matched to the printed seconds.

**What to look for.** Wireshark filter on the export: `btatt.value[0:1] == 5a && (btatt.value[4:2] == 02:0b || btatt.value[5:2] == 02:0b)` (unsliced: service at byte 4; sliced first fragment: byte 5). Then for each frame read the `7E` length and compute `plaintext = len - 16` (GCM):

| One-app 02/0B plaintext | Meaning |
|---|---|
| 10 bytes (`7E 1A`) | numeric `appid` "1" (n = 1: n + 9) |
| 28 bytes (`7E 2C`) | `com.apple.MobileSMS` (n = 19) |
| 30 bytes (`7E 2E`) | `net.whatsapp.WhatsApp` (n = 21) |
| 12-13 bytes | "Other" id of 3-4 characters (n + 9) |
| full list at connect | `Σ(n_i + 7) + 3` (+1 when over 127, two-byte length); compare with the number of toggles shown |

Also record: whether any 02/0B arrives from the watch (user turned an app off on the watch), and the cleartext reply code. If **no** 02/0B appears when you toggle apps, list every other (svc, cmd) pair seen at toggle time (`37/01` DataSync, `34/01` P2P, `0x01/xx`); the toggle time is the discriminator.

### 4.4 Sysdiagnose alternative (no cable)

With the profile installed, run the toggle script, then immediately trigger a sysdiagnose (hold both volume buttons and the side button about 1.5 s, feel the haptic, wait several minutes), then Settings > Privacy & Security > Analytics & Improvements > Analytics Data > `sysdiagnose_….tar.gz` > AirDrop to the Mac. Inside, a `.pklg` under `logs/` (Apple developer forum thread 80811: "under logs I found the bluetooth log … in a pklg file that requires the packetlogger app"; exact path/name unverified, so `find . -name '*.pklg'`). Open it in PacketLogger or convert for Wireshark. The buffer is rolling, so keep the session short. [MED]

## 5. Implementation plan

Only after section 3 or 4 proves the carrier. If neither does, keep Option A of `ios-notif-filter.md` (no per-app UI on iOS).

**5.1 Protocol (Swift first; Kotlin only if we also want to sync the watch's own list)**
- `modules/huawei-wear/ios/HuaweiProtocol/Sources/HuaweiProtocol/Packets/NotificationPackets.swift`: add `Notifications.AppSwitches` (id `0x0B`): `request(entries:[(id,String),(enabled,Bool)])` building `81{82{03 id, 04 v}…}` with a single `offValue` constant set from the test; an inbound parser for the watch's own 02/0B report (id + closed flag); register `0B` in the inbound dispatch so a user toggling an app off on the watch updates the stored choice.
- Gate: `DeviceCaps.expandCapability(161)` (the way `HuaweiInitializer.swift:126` already reads bits), not SupportedCommands (HH does not use it). Log the bit (`Notifications: ExpandCapability 161 = yes/no`) at every connect so the support report shows it for GT 4/5/6 and Band 9/10.
- Init order as HH: after NotificationConstraints, before NotificationState (`HuaweiInitializer.swift` ~154; `WatchNotifications.linkConnected` already applies the saved choice).
- Tests: byte-exact vectors in `NotificationPacketsTests.swift`, golden from `GoldenGen/src/GoldenNotifications.java` with a `HuaweiTLV` build that mirrors `nlz.java` (this packet has no GB class, so the golden is hand-built from the layout in 2.3).

**5.2 App layer (iOS)**
- `WatchNotifications.swift`: store per-app choice (key `watch_notification_apps`, default all on, plus an "Other" entry), send the list on connect (only when the user changed something, as for 02/04) and on each change; surface reply code in the log.
- `HuaweiWearModule.swift` ~328/590: `getNotificationApps` returns the curated catalogue (below) with `enabled`; `setNotificationAppEnabled(id, enabled)` persists and sends instead of rejecting `ERR_UNSUPPORTED`. Reuse `NotificationApp` in `src/HuaweiWear.types.ts` (add `kind: 'bundle' | 'other'` if needed) and `NotificationPolicy` semantics (explicit choice wins, default on).
- Catalogue (ids verified to exist, not verified to be Huawei's): Messages `com.apple.MobileSMS`, Calendar `com.apple.mobilecal`, WhatsApp `net.whatsapp.WhatsApp`, Gmail `com.google.Gmail`, Outlook `com.microsoft.Office.Outlook`, Instagram `com.burbn.instagram`, Facebook `com.facebook.Facebook`, Messenger `com.facebook.Messenger`, Telegram `ph.telegra.Telegraph`, LINE `jp.naver.line`, plus **Other**. Only ship an entry that the test showed the watch honours. If the watch ignores ids outside Huawei's own table, ship exactly the ids HH shows (get them from section 4 or a screenshot).
- UI: replace `src/components/IosUnavailable.tsx` for this screen with the real list on iOS; copy must say the switch is applied by the watch, covers only listed apps plus "Other", and iOS Settings > Notifications still decides what reaches the watch at all. Add all new strings to the i18n files (`scripts/i18n-check.ts` enforces parity).
- Docs: rewrite the "Per-app notification filter" bullet in `docs/ios.md` (~line 90) and the 02/0B row in `protocol/README.md`; mark UNVERIFIED until a capture or a hardware run exists.

**5.3 Risks**
- HH on the same watch overwrites the list on its next connect; JoyoFit should re-send its choice on connect (as it does for 02/04).
- A wrong polarity or id style silently blocks every notification: ship behind the hardware test, with a "restore all on" action and the master 02/04 untouched.
- Model coverage: only Fit 4 Pro is evidenced (HH Android sent 02/0B to it). GT 4/5/6 and Band 9/10 need their own bit-161 check; HH's own iOS page lists many of them.
- The cloud mapping can change; the catalogue should be data, not code constants.

## 6. Corrections to `ios-notif-filter.md` and `docs/ios.md`

| Statement | Now |
|---|---|
| "no watch-side per-app filter exists" / "no app-list, whitelist or per-app enable command in the 02 service" | Wrong. 02/0B exists (HH schema, HH Android traffic to the Fit 4 Pro, huac). Only "GB does not implement it" stays true. |
| "Huawei's own iOS app does not offer full per-app control" | True but incomplete: it offers a fixed list (≈8 apps) plus "Other". |
| Option B "no working enforcement path" | Unproven either way; the watch may be the enforcement point. Test first (section 3). |
| Option A recommended | Still the safe fallback; no longer the only option. |

## 7. Sources

- Huawei support: `consumer.huawei.com/{ca,en,id}/support/content/en-us15867276` (`in-id15867276`), `en-us16077634` (screenshots), `en-us15945720`, `en-us15958509`, `en-us15948469`, `en-gb00737073`, `cn/…/zh-cn16032312`.
- App Store: `apps.apple.com/ph/app/huawei-health-global/id6740115642` (release notes 16.1.4.308; iTunes lookup: bundle `com.huawei.global.health`, 17.0.8.318, 2026-10-13; `com.huawei.iossporthealth`, 17.0.8.315).
- Reddit via pullpush.io (reddit.com blocked): `r/Huawei` `1dgyubk`, `1q6g4qq`; `r/HuaweiWatchGT` `1nzcdsy`, `1sg4512`.
- Owner's RE data (read only): `/home/dzul/re/huawei-health/sign-capture.log` (lines 291308-292846, 295776, 300823-301160), `huawei-health.apk` 17.0.8.300 (`assets/arkui-x/arkuix/resources/rawfile/serviceId_2.json`; jadx of `classes11.dex` classes `nlz`, `msa`, `msb`, `mle`, `nlw`; `classes4.dex` class `cin`; `classes2.dex` `ffr`).
- Gadgetbridge `efb0ae5c`: `devices/huawei/packets/Notifications.java`, `HuaweiPacket.java:502-509`, `service/devices/huawei/HuaweiNotificationsManager.java`, `p2p/HuaweiP2PAppIcon.java`; issue codeberg #5552.
- `github.com/zyv/huawei-lpv2` (`huawei/services/notification.py`); `codeberg.org/Me7c7/huac` (`notifications_service.cpp`, `capabilities.hpp`, `ui/app_filter_dialog.py`), `Me7c7/HDataResearch`, `Me7c7/HBtCaptureParser`.
- Capture how-to: bluetooth.com/blog/a-new-way-to-debug-iosbluetooth-applications, novelbits.io/debugging-sniffing-secure-ble-ios, man page `idevicebtlogger(1)`, Apple Developer Forums threads 80811 and 770914.
- Local: `watch-fit/docs/ios.md`, `protocol/README.md`, `modules/huawei-wear/ios/{WatchNotifications.swift,HuaweiWearModule.swift,HuaweiProtocol/Sources/HuaweiProtocol/Packets/NotificationPackets.swift}`.

## 7b. Implementation status (2026-10-22)

Built as the plan in section 5 allowed for an unproven carrier: the list ships, the switches stay off, and a test on the user's own watch finds the
encoding. Details and the safety rules are in `docs/ios.md` (Per-app notification switches). In short:

- `Notifications.AppSwitches` (02/0B) in `NotificationPackets.swift`, golden frames built with the real Java TLV encoder (`GoldenNotifications.java`).
- `ios/NotificationAppFilter.swift`: ExpandCapability 161 gate (logged at every connect), the four candidate encodings (A bundle id 1 = off, B bundle id
  0 = off, C1 and C2 Huawei numbers), one-entry probes, the switch-back written down before each probe, stored encoding and choices.
- Section 3's test is the in-app "Uji filter" flow, with a second message after switching back as the confirmation. It answers the polarity and id
  style questions for Messages (and, for A and B, any catalogue app); it does **not** answer "Other" (the row sends the guess `other`).
- Still open until a TestFlight run: bit 161 on the Fit 4 Pro (logged), whether the watch replies to 02/0B at all (the answer code is logged), and
  every encoding question above. The result line goes to the support report.

## 7c. First results from testers (support reports, 2026-11-12/13)

Three "Uji filter" runs from JoyoFit 1.1 (202611051423) on iOS 27, all ending `none` (no candidate hid the message):

| Report | Watch, firmware | App tested | Tried | Watch's answer to each 02/0B |
|---|---|---|---|---|
| JRG-490 | Band 11 Pro, 6.0.0.130(SP3C00M03) | `net.whatsapp.WhatsApp` | A=shown, B=shown | 100000 (OK) |
| JRG-491 | Watch Fit 4, 6.1.0.117(SP20C00M05) | `net.whatsapp.WhatsApp` | A=shown, B=shown | 100000 (OK) |
| JRG-492 | Watch Fit 4, 6.1.0.117(SP20C00M05) | `com.burbn.instagram` | A=shown, B=shown | 100000 (OK) |

What this settles: bit 161 is set on both models (`gate161=yes`), and the watch accepts 02/0B and answers OK. On these two models, sending the bundle id
does not filter, with either polarity. C1/C2 were not tried because WhatsApp and Instagram have no known Huawei catalogue number. Next: a run with
Messages (the one app with a number, `appid` 1) to test C1/C2. Without that, the HH iOS capture in section 4 is the remaining way to learn the id
string. 02/0B is still not listed in SupportedCommands on either model (02: 01 04 06 08), only gated by bit 161.

## 8. Confidence summary

| Claim | Level |
|---|---|
| HH iOS has per-app switches for a fixed list + Other | HIGH |
| List contents (union above); exact current list | HIGH / UNKNOWN |
| Cloud catalogue has per-app `ios[]` bundle ids; list order = appid order | HIGH / MED |
| `ios[]` strings equal what the watch matches | UNKNOWN (HH's own id differs) |
| Filtering is done on the watch (ANCS AppIdentifier) | MED |
| 02/0B exists, layout, gate 161, accepted by Fit 4 Pro (Android) | HIGH |
| HH iOS uses 02/0B | MED |
| Wire polarity | UNRESOLVED (HH decompile says 1 = off, huac says 1 = on) |
| App id string on iOS, and the "Other" id | UNKNOWN |
| Length of encrypted 02/0B reveals the id style | MED (GCM arithmetic proven on our session only) |
