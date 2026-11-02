---
app: joyofit
feature: Overlay angka latihan (Pita, Kolom, Lintasan, Jalur, Lengkung)
shipped: 2026-11-02
available: code
tier: free
post: todo
atur: JRG-478
---

**Apa:** Lima overlay baru untuk dibagikan: hanya angka dan garis, tanpa latar, supaya ditaruh di atas fotomu sendiri (Story 9:16 atau Persegi 1:1). Pita: durasi raksasa di atas, dua pita warna menyilang membawa pace (atau kecepatan) dan jarak, plus garis rute. Kolom: deretan label kecil dan angka besar di tepi kanan (jarak, durasi, pace atau kecepatan, detak jantung, kadensi), rute kecil di kiri bawah dan tulisan JoyoFit berdiri di kiri atas. Lintasan: lintasan atletik dari lima garis tipis mengelilingi jarak, durasi dan pace di sudut bawah. Jalur: garis lintasan menikung dari kanan, jarak besar di kiri atas. Lengkung: pita warna tebal melengkung di belakang jarak, dengan garis rute. Angkanya mengikuti olahraga: kilometer untuk lari, jalan, dan sepeda (kecepatan, bukan pace), meter dan pace per 100 m untuk renang, dan kalau latihannya tidak punya jarak (angkat beban, yoga, HIIT) durasi yang jadi angka besar, dengan kalori dan detak jantung di sebelahnya. Bahasa kartu ikut bahasa aplikasi (Jarak, Durasi dalam bahasa Indonesia).

**Kenapa orang peduli:** Foto latihan yang bagus tidak perlu ditutup kartu penuh. Cukup angka dan garis di atas foto sendiri, untuk lari, sepeda, renang, jalan, dan gym.

**Angle post:** "Fotomu, angkamu. Lima overlay baru di JoyoFit: pita menyilang, kolom angka, lintasan atletik, jalur, dan lengkung. Satu warna aksen, tanpa kartu yang menutupi foto. Buat lari, sepeda, renang, jalan, sampai gym."

**Bukti visual:** lembar kontak di `docs/screenshots/share-overlays/` (overlays-story-dark-dusk.png, overlays-story-light-day.png, overlays-square-dark-dusk.png, overlays-square-light-day.png: lima olahraga di foto contoh). Dari aplikasi: detail latihan, tombol bagikan, pilih salah satu overlay di daftar stiker. Render ulang: `bun scripts/stickers-sheet.ts --only run.tape.story,run.column.story,run.track.story,run.lanes.story,run.swoosh.story --fixtures run.full,ride.outdoor,swim.pool,walk.hike,gym.watch --on dusk --mode dark`.

**Jangan klaim:** hasil ekspornya PNG transparan (tanpa foto di dalamnya); warna aksen belum bisa dipilih; angka mengikuti yang dimiliki jam, yang tidak ada tidak ditampilkan; pace, kalori, dan detak jantung adalah perkiraan, bukan alat medis; rute memotong 200 m awal dan akhir secara default; belum ada di build mana pun sampai dirilis lewat OTA; tidak ada logo Huawei, Honor, Strava, atau Health.
