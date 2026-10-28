import type { Post } from "../types.ts";

export const panduanAwal: Post = {
  slug: "panduan-awal",
  title: "Panduan awal di JoyoFit: dari lepas jam sampai sinkron pertama",
  description:
    "Saat pertama dibuka, JoyoFit menuntun langkah awal: lepas jam dari aplikasi bawaannya, pairing, sinkron pertama, izin, dan masuk JoyoRogo. Bisa dilewati, bisa dilanjutkan, dan dibuka lagi dari Pengaturan.",
  date: "2026-10-18",
  tag: "Pasang",
  body: [
    {
      kind: "p",
      text: "Memasang jam ke JoyoFit punya urutan yang tidak boleh terbalik: jam harus dilepas dari Huawei Health dulu, baru dipasangkan. Panduan awal di aplikasi menjaga urutan itu.",
    },
    { kind: "h2", text: "Langkah-langkahnya" },
    {
      kind: "ol",
      items: [
        "Welcome: apa yang dicakup panduan, dan satu-satunya tempat untuk keluar dari panduan.",
        "Huawei Health: lepas jam (unbind). Ini juga kesempatan terakhir menyinkronkan jam sekali lagi di Huawei Health dan meminta ekspor datanya. Ekspor butuh berhari-hari, jadi minta sekarang dan impor kapan pun berkasnya tiba.",
        "Pair: pilih jam dari daftar, ketuk Connect, lalu setujui permintaan di layar jam.",
        "First sync: tarik riwayat pertama. Langkah ini membuktikan sambungannya jalan.",
        "Notifications, Apple Health atau Health Connect, dan Weather: izin opsional, yang paling berguna lebih dulu.",
        "Background (hanya Android): jaga jam tetap tersambung di latar belakang.",
        "JoyoRogo: masuk dengan akun JoyoRogo untuk cloud, Strava, dan Social.",
        "JoyoRogo Pro: informasi saja, tidak pernah menghalangi langkah berikutnya.",
        "JoyoRogo Cloud: cadangan semua workout beserta analisisnya (split, zona, best effort, training effect, VO2max, waktu pemulihan), bisa dilihat di joyorogo.com/jam dan dipulihkan di HP baru. Untuk akun Pro, bisa dilewati.",
        "Done: tips terakhir.",
      ],
    },
    { kind: "h2", text: "Bisa dilewati dan dilanjutkan" },
    {
      kind: "p",
      text: "Setiap langkah punya Continue atau Skip. Kalau aplikasi ditutup di tengah jalan, panduan lanjut dari langkah terakhir. Kamu bisa membukanya lagi kapan saja dari Settings, Setup guide. Kalau jam sudah terpasang saat dibuka ulang, langkah lepas jam tidak ditampilkan.",
    },
    {
      kind: "p",
      text: "Pengguna lama yang jamnya sudah terpasang tidak dipaksa melewati panduan ini.",
    },
    {
      kind: "note",
      text: "Yang sudah diuji: Huawei Watch Fit 4 Pro, Band 8, Band 11 Pro, dan Watch Fit 2. Jam Huawei dan Honor lain masih eksperimen, lihat [daftar jam](/jam).",
    },
  ],
  more: [
    { href: "/panduan", label: "Panduan lengkap pasang dan pakai" },
    { href: "/jam", label: "Jam yang didukung" },
  ],
};
