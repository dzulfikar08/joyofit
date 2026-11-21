import type { Post } from "../types.ts";

export const joyofitWeb: Post = {
  slug: "joyofit-web",
  title: "JoyoFit Web: analisis latihan di browser",
  description:
    "JoyoFit Web membuka datamu di app.fit.joyorogo.com untuk pemegang Joyo Pro: ringkasan, daftar dan detail latihan dengan peta, tidur dan pemulihan, unggah file, dan koneksi AI. Ditambah Studio untuk merancang tampilan jam, gratis.",
  date: "2026-10-19",
  tag: "JoyoFit Web",
  body: [
    {
      kind: "p",
      text: "Aplikasi JoyoFit ada di HP-mu, dan itu tempat terbaik untuk sinkron dari jam. Tapi membaca grafik latihan di layar kecil kadang sempit. JoyoFit Web adalah versi browser untuk menganalisis datamu di layar yang lebih lebar, di [app.fit.joyorogo.com](https://app.fit.joyorogo.com).",
    },
    { kind: "h2", text: "Untuk siapa" },
    {
      kind: "p",
      text: "JoyoFit Web adalah fitur [Joyo Pro](https://joyorogo.com/harga). Kamu masuk dengan akun JoyoRogo yang sama dengan di aplikasi JoyoFit, jadi tidak perlu akun baru. Tanpa Pro, kamu tetap bisa memakai semua yang ada di aplikasi di HP, serta Studio dan Ride di bawah ini yang gratis.",
    },
    { kind: "h2", text: "Isinya" },
    {
      kind: "ul",
      items: [
        "Ringkasan: beban latihan, pemulihan, HRV, detak jantung istirahat, VO2max, dan tidur dalam satu halaman.",
        "Latihan: daftar semua latihanmu. Buka satu latihan untuk melihat detailnya, dengan peta rute dan grafik yang disinkronkan satu sama lain.",
        "Tidur dan pemulihan: tahap tidur dari semalam dan tren pemulihanmu dari hari ke hari.",
        "Unggah: impor file .fit, .gpx, dan .tcx dari perangkat atau aplikasi lain. Di halaman ini juga ada perpustakaan tampilan jam; tampilan .hwt yang kamu unggah muncul di aplikasi, di Watch faces, tab Koleksi, bagian Dari web, dan bisa dipasang ke jam dari sana.",
        "Koneksi: sambungkan aplikasi AI lewat MCP supaya bisa membaca datamu, buka chat coach, dan ekspor latihan sebagai GPX, FIT, atau JSON.",
      ],
    },
    { kind: "h2", text: "Data dan privasi" },
    {
      kind: "p",
      text: "JoyoFit Web membaca data yang sudah tersimpan di akun JoyoRogo-mu. Datanya tetap di akun itu. Aplikasi AI hanya tersambung ke datamu kalau kamu sendiri yang menyambungkannya lewat Koneksi. Ekspor GPX, FIT, dan JSON memberimu salinan yang bisa kamu simpan sendiri.",
    },
    { kind: "h2", text: "Cara masuk" },
    {
      kind: "ol",
      items: [
        "Pastikan kamu punya Joyo Pro dan sudah masuk dengan akun JoyoRogo di aplikasi JoyoFit.",
        "Buka [app.fit.joyorogo.com](https://app.fit.joyorogo.com) di browser laptop atau HP.",
        "Masuk dengan akun JoyoRogo yang sama. Latihan yang sudah tersimpan di akunmu langsung bisa dibuka.",
      ],
    },
    { kind: "h2", text: "Studio dan Ride, tanpa Pro" },
    {
      kind: "p",
      text: "Dua hal lain di host yang sama tidak butuh Pro. [JoyoFit Studio](https://app.fit.joyorogo.com/studio/) adalah editor untuk merancang tampilan jam Huawei Watch Fit 4 dan Fit 4 Pro. Kamu mengekspornya sebagai gambar 408 × 480 (photo face), lalu memilihnya di JoyoFit lewat Watch, Photo face. Photo face hanya gambar: jam tetap menggambar sendiri waktu dan datanya di atasnya. Editor ini juga punya ekspor .hwt untuk alat resmi Huawei, tetapi jam menghapus .hwt yang tidak ditandatangani Huawei, jadi photo face yang berfungsi untuk JoyoFit.",
    },
    {
      kind: "p",
      text: "Yang kedua adalah [JoyoFit Ride](/blog/joyofit-ride), permainan sepeda virtual di browser yang juga bisa dibuka di [app.fit.joyorogo.com/ride](https://app.fit.joyorogo.com/ride).",
    },
    {
      kind: "note",
      text: "Angka kebugaran seperti pemulihan, beban, dan VO2max adalah perkiraan dari data jam, bukan hasil pemeriksaan medis. Kalau ada keluhan, temui dokter.",
    },
  ],
  more: [
    { href: "/#web", label: "JoyoFit Web di beranda" },
    { href: "/blog/joyofit-ride", label: "JoyoFit Ride" },
    { href: "https://joyorogo.com/harga", label: "Harga Joyo Pro" },
  ],
};
