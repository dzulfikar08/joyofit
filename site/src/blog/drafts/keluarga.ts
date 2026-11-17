import type { Post } from "../types.ts";

/** DRAFT. Not imported by the app. Publish with the steps at the top of ../index.ts when Keluarga ships in a store build. */
export const keluarga: Post = {
  slug: "keluarga",
  title: "Keluarga: kabar harian dari jam orang tuamu, dengan izin mereka",
  description:
    "Fitur Keluarga di JoyoFit menampilkan beberapa angka harian dari jam orang tuamu dan memberi tahu kalau tidak ada sinkron. Mereka yang memilih apa yang dibagikan. Bukan pantauan langsung dan bukan alat darurat.",
  date: "2026-10-18",
  tag: "Keluarga",
  body: [
    {
      kind: "p",
      text: "Keluarga membantumu tahu kabar orang tua yang memakai jam Huawei, tanpa harus menelepon tiap kali. Ini bukan pantauan langsung dan bukan alat darurat.",
    },
    {
      kind: "note",
      text: "Data baru masuk setelah jam tersinkron ke ponsel dan ponselnya terhubung internet, jadi bisa telat dari beberapa menit sampai berjam-jam. JoyoFit tidak mendeteksi jatuh, serangan jantung, atau kondisi gawat. Kalau kamu khawatir, telepon langsung atau hubungi layanan darurat (112).",
    },
    { kind: "h2", text: "Yang dilihat" },
    {
      kind: "ul",
      items: [
        "Kapan jam terakhir tersambung dan baterai jam.",
        "Langkah harian.",
        "Tidur semalam.",
        "Detak jantung saat istirahat.",
        "Kadar oksigen (SpO2) menurut jam, hanya kalau orang yang dipantau mengizinkan.",
      ],
    },
    {
      kind: "p",
      text: "Tidak pernah dibagikan: lokasi, rute olahraga, detak jantung per menit, makanan, dan foto.",
    },
    { kind: "h2", text: "Yang memutuskan adalah orang yang dipantau" },
    {
      kind: "ul",
      items: [
        "Undangan lewat tautan dan kode sekali pakai. Tidak ada yang terkirim sebelum orang yang dipantau menyetujui.",
        "Setiap kategori punya sakelarnya sendiri, semuanya mati sampai dinyalakan.",
        "Bisa dijeda atau dihentikan kapan saja. Kalau dihentikan, yang memantau langsung tidak bisa melihat apa pun dan riwayatnya dihapus.",
        "Ada daftar siapa yang memantau, kapan terakhir melihat, dan tombol untuk melihat data persis yang terkirim. Tidak ada mode diam-diam.",
      ],
    },
    { kind: "h2", text: "Pemberitahuan" },
    {
      kind: "p",
      text: "Yang gratis: pemberitahuan kalau tidak ada sinkron dalam waktu yang kamu atur, supaya kamu tahu ponsel atau jamnya diam. Joyo Pro menambah aturan lain (misalnya detak istirahat yang lebih tinggi dari biasanya, belum ada langkah sampai siang, tidur sangat pendek), memantau lebih dari satu orang, dan riwayat lebih panjang. Bahasanya netral dan bukan diagnosis.",
    },
  ],
  more: [
    { href: "/privasi#keluarga", label: "Privasi: pantau keluarga" },
    { href: "/panduan", label: "Panduan pasang dan pakai" },
  ],
  verify: [
    "WAJIB tetap ada: kalimat 'bukan pantauan langsung', 'bukan alat darurat', dan 112. Salin dari DISCLAIMER di src/Keluarga.tsx, jangan dilonggarkan.",
    "Daftar 'Yang dilihat' dan 'Tidak pernah dibagikan' harus sama dengan SHARED dan NEVER_SHARED di src/Keluarga.tsx dan dengan layar persetujuan di build toko.",
    "Batas Gratis vs Pro (1 orang vs sampai 5, 30 vs 90 hari, aturan mana yang gratis) diambil dari docs/family-monitoring.md bagian 6; cocokkan dengan build dan dengan harga di joyorogo.com/harga.",
    "Pemberitahuan butuh push (FCM/APNs) yang bekerja; HP Huawei tanpa layanan Google tidak dapat push. Sebut batas ini kalau masih berlaku.",
    "iOS: pengunggahan di latar belakang best effort. Sebut kalau masih berlaku.",
    "Cek /privasi (bagian keluarga) dan deskripsi toko tetap sesuai dengan tulisan ini. Halaman undangan /keluarga sudah ada di situs dan memuat kata 'bukan pantauan langsung'.",
    "Perbarui date ke tanggal rilis, hapus verify.",
    "Butuh screenshot baru: kartu Keluarga di Today, layar persetujuan, daftar yang memantau.",
  ],
};
