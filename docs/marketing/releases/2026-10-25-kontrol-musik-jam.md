---
app: joyofit
feature: kontrol musik dari jam
shipped: 2026-10-25
available: code
tier: free
post: todo
atur: JRG-415
---

**Apa:** Saat memutar musik atau podcast di HP Android (Spotify, YouTube Music, Apple Music, dan aplikasi media lainnya), layar Musik di jam kini menampilkan judul lagu, artis, status putar/jeda, dan volume, serta tombol Play, Pause, Next, Previous, dan pengatur volume di jam langsung mengontrol pemutaran di HP.

**Kenapa orang peduli:** Ganti lagu, jeda musik, atau atur volume langsung dari pergelangan tangan saat lari atau berkendara tanpa perlu mengeluarkan HP dari saku.

**Angle post:** Lagi lari terus mau ganti lagu? Sekarang layar Musik di jam langsung nyambung ke pemutar musik HP lewat JoyoFit.

**Bukti visual:** Putar lagu di Spotify/YouTube Music di HP Android, buka aplikasi Musik di jam yang terhubung ke JoyoFit, lalu tunjukkan judul lagu dan tombol Play/Next/Volume yang merespons dari jam.

**Jangan klaim:** Hanya mengatur pemutaran media yang sedang berjalan di HP Android (remote control protokol `0x25`), tidak di iPhone (iOS tidak mengizinkan aplikasi pihak ketiga mengontrol pemutaran aplikasi lain lewat BLE), bukan memindahkan/menyimpan file MP3 ke memori jam. Untuk menampilkan judul lagu dan artis secara penuh diperlukan izin Akses Notifikasi di Android; tanpa izin itu tombol putar/jeda/lewat dan volume tetap bekerja lewat tombol media sistem. Butuh build native baru (bukan OTA saja). Jangan sebut jam tertentu didukung sebelum diuji dan jangan tulis 'tersedia di Play Store/App Store'.
