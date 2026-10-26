---
app: joyofit
feature: Peta offline di jam (uji lab, eksperimen)
shipped: 2026-10-25
available: test-build
tier: free
post: skip (eksperimen untuk uji lab di jam pemilik, PR lab belum di-merge, belum terbukti di jam mana pun)
atur: JRG-426
---

**Apa:** Saklar eksperimen di Pengaturan > Tentang & lanjutan > Eksperimental, mati secara bawaan: "Peta offline di jam (uji lab)". Kalau dinyalakan, layar lab menampilkan peta yang disediakan server JoyoFit (dibuat JoyoFit dari OpenStreetMap, satu peta per kabupaten/kota). Daftarnya tidak berupa satu gulungan panjang: kotak cari di atas (nama wilayah, provinsi, atau kode BPS; "malang" menemukan Kota Malang dan Kabupaten Malang), filter provinsi, Kabupaten/Kota, dan "Di jam". Tanpa pencarian, peta yang sudah ada di jam tampil paling atas, lalu 10 wilayah terdekat (hanya kalau izin lokasi sudah diberikan; jaraknya dihitung di HP, lokasi tidak dikirim), lalu wilayah lain per provinsi yang bisa dibuka-tutup, lengkap dengan jumlah dan ukurannya. Peta diunduh ke HP (diperiksa SHA-256) lalu dikirim ke aplikasi peta offline di jam; daftar dan hapus peta di jam maupun di HP juga ada. Di Watch Fit 4 Pro pemilik (26-10-2026) peta Malang dan Surabaya diterima dan tergambar. Server sudah siap untuk 514 kabupaten/kota; saat ini baru beberapa peta Jawa Timur yang diunggah, sisanya menyusul setelah build penuh.

**Kenapa orang peduli:** Jam Huawei dengan peta offline (mis. Watch Fit 4 Pro) hanya bisa mengunduh peta lewat Huawei Health. Ini menguji apakah peta dari data terbuka OpenStreetMap bisa dipakai di jam tanpa Huawei Health.

**Angle post:** (belum untuk diposting) Peta offline dari OpenStreetMap ke jam, tanpa akun Huawei: sedang diuji di lab.

**Bukti visual:** Belum ada. Setelah uji lab berhasil: foto peta Malang di jam pada dua tingkat zoom dan tangkapan layar lab dengan hasil "kode 0" (catatan di docs/offline-maps.md, "Lab").

**Jangan klaim:** Eksperimen, mati secara bawaan, baru ada di build uji internal (belum di toko). Baru diuji di satu Watch Fit 4 Pro. Peta tersedia per kabupaten/kota di Indonesia (514 wilayah di server); jangan tulis peta di luar Indonesia. Pengiriman lewat Bluetooth sekitar 75 kB/s (peta kota besar sampai sekitar 10 menit). Peta dibuat dari OpenStreetMap (© kontributor OpenStreetMap, ODbL), bukan peta Huawei/Petal. Jangan tulis 'tersedia di Play Store/App Store'. Tidak berafiliasi dengan Huawei.
