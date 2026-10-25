---
app: joyofit
feature: Data satelit HW_AGNSS dari JoyoFit (uji lab, eksperimen)
shipped: 2026-10-25
available: code
tier: free
post: skip (eksperimen untuk uji lab di jam pemilik, belum terbukti di jam mana pun)
atur: JRG-411
---

**Apa:** Saklar eksperimen baru di Pengaturan > Tentang & lanjutan > Eksperimental, mati secara bawaan. Kalau dinyalakan dan jam meminta data satelit jenis HW_AGNSS, JoyoFit mengirim berkas `HW_AGNSS_RTCM_33` yang dibuat server JoyoFit dari data siaran satelit publik (IGS/BKG), bukan dari Huawei. Baris "Data satelit" di tab Jam muncul untuk jam yang meminta jenis itu selama saklar menyala, dengan teks uji lab.

**Kenapa orang peduli:** Jam Huawei memperingatkan data GNSS kedaluwarsa dan GPS-nya lama menemukan posisi tanpa Huawei Health. Ini langkah pertama untuk menguji apakah data terbuka bisa mengisi sebagian peran itu.

**Angle post:** (belum untuk diposting) Data satelit dari sumber terbuka, tanpa akun Huawei: sedang diuji di lab.

**Bukti visual:** Belum ada. Setelah uji lab berhasil: tangkapan layar baris Data satelit dengan status data eksperimen terkirim, plus waktu GPS menemukan posisi sebelum/sesudah (catatan di docs/agps.md, "HW_AGNSS lab runs").

**Jangan klaim:** Eksperimen, mati secara bawaan, belum terverifikasi di jam mana pun (Watch Fit 4 Pro maupun Band 11 Pro): jangan tulis bahwa GPS jadi lebih cepat atau peringatan "data GNSS kedaluwarsa" hilang. Jam tidak memeriksa data ini; data yang salah pernah membuat GPS jam lain macet (pulih dengan reset pabrik). Tidak menggantikan data prediksi Huawei (`HW_PGNSS_PRED`) yang diminta Watch Fit 4 Pro. Butuh versi aplikasi baru (perubahan native) dan server yang sudah di-deploy; belum ada di build mana pun. Jangan tulis 'tersedia di Play Store/App Store'. Tidak berafiliasi dengan Huawei.
