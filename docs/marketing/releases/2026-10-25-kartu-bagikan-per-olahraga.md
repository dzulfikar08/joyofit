---
app: joyofit
feature: Kartu bagikan per jenis olahraga
shipped: 2026-10-25
available: test-build
tier: free
post: todo
atur: JRG-424
---

**Apa:** Kartu dan stiker untuk membagikan latihan sekarang mengikuti jenis olahraganya. Gym, kardio/HIIT, yoga, renang,
gowes, jalan/hiking dan olahraga lapangan (badminton, futsal, tenis) punya kartu sendiri dengan angka yang memang ada untuk
olahraga itu, dan lembar bagikan langsung terbuka di kartu yang cocok. Kartu lari yang lama tetap bisa dipilih, dan angka
yang tidak masuk akal (pace di sesi gym, kilometer di kelas yoga, kecepatan di badminton) tidak lagi muncul di kartu mana pun.

**Kenapa orang peduli:** Dulu sesi gym dari jam tampil sebagai "0,64 km" dengan kecepatan 0,7 km/j, renang tanpa lap dan
SWOLF, gowes tanpa daya, dan struknya bilang "Makasih sudah lari" untuk semua olahraga. Sekarang gym menonjolkan durasi (atau
volume dari log angkat beban), set, kalori dan zona detak jantung; renang menonjolkan meter, pace per 100 m, lap dan SWOLF;
gowes menonjolkan jarak, kecepatan, elevasi, daya dan kadensi.

**Angle post:** "Habis nge-gym, kartu share kamu masih bilang 0,64 km? Sekarang tiap olahraga punya kartunya sendiri."

**Bukti visual:** `docs/screenshots/share-per-sport/` (contact sheet per keluarga olahraga, gelap dan terang). Di HP: buka
latihan gym, renang atau yoga dari jam, ketuk Bagikan.

**Jangan klaim:** Baru ada di build uji internal (`available: test-build`), belum di toko. Set, repetisi dan volume hanya muncul kalau sesi
jam digabung dengan log angkat beban di JoyoFit; jam tidak mencatatnya sendiri. Lap, ayunan dan SWOLF hanya kalau jam
mengirimnya. Angka kalori dan detak adalah perkiraan, bukan alat medis. Tidak berafiliasi dengan Huawei; jangan bandingkan
dengan aplikasi atau kartu share merek lain.
