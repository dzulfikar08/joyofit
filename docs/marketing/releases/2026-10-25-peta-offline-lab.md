---
app: joyofit
feature: Peta offline di jam (uji lab, eksperimen)
shipped: 2026-10-25
available: code
tier: free
post: skip (eksperimen untuk uji lab di jam pemilik, PR lab belum di-merge, belum terbukti di jam mana pun)
atur: JRG-426
---

**Apa:** Saklar eksperimen baru di Pengaturan > Tentang & lanjutan > Eksperimental, mati secara bawaan: "Peta offline di jam (uji lab)". Kalau dinyalakan, layar lab bisa memilih file peta `.bin` yang dibuat dari OpenStreetMap dengan alat `tools/offline-maps` di repositori, mengirimnya ke aplikasi peta offline di jam, lalu menampilkan apakah jam bisa membacanya; daftar dan hapus peta di jam juga ada.

**Kenapa orang peduli:** Jam Huawei dengan peta offline (mis. Watch Fit 4 Pro) hanya bisa mengunduh peta lewat Huawei Health. Ini menguji apakah peta dari data terbuka OpenStreetMap bisa dipakai di jam tanpa Huawei Health.

**Angle post:** (belum untuk diposting) Peta offline dari OpenStreetMap ke jam, tanpa akun Huawei: sedang diuji di lab.

**Bukti visual:** Belum ada. Setelah uji lab berhasil: foto peta Malang di jam pada dua tingkat zoom dan tangkapan layar lab dengan hasil "kode 0" (catatan di docs/offline-maps.md, "Lab").

**Jangan klaim:** Eksperimen, mati secara bawaan, hanya di build lab (belum di-merge, belum ada di build pengguna), belum terverifikasi di jam mana pun. Peta dibuat dari OpenStreetMap (© kontributor OpenStreetMap, ODbL), bukan peta Huawei/Petal; JoyoFit belum menyediakan unduhan peta di aplikasi. Jangan tulis 'tersedia di Play Store/App Store'. Tidak berafiliasi dengan Huawei.
