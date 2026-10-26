import type { Post } from "../types.ts";

export const stravaFit: Post = {
  slug: "strava-file-fit",
  title: "Kirim olahraga jam Huawei ke Strava sebagai file FIT",
  description:
    "JoyoFit mengunggah setiap olahraga ke Strava sebagai file FIT berisi angka dari jam: jarak, waktu aktif, kalori, detak jantung, elevasi, kadensi, dan rute. Gratis selama slot masih ada; unggah manual selalu bisa.",
  date: "2026-10-18",
  tag: "Strava",
  body: [
    {
      kind: "p",
      text: "JoyoFit mengirim olahraga dari jam ke akun Strava-mu sebagai satu file FIT. Strava mempertahankan angka yang ada di file, jadi file itu membawa angka milik jam, bukan hitungan ulang.",
    },
    { kind: "h2", text: "Isi filenya" },
    {
      kind: "ul",
      items: [
        "Semua sampel dari awal sampai akhir olahraga: titik GPS dan sampel yang hanya berisi detak jantung. Waktu totalnya jadi waktu olahraga yang sebenarnya, bukan hanya bagian yang ada GPS-nya.",
        "Jarak kumulatif di setiap catatan, diskalakan supaya yang terakhir persis sama dengan jarak dari jam (jarak mentah GPS cenderung melenceng).",
        "Waktu aktif, kalori, detak jantung, kenaikan elevasi, dan kadensi dari langkah, dari ringkasan jam.",
        "Yang tidak diberikan jam tidak diisi. Tidak ada angka karangan.",
      ],
    },
    { kind: "h2", text: "Cara memakai" },
    {
      kind: "ol",
      items: [
        "Di JoyoFit buka Settings, Strava, ketuk Sign in with JoyoRogo, lalu Connect with Strava.",
        "Olahraga yang selesai setelah tersambung terkirim otomatis.",
        "Olahraga lama: buka layar olahraganya dan ketuk Send to Strava.",
        "Setelah terkirim, tautan View on Strava membuka aktivitasnya di Strava.",
      ],
    },
    { kind: "p", text: "Gratis selama slot masih ada, sama untuk semua pengguna; unggah manual selalu bisa." },
    {
      kind: "note",
      text: "Strava membatasi aplikasi kami di 10 atlet dan semua slotnya sedang terpakai. Review ke Strava sudah diajukan untuk menaikkan batas itu. Sampai disetujui, [masuk daftar tunggu Strava](/strava).",
    },
    {
      kind: "p",
      text: "Satu hal soal JoyoRogo: olahraga dari JoyoFit tidak dihitung dua kali di buku catatan makanmu. JoyoRogo mengambilnya dari Health Connect atau Apple Health (nyalakan ekspor di JoyoFit), dan melewati aktivitas Strava yang berasal dari JoyoFit.",
    },
  ],
  more: [
    { href: "/strava", label: "Daftar tunggu Strava" },
    { href: "/panduan#fitur", label: "Panduan: sinkron, Strava, impor riwayat" },
  ],
};
