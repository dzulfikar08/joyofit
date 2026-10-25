---
app: joyofit
feature: Termometer kamar: Xiaomi bawaan dan status untuk tidur
shipped: 2026-10-22
available: test-build
tier: free
post: todo
atur: JRG-385
---

**Apa:** Termometer Xiaomi LYWSD03MMC (dan sejenisnya) yang masih memakai firmware bawaan kini bisa dibaca JoyoFit tanpa memasang firmware komunitas: lewat bindkey (membaca siaran terenkripsi tanpa menyambung) atau lewat sambungan singkat tiap 10 menit. Layar Termometer kamar juga menulis status tiap angka untuk tidur ("Agak hangat untuk tidur", "Pas", "Terlalu lembap") dengan rentang idealnya (18–25 °C, 30–50% RH), dan detail tidur di JoyoFit menampilkan rata-rata suhu dan kelembapan kamar malam itu beserta terendah dan tertingginya.

**Kenapa orang peduli:** Tidak perlu membongkar termometer atau mem-flash firmware untuk memasukkan suhu kamar ke ringkasan tidur. Suhu kamar tidak lagi hanya ikut ke JoyoRogo: kamu langsung melihatnya di samping tidurmu sendiri.

**Angle post:** Termometer Xiaomi murahmu sudah cukup buat suhu kamar di JoyoFit. Tanpa flash firmware. Dan sekarang kamu bisa lihat kamarmu semalam: berapa derajat, berapa lembap, dan pas atau tidak untuk tidur.

**Bukti visual:** Setelah rilis: kartu "Belum bisa dibaca" dengan dua tombol (Hubungkan langsung, Pakai bindkey), kartu termometer dengan pembacaan dan statusnya, dan detail tidur satu malam dengan baris "Kamar" (butuh minimal 6 pembacaan yang meliputi separuh waktu tidur).

**Jangan klaim:** Belum rilis, jangan diposting; belum diuji pada unit stok. Bindkey harus diambil sendiri (Xiaomi Cloud Tokens Extractor atau Telink Flasher, yang melepas termometer dari Mi Home). Sambungan langsung hanya jalan saat aplikasi terbuka; pemantauan semalaman hanya lewat bindkey dan butuh aplikasi dari toko. Jangan tulis 'tersedia di Play Store/App Store'. Rentang ideal adalah rentang umum dari Sleep Foundation, EPA, dan studi suhu tidur (sumber di docs/sleep-insights.md), bukan saran medis; jangan klaim suhu atau kelembapan tertentu memperbaiki tidur. Kamar di Indonesia sering di atas rentang itu; jangan dibuat ceramah atau jadi klaim bahwa tidurmu buruk. Baris kamar di detail tidur hanya muncul untuk malam yang pembacaannya cukup, bukan untuk tidur siang.
