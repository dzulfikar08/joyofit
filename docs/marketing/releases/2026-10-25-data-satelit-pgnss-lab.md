---
app: joyofit
feature: Data satelit prediksi HW_PGNSS_PRED dari JoyoFit (uji lab, eksperimen)
shipped: 2026-10-25
available: code
tier: free
post: skip (eksperimen untuk uji lab di jam pemilik, belum terbukti di jam mana pun)
atur: JRG-413
---

**Apa:** Saklar eksperimen kedua di Pengaturan > Tentang & lanjutan > Eksperimental, terpisah dari saklar HW_AGNSS dan mati secara bawaan. Kalau dinyalakan dan jam meminta data satelit jenis HW_PGNSS_PRED (yang diminta Watch Fit 4 Pro saat pembaruan satelit dimulai dari jam), JoyoFit mengirim enam berkas prediksi orbit satelit untuk 3 hari ke depan, disusun seperti berkas Huawei Health tetapi dihitung server JoyoFit dari data publik, bukan dari Huawei. Baris "Data satelit" di tab Jam muncul untuk jam yang meminta jenis itu selama saklar menyala, dengan teks uji lab.

**Kenapa orang peduli:** Watch Fit 4 Pro memperingatkan data GNSS kedaluwarsa dan pembaruan satelit dari jam gagal tanpa Huawei Health. Ini langkah untuk menguji apakah data prediksi dari sumber terbuka bisa mengisi peran itu.

**Angle post:** (belum untuk diposting) Data satelit 3 hari untuk Watch Fit 4 Pro tanpa akun Huawei: sedang diuji di lab.

**Bukti visual:** Belum ada. Setelah uji lab berhasil: tangkapan layar baris Data satelit dengan status data prediksi eksperimen terkirim, layar pembaruan satelit di jam, plus waktu GPS menemukan posisi sebelum/sesudah (catatan di docs/agps.md, "HW_PGNSS_PRED lab runs").

**Jangan klaim:** Eksperimen, mati secara bawaan, belum terverifikasi di jam mana pun: jangan tulis bahwa GPS jadi lebih cepat, bahwa pembaruan satelit di jam berhasil, atau bahwa peringatan "data GNSS kedaluwarsa" hilang. Jam tidak memeriksa data ini dan menyimpannya berhari-hari; data yang salah pernah membuat GPS jam lain macet (pulih dengan reset pabrik). Bukan data Huawei dan tidak setara dengan data prediksi Huawei. Butuh versi aplikasi baru (perubahan native) dan server yang sudah di-deploy; belum ada di build mana pun. Jangan tulis 'tersedia di Play Store/App Store'. Tidak berafiliasi dengan Huawei.
