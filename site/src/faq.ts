import { IOS_TESTFLIGHT_LIVE, STRAVA_PATH, TIMBANGAN_PATH } from "./lib.ts";

/** A tracking goal for the link at the end of an answer. */
export type FaqLink = { href: string; label: string; goal?: { name: string; location: string } };

export type FaqItem = { q: string; a: string; link?: FaqLink };

/**
 * The landing-page FAQ as plain text. The page renders it and the FAQPage
 * JSON-LD is built from the same entries, so the two cannot drift apart.
 */
export const FAQ: readonly FaqItem[] = [
  {
    q: "Apakah JoyoFit bisa menggantikan Huawei Health?",
    a: "JoyoFit adalah aplikasi open source (AGPL-3.0) yang bicara langsung ke jam Huawei lewat Bluetooth dan menyimpan langkah, detak jantung, tidur, SpO2, dan olahraga di HP-mu, jadi Huawei Health tidak perlu terpasang. Yang sudah diuji: Huawei Watch Fit 4 Pro, Band 8, Band 11 Pro, dan Watch Fit 2; jam lain masih eksperimen.",
  },
  {
    q: "Apakah saya perlu akun Huawei?",
    a: "Tidak. JoyoFit bicara langsung ke jam lewat Bluetooth. Yang perlu kamu lakukan: lepaskan jam dari Huawei Health dulu, karena jam hanya bisa terpasang ke satu aplikasi dalam satu waktu.",
  },
  {
    q: "Jam apa saja yang didukung?",
    a:
      "Yang sudah diuji: Huawei Watch Fit 4 Pro, Band 8, Band 11 Pro, dan Watch Fit 2. Jam dan band Huawei dan Honor lain di daftar Gadgetbridge (Bluetooth Classic maupun Bluetooth LE) masih eksperimen: jalurnya ada, tapi belum pernah dicoba dengan JoyoFit. Honor Watch 5, 5 Pro, dan 6 belum bisa. Di Android, pemindai di aplikasi sekarang juga menemukan band yang tidak muncul di pengaturan Bluetooth (Band 8, 9, 10, dan Fit), dan memberi pesan yang jelas kalau jam sedang dipegang HP lain. Daftar lengkapnya ada di halaman Jam yang didukung, dan kamu bisa membantu jam-mu masuk daftar uji di halaman Dukung jam. Aplikasinya untuk Android 10 ke atas, dan untuk iPhone dengan iOS 16.4 ke atas." +
      (IOS_TESTFLIGHT_LIVE
        ? " Versi iPhone ada sebagai beta publik lewat TestFlight, dan versi App Store 1.0 sedang menunggu review Apple. Baru diuji dengan Huawei Watch Fit 4 Pro."
        : ""),
  },
  {
    q: "Timbangan Bluetooth apa yang bisa dipakai?",
    a: "JoyoFit membaca timbangan badan lewat protokol openScale: timbangan Bluetooth standar (Weight Scale dan Body Composition, misalnya Beurer, Sanitas, A&D) dan protokol beberapa merek seperti Xiaomi Mi Scale, Renpho dan QN, Fitdays dan AiLink, OKOK dan Chipsea, Yunmai, 1byone, Eufy, Etekcity, Inlife, Senssun, Excelvan, Hesley, Exingtech, dan timbangan Tuya yang menyiarkan berat lewat Bluetooth. Satu jenis sudah kami coba di timbangan asli, yaitu timbangan Tuya HAN RIVER HRTZC01 yang hanya mengirim berat dan perlu local key dari platform pengembang Tuya; yang lain belum diuji langsung. Timbangan yang belum dikenali bisa direkam lewat Rekam data timbangan supaya dukungannya ditambahkan. Berat dan komposisi tubuh ikut masuk ke catatan berat badan JoyoRogo kalau kamu masuk dengan akunnya, dan kalau timbangannya dipakai serumah, berat yang jauh beda dari timbangan terakhirmu ditanyakan dulu.",
    link: { href: TIMBANGAN_PATH, label: "Lihat daftar timbangan", goal: { name: "timbangan_click", location: "faq" } },
  },
  {
    q: "Bisa dipakai tanpa jam?",
    a: "Bisa. Pencatat latihan beban, rutinitas, perpustakaan gerakan, riwayat, dan upload ke Strava jalan dari HP saja, dan panduan awal punya jalur tanpa jam. Kalori latihan beban diperkirakan dari jumlah set dengan metode MET. Coach (JoyoRogo Pro) memakai jawabanmu atas badan terasa bagaimana hari ini sebagai pengganti data kesiapan dari jam.",
  },
  {
    q: "Apa yang gratis dan apa yang JoyoRogo Pro?",
    a: "Sinkron jam, skor, analisis latihan, pencatat latihan beban, Strava (selama slot masih ada), perlengkapan, dan membagikan latihan ke Social gratis. JoyoRogo Pro dipakai untuk Coach (saran harian, rencana lari dan beban, Tanya coach) dan salinan cloud untuk olahraga, riwayat beban, perlengkapan, dan rencana Coach. Pelanggan Pro juga dapat dukungan prioritas: laporan dan permintaan fitur mereka didahulukan.",
  },
  {
    q: "Kapan dukungan lebih dari satu jam dan sensor Bluetooth rilis?",
    a: "Belum ada tanggal. Keduanya, plus data bersepeda kelas pro, sudah dikerjakan di cabang pengembangan dan dicatat di bagian Roadmap. Kami menandainya Segera hadir sampai ada di aplikasi yang bisa kamu pasang.",
    link: { href: "/#roadmap", label: "Lihat roadmap" },
  },
  {
    q: "Bisa dipakai di iPhone?",
    a: "Bisa, sebagai beta publik lewat TestFlight; versi App Store 1.0 sedang menunggu review Apple, jadi belum ada di App Store. Baru diuji dengan Huawei Watch Fit 4 Pro, dan beberapa fitur iPhone masih baru diuji di komputer.",
    link: { href: "/iphone", label: "Lihat cara pasang di iPhone", goal: { name: "iphone_waitlist_click", location: "faq" } },
  },
  {
    q: "Apa bedanya dengan Gadgetbridge?",
    a: "Protokol jam Huawei di JoyoFit adalah port dari Gadgetbridge (AGPL-3.0), dan daftar jam yang bisa dicoba mengikuti daftar Gadgetbridge. JoyoFit adalah turunannya, bukan Gadgetbridge itu sendiri: aplikasinya menambahkan layar harian, olahraga langsung, ekspor ke Health Connect dan Strava, cloud opsional, dan versi iPhone.",
  },
  {
    q: "Sudah stabil dipakai?",
    a: "Protokol jamnya porting dari Gadgetbridge. Tapi sebagian fitur, seperti kustomisasi tampilan jam, kartu kalori, dan latihan lari terjadwal, masih ditandai belum terverifikasi di Fit 4 di dokumentasi proyek. Kami jujur soal itu; log lengkapnya ada di Pengaturan.",
  },
  {
    q: "Ke mana data saya pergi?",
    a: "Ke database lokal di HP. Dua pengecualian, dan keduanya hanya jika kamu menyalakannya: cuaca ke Open-Meteo (hanya koordinat yang dibulatkan sekitar 1 km), dan cloud JoyoFit setelah kamu masuk dengan akun JoyoRogo.",
  },
  {
    q: "Apa yang diunggah ke cloud?",
    a: "Sampel langkah, segmen tidur, dan data perangkat untuk akun yang masuk. Untuk akun JoyoRogo Pro, setiap olahraga juga diunggah sebagai satu berkas terkompresi berisi ringkasan, rute GPS, detak jantung, ketinggian, kecepatan, kadensi, panjang langkah, daya, dan analisisnya; akun Gratis tidak mengunggah olahraga. Setelah masuk di HP baru, olahraga dipulihkan dari cloud dan juga tampil di joyorogo.com. Unggahan bisa dibatasi hanya lewat Wi-Fi. Profil, alarm, dan pengaturan tidak disinkronkan.",
  },
  {
    q: "Bisa dipakai tanpa cloud sama sekali?",
    a: "Bisa. Cloud opsional. Tanpa itu semua fitur jam tetap jalan dan data tetap di HP-mu.",
  },
  {
    q: "Bisa mengirim olahraga ke Strava?",
    a: "Bisa, gratis. JoyoFit mengunggah olahraga sebagai file FIT berisi angka dari jam: jarak, waktu aktif, kalori, detak jantung, elevasi, kadensi, dan rute. Strava membatasi aplikasi kami di 10 atlet dan semua slotnya sedang terpakai; kami sudah mengajukan review ke Strava untuk menaikkan batas itu. Sampai disetujui, kamu bisa masuk daftar tunggu. Daftarnya sama untuk JoyoFit dan JoyoRogo, karena keduanya memakai satu aplikasi Strava.",
    link: { href: STRAVA_PATH, label: "Masuk daftar tunggu Strava", goal: { name: "strava_waitlist_click", location: "faq" } },
  },
  {
    q: "Apa itu tab Social?",
    a: "Tab Social menampilkan feed JoyoRogo di dalam JoyoFit: latihan dan makanan dari orang yang kamu ikuti dan dari grupmu. Kamu bisa gabung grup dengan kode undangan, membuka profil, memberi kudos, dan berkomentar. Latihan dari jam dibagikan dengan Share to JoyoRogo di layar latihannya. Perlu masuk dengan akun JoyoRogo. Grafik detak jantung dan rute di postingan orang lain butuh JoyoRogo Pro; melihat dan membagikan milikmu sendiri gratis.",
    link: { href: "/blog/social-joyofit", label: "Baca soal tab Social" },
  },
  {
    q: "Apa hubungannya dengan JoyoRogo?",
    a: "JoyoRogo adalah aplikasi catatan makan kami. Asupan kalori dari JoyoRogo bisa tampil di kartu kalori jam, skor Recovery dan Strain JoyoFit ikut tampil di catatan makan JoyoRogo, dan masuk ke cloud JoyoFit memakai akun JoyoRogo. JoyoFit tetap bisa dipakai sendiri tanpa JoyoRogo.",
  },
  {
    q: "Jam bilang data GNSS kedaluwarsa saat mulai olahraga luar ruangan. Rusak?",
    a: "Tidak, itu wajar. GPS tetap jalan, cuma butuh 30–60 detik di luar ruangan. Tunggu ikon GPS di jam sebelum mulai. Pesan itu dari firmware jam dan tidak bisa kami ubah: data bantuan GPS jam Huawei hanya bisa datang dari Huawei Health. JoyoFit mengirim lokasi dan waktu HP-mu untuk membantu titik GPS pertama. Jamnya tidak rusak.",
  },
  {
    q: "Watch face apa yang bisa dipasang dari JoyoFit?",
    a: "Photo face jalan: kamu memilih fotomu sendiri dan jam menggambar waktu serta datanya di atasnya. Face bawaan bisa dikustomisasi. Face buatan sendiri atau dari luar (berkas .hwt) yang tidak ditandatangani Huawei ditolak jam dan JoyoFit tidak bisa menandatanganinya, jadi pasang lewat Huawei Health dengan HUAWEI ID yang punya izin designer. Langkahnya ada di panduan, tapi belum dibuktikan pengguna di firmware terbaru.",
    link: { href: "/panduan", label: "Buka panduan dan FAQ" },
  },
  {
    q: "Fitur baru apa saja yang sudah ada di aplikasi, dan mana yang menyusul?",
    a: "Sudah ada lewat pembaruan langsung: bilah tab Hari ini, Latihan, tombol Mulai, Social, Lainnya; layar rekam dengan peta; ekspor file FIT dan GPX; 17 tema termasuk enam pastel dan batik Sogan; post ke JoyoRogo dengan lembar profil; pesan yang jelas untuk watch face yang tidak ditandatangani Huawei; petunjuk GNSS; dan photo face. Menyusul di build toko berikutnya, sekarang baru di tes internal: bahasa jam ikut bahasa aplikasi, rute GPS ke Health Connect, mulai latihan beban dari HP di jam, balasan pintar dan balasan cepat di jam. Rilis Play produksi dan App Store belum terbuka untuk umum, jadi build toko itu belum bisa kamu pasang sendiri.",
    link: { href: "/#baru", label: "Lihat yang baru" },
  },
];
