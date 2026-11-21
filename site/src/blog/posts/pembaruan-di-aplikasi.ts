import type { Post } from "../types.ts";

export const pembaruan: Post = {
  slug: "pembaruan-di-aplikasi",
  title: "Pembaruan di dalam aplikasi untuk JoyoFit dari Google Play",
  description:
    "JoyoFit dari Google Play sekarang memberi tahu kalau ada versi baru: ketuk Update, unduh di latar belakang, lalu Restart to update. Ada juga animasi kecil di skor dan grafik.",
  date: "2026-10-18",
  tag: "Aplikasi",
  body: [
    {
      kind: "p",
      text: "Kalau JoyoFit terpasang dari Google Play, aplikasi menampilkan banner New version available saat ada build yang lebih baru di jalur testmu.",
    },
    { kind: "h2", text: "Cara kerjanya" },
    {
      kind: "ol",
      items: [
        "Aplikasi mengecek saat dibuka dan saat kembali ke layar depan, paling sering sekali tiap 6 jam.",
        "Ketuk Update. Google Play menampilkan dialog konfirmasinya sendiri, lalu mengunduh di latar belakang dengan bar progres di banner.",
        "Setelah selesai, banner berubah jadi Restart to update. Ketuk, dan aplikasi terbuka lagi di versi baru.",
        "Ketuk Later kalau belum mau. Banner tidak muncul lagi selama 24 jam.",
      ],
    },
    {
      kind: "note",
      text: "Hanya untuk pemasangan dari Google Play. Di iPhone, App Store sudah memberi tahu sendiri. Build sendiri dari kode sumber tidak punya pemberitahuan ini.",
    },
    { kind: "h2", text: "Animasi kecil" },
    {
      kind: "p",
      text: "Angka di cincin skor menghitung naik, grafik detak jantung tergambar dari kiri, centang sinkron muncul saat sinkron selesai, dan kudos di Social memantul sebentar. Panduan awal dan lembar berbagi juga memberi respons kecil saat kamu mengetuk.",
    },
  ],
  more: [
    { href: "/panduan#pasang", label: "Panduan: pasang JoyoFit" },
    { href: "/blog/panduan-awal", label: "Panduan awal di aplikasi" },
  ],
};
