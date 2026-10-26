---
app: joyofit
feature: Peta offline di jam (uji lab, eksperimen)
shipped: 2026-10-25
available: code
tier: free
post: skip (eksperimen untuk uji lab di jam pemilik, PR lab belum di-merge, belum terbukti di jam mana pun)
atur: JRG-426
---

**Apa:** Saklar eksperimen baru di Pengaturan > Tentang & lanjutan > Eksperimental, mati secara bawaan: "Peta offline di jam (uji lab)". Kalau dinyalakan, layar lab menampilkan peta yang disediakan server JoyoFit (saat ini Malang dan Surabaya, dibuat JoyoFit dari OpenStreetMap), mengunduhnya ke HP (diperiksa SHA-256), lalu mengirimnya ke aplikasi peta offline di jam; daftar dan hapus peta di jam maupun di HP juga ada. Uji pertama di Watch Fit 4 Pro pemilik (26-10-2026): jam menerima peta Malang dan mencantumkannya di daftar petanya; apakah peta tergambar masih dicek.

**Kenapa orang peduli:** Jam Huawei dengan peta offline (mis. Watch Fit 4 Pro) hanya bisa mengunduh peta lewat Huawei Health. Ini menguji apakah peta dari data terbuka OpenStreetMap bisa dipakai di jam tanpa Huawei Health.

**Angle post:** (belum untuk diposting) Peta offline dari OpenStreetMap ke jam, tanpa akun Huawei: sedang diuji di lab.

**Bukti visual:** Belum ada. Setelah uji lab berhasil: foto peta Malang di jam pada dua tingkat zoom dan tangkapan layar lab dengan hasil "kode 0" (catatan di docs/offline-maps.md, "Lab").

**Jangan klaim:** Eksperimen, mati secara bawaan, hanya di build lab (belum di-merge, belum ada di build pengguna). Baru diuji di satu Watch Fit 4 Pro: jam menerima file, tampilan peta di jam belum terverifikasi; jangan tulis bahwa peta sudah tampil di jam. Hanya dua kota (Malang, Surabaya); pengiriman lewat Bluetooth sekitar 75 kB/s (Surabaya sekitar 10 menit). Peta dibuat dari OpenStreetMap (© kontributor OpenStreetMap, ODbL), bukan peta Huawei/Petal; Belum ada unduhan peta untuk pengguna umum. Jangan tulis 'tersedia di Play Store/App Store'. Tidak berafiliasi dengan Huawei.
