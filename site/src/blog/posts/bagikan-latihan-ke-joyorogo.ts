import type { Post } from "../types.ts";

export const bagikanLatihan: Post = {
  slug: "bagikan-latihan-ke-joyorogo",
  title: "Bagikan latihan dari jam ke JoyoRogo",
  description:
    "Dari layar latihan di JoyoFit, ketuk Share to JoyoRogo untuk memposting latihan ke grup atau publik. Detak jantung dan rute ikut kalau kamu mau. Melihatnya di postingan orang lain butuh JoyoRogo Pro.",
  date: "2026-10-18",
  tag: "Social",
  body: [
    {
      kind: "p",
      text: "Latihan yang direkam jam Huawei-mu bisa langsung jadi postingan di JoyoRogo. Membagikannya gratis untuk semua orang.",
    },
    { kind: "h2", text: "Cara membagikan" },
    {
      kind: "ol",
      items: [
        "Masuk dengan akun JoyoRogo di JoyoFit.",
        "Buka latihan dari tab Workouts, lalu ketuk Share to JoyoRogo.",
        "Tulis caption kalau mau (sampai 1.000 karakter).",
        "Pilih siapa yang boleh melihat: Group (hanya orang yang satu grup JoyoRogo denganmu) atau Public (siapa saja di JoyoRogo, dan profil JoyoRogo-mu harus publik).",
        "Nyalakan atau matikan yang ikut terkirim: Heart-rate data, Route, dan Comparison with earlier workouts (sakelar yang datanya tidak ada tidak ditampilkan).",
        "Ketuk Post. Postingannya muncul di feed tab Social, dan View post membukanya.",
      ],
    },
    { kind: "p", text: "Latihan yang tidak layak dibagikan tidak menampilkan tombolnya sama sekali." },
    { kind: "h2", text: "Siapa yang bisa melihat detailnya" },
    {
      kind: "p",
      text: "Postingan selalu menampilkan angka ringkasnya. Grafik detak jantung dan rute di postingan orang lain adalah fitur JoyoRogo Pro, dan JoyoRogo yang menentukan siapa yang boleh melihatnya. Milikmu sendiri selalu bisa kamu lihat, dan membagikannya tetap gratis. Kalau kamu belum Pro, JoyoFit menampilkan kartu penjelasan di tempat grafiknya.",
    },
    {
      kind: "p",
      text: "Harga dan paket JoyoRogo Pro ada di [joyorogo.com/harga](https://joyorogo.com/harga).",
    },
    {
      kind: "note",
      text: "Kamu yang memilih apa yang ikut. Matikan Heart-rate data dan Route kalau hanya mau membagikan angka ringkas.",
    },
  ],
  more: [
    { href: "/blog/social-joyofit", label: "Tab Social di JoyoFit" },
    { href: "/panduan#social", label: "Panduan: Social dan berbagi" },
  ],
};
