# JoyoFit: legal notes

This page says plainly what JoyoFit is and is not. It is not legal advice and makes no claim about any specific law.

## What JoyoFit is

JoyoFit is independent interoperability software. It lets you read, on your own phone, the data that a Huawei or Honor
watch you own records about you (steps, heart rate, sleep, workouts and so on), and lets you send settings, watch faces and
notifications to that watch over Bluetooth.

- It contains **no Huawei or Honor code**, no firmware, and no files copied from Huawei's apps or servers.
- It does **not** use a Huawei account, Huawei Health, Huawei cloud services or any Huawei server. For satellite-assist data the
  phone contacts Broadcom's public file server (`gllto.glpals.com`), with a plain request and no identification of any app, and,
  only with the experimental HW_AGNSS switch turned on (off by default), JoyoFit's own server (`api.fit.joyorogo.com`), which
  builds that file from open IGS/BKG broadcast ephemeris (IGS data terms: open use with attribution, no warranty) and serves the
  same bytes to everyone; that request carries no account, location or ID. Details: [docs/agps.md](docs/agps.md).
- It is **not affiliated with, endorsed by or sponsored by** Huawei Technologies Co., Ltd. or Honor.
- "Huawei", "Honor", "HUAWEI WATCH FIT" and similar names are trademarks of their owners. They are used here only to say
  which watches the software works with.
- Other names and marks in the app (Strava, Google Health Connect, Apple Health, Claude, ChatGPT) belong to their owners and
  are shown only to say which service a feature talks to, following each owner's brand rules. JoyoFit is not affiliated
  with or endorsed by any of them. What is shown and why: [docs/brand-marks.md](docs/brand-marks.md).

## Basis

JoyoFit is derived from [Gadgetbridge](https://codeberg.org/Freeyourgadget/Gadgetbridge), the free-software project that
documented and implemented the communication with these watches. Gadgetbridge is licensed under the
AGPL-3.0-or-later, and so is JoyoFit (see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE)). Original copyright notices are kept in
the ported files. The protocol notes in [`protocol/`](protocol/README.md) describe facts about how the watch talks
(message layouts, constants), written in our own words from Gadgetbridge and from watching how the watch behaves.

## What JoyoFit does not do

- It does not circumvent copy protection or DRM, and it does not break encryption it is not given the key for. The
  pairing key it uses is the one created when you pair your own watch.
- It does not unlock paid or restricted features. A watch face that the watch refuses to accept stays refused; JoyoFit has no
  way to forge a Huawei signature and does not try.
- It does not need, store or ask for a Huawei account, and it does not impersonate Huawei's apps.
- It does not collect your health data on a server of ours unless you choose to sign in to the optional cloud (see the
  [privacy page](https://fit.joyorogo.com/privasi)). One more exception, off by default: if you turn on Sleep insights
  (Wawasan tidur) in Settings, JoyoRogo, a nightly sleep summary (when you slept and woke, time asleep and awake, awakenings,
  sleep stages if your watch gives them, the watch's sleep score, overnight HRV and resting heart rate, naps, and, if you
  paired a bedroom thermometer, the room's average, lowest and highest temperature and humidity over that night) goes to your
  own JoyoRogo account. The thermometer's raw readings (one every 5 minutes) stay on your phone and are deleted after 120 days
  or when you forget the thermometer. The nightly summary is kept for 90 nights, deleted when you turn the switch off or delete your data, not shared, and not
  used for ads or tracking.

## Not a medical device

JoyoFit shows the numbers your watch reports. It is not a medical device, does not diagnose, treat or prevent any condition,
and its estimates (calories, fat and carbohydrate burn, recovery and similar scores, cycle predictions) are not medical
advice. Talk to a doctor for health decisions. Do not rely on it for emergencies.

## For rights holders

If you think something in this repository infringes your rights, please write to **dzulfikar.at@gmail.com** with the file or
path and what you would like done. We read every message, will answer within 14 days, and will remove or rework material that
should not be here while we look into it.

---

## Ringkasan (Bahasa Indonesia)

JoyoFit adalah perangkat lunak interoperabilitas independen: membaca data dari jam Huawei atau Honor milikmu sendiri ke HP-mu, lewat
Bluetooth. JoyoFit tidak berisi kode, firmware, akun, atau server Huawei, dan tidak berafiliasi dengan atau didukung oleh Huawei
maupun Honor. Nama merek hanya dipakai untuk menyebut jam yang didukung. Dasarnya adalah Gadgetbridge (lisensi AGPL-3.0-or-later),
dan JoyoFit memakai lisensi yang sama. JoyoFit tidak menembus perlindungan salinan, tidak membuka fitur berbayar, dan tidak memakai
akun Huawei. JoyoFit bukan alat medis; angkanya bukan saran medis. Pemegang hak yang merasa ada yang melanggar haknya bisa menulis ke
dzulfikar.at@gmail.com; kami berkomitmen menjawab dalam 14 hari dan menurunkan atau mengubah materi yang memang tidak semestinya ada.
