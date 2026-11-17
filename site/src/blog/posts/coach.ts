import type { Post } from "../types.ts";

export const coach: Post = {
  slug: "coach",
  title: "Coach di JoyoFit: saran harian, rencana lari dan latihan kekuatan, dan Tanya coach",
  description:
    "Fitur Pro: saran latihan harian dari pemulihanmu, rencana lari 5K, 10K, half marathon dan latihan kekuatan di rumah atau gym, perpustakaan gerakan, dan chat Tanya coach. Bukan saran medis.",
  date: "2026-10-18",
  tag: "Coach",
  body: [
    {
      kind: "p",
      text: "Coach membaca data jam-mu (kesiapan, HRV, tidur, beban latihan) dan memberi saran untuk hari ini, misalnya \"lari santai 30 menit, zona 2\" atau \"istirahat aktif\", lengkap dengan alasannya. Aturannya terbuka dan tidak memakai AI.",
    },
    { kind: "h2", text: "Yang ada di Coach" },
    {
      kind: "ul",
      items: [
        "Saran harian di layar Hari Ini, dengan alasan singkat dan tautan ke detailnya.",
        "Rencana lari: 5K, 10K, half marathon, dan lari rutin 3x seminggu. Kamu pilih tujuan, level, dan hari latihan.",
        "Rencana kekuatan full body 2 atau 3 kali seminggu, di rumah (tanpa alat) atau di gym.",
        "Penyesuaian tiap minggu dari sesi yang kamu selesaikan dan pemulihanmu. Sesi dicocokkan otomatis dengan latihan dari jam.",
        "Umpan balik di detail latihan: durasi, zona detak jantung, pace, dan jarak dibanding rencana.",
        "Perpustakaan sekitar 100 gerakan dengan langkah, otot, dan kesalahan umum.",
        "Tanya coach: chat tentang latihan, pemulihan, dan rencanamu, dengan konteks data jam dan catatan makanmu.",
      ],
    },
    { kind: "h2", text: "Jumlah ulangan dari jam" },
    {
      kind: "p",
      text: "Jam Huawei tidak melaporkan jumlah ulangan dari latihan kekuatan lewat protokol yang dipakai JoyoFit. Jadi ulangan dan beban dicatat manual di pencatat latihan.",
    },
    { kind: "h2", text: "Pro dan data" },
    {
      kind: "p",
      text: "Coach adalah fitur Joyo Pro. Rencanamu disimpan di akun JoyoRogo dan ikut ke ponsel lain. Pesan Tanya coach dan ringkasan datamu dikirim ke AI JoyoRogo untuk dijawab, dan tidak disimpan di server; obrolan hanya tersimpan di ponselmu.",
    },
    {
      kind: "note",
      text: "Coach bukan alat medis dan bukan saran medis. Kalau ada nyeri, pusing, atau cedera, berhenti dan temui dokter. Dalam mode Hamil, jawabannya lebih berhati-hati dan selalu menyarankan bertanya ke dokter atau bidan. Gambar gerakan dari wger.de (CC BY-SA), daftar lengkap di fit.joyorogo.com/exercises/ATTRIBUTION.txt.",
    },
  ],
  more: [{ href: "/panduan", label: "Panduan JoyoFit" }],
};
