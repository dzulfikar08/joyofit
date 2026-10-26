---
app: joyofit
feature: Peta offline di jam (uji lab, eksperimen)
shipped: 2026-10-25
available: code
tier: free
post: skip (eksperimen untuk uji lab di jam pemilik, PR lab belum di-merge, belum terbukti di jam mana pun)
atur: JRG-426
---

**Apa:** Saklar eksperimen di Pengaturan > Tentang & lanjutan > Eksperimental, mati secara bawaan: "Peta offline di jam (uji lab)". Kalau dinyalakan, layar lab menampilkan peta yang disediakan server JoyoFit (dibuat JoyoFit dari OpenStreetMap, satu peta per kabupaten/kota), bisa dicari per nama atau kode, disaring per provinsi, dan diurutkan dari yang terdekat (lokasi dipakai di HP saja, tidak dikirim). Peta diunduh ke HP (diperiksa SHA-256) lalu dikirim ke aplikasi peta offline di jam; daftar dan hapus peta di jam maupun di HP juga ada. Di Watch Fit 4 Pro pemilik (26-10-2026) peta Malang dan Surabaya diterima dan tergambar. Server sudah siap untuk 514 kabupaten/kota; saat ini baru beberapa peta Jawa Timur yang diunggah, sisanya menyusul setelah build penuh.

**Kenapa orang peduli:** Jam Huawei dengan peta offline (mis. Watch Fit 4 Pro) hanya bisa mengunduh peta lewat Huawei Health. Ini menguji apakah peta dari data terbuka OpenStreetMap bisa dipakai di jam tanpa Huawei Health.

**Angle post:** (belum untuk diposting) Peta offline dari OpenStreetMap ke jam, tanpa akun Huawei: sedang diuji di lab.

**Bukti visual:** Belum ada. Setelah uji lab berhasil: foto peta Malang di jam pada dua tingkat zoom dan tangkapan layar lab dengan hasil "kode 0" (catatan di docs/offline-maps.md, "Lab").

**Jangan klaim:** Eksperimen, mati secara bawaan, hanya di build lab (belum di-merge, belum ada di build pengguna). Baru diuji di satu Watch Fit 4 Pro. Jangan tulis "semua kota tersedia" sebelum build penuh diunggah (saat ini Kota Malang, Kabupaten Malang, Kota Batu, Kabupaten Sidoarjo, Surabaya). Pengiriman lewat Bluetooth sekitar 75 kB/s (peta kota besar sampai sekitar 10 menit). Peta dibuat dari OpenStreetMap (© kontributor OpenStreetMap, ODbL), bukan peta Huawei/Petal. Jangan tulis 'tersedia di Play Store/App Store'. Tidak berafiliasi dengan Huawei.
