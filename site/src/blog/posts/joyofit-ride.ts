import type { Post } from "../types.ts";

export const joyofitRide: Post = {
  slug: "joyofit-ride",
  title: "JoyoFit Ride: main sepeda virtual di web",
  description:
    "JoyoFit Ride adalah sepedaan indoor 3D di browser, gratis. Kadens dari sensor lewat HP menggerakkan pesepeda di rute Pantai, Bukit, Kebun, dan Bromo, dengan mode bebas, interval, tantangan harian, medali, dan papan peringkat.",
  date: "2026-10-19",
  tag: "Ride",
  body: [
    {
      kind: "p",
      text: "JoyoFit Ride adalah permainan sepeda indoor di browser. Kamu mengayuh sepeda statis atau sepeda di rol, sensor kadens membaca putaran pedalmu, dan pesepeda 3D di layar bergerak sesuai kayuhanmu. Layarnya besar, sensornya dari HP. Buka di [fit.joyorogo.com/ride](/ride) atau [app.fit.joyorogo.com/ride](https://app.fit.joyorogo.com/ride). Gratis, tanpa Joyo Pro.",
    },
    { kind: "h2", text: "Yang kamu butuhkan" },
    {
      kind: "ul",
      items: [
        "Sepeda statis, atau sepeda di rol, dengan sensor kadens Bluetooth. Kalau kamu punya sensor detak jantung, detak jantungmu ikut tampil di layar.",
        "HP dengan aplikasi JoyoFit, sebagai jembatan: HP membaca sensor Bluetooth-mu dan meneruskannya ke browser.",
        "Browser di laptop, tablet, atau TV. Game ini punya pengaturan kualitas grafis Ringan untuk layar TV.",
      ],
    },
    {
      kind: "p",
      text: "Belum punya sensor? Pilih Coba mode demo di layar pertama. Kadensnya disimulasikan dan bisa kamu atur dengan slider, jadi kamu bisa mencoba rute dan tampilannya dulu. Hasil mode demo tidak masuk papan peringkat.",
    },
    { kind: "h2", text: "Cara mulai" },
    {
      kind: "ol",
      items: [
        "Buka fit.joyorogo.com/ride di browser. Layar akan menampilkan QR dan kode 6 angka yang berlaku 10 menit.",
        "Di HP, buka JoyoFit, masuk ke JoyoRogo, lalu pilih Main di web (dari pilihan olahraga sepeda indoor, atau dari Watch, Sensor). Pindai QR dengan kamera HP, atau ketik kodenya.",
        "Nyalakan sensormu di JoyoFit sampai kadens terbaca, lalu pilih Pilih rute di browser.",
        "Pilih mode dan rute, lalu tekan Mulai. Setelah hitung mundur, kayuh.",
      ],
    },
    {
      kind: "p",
      text: "Latihannya juga tercatat di HP sebagai latihan sepeda indoor, dengan jarak dan tanjakan dari game. Kamu yang memutuskan menyimpannya saat selesai.",
    },
    { kind: "h2", text: "Rute" },
    {
      kind: "ul",
      items: [
        "Pantai, 12 km: datar menyusur pantai dengan tikungan landai. Cocok untuk pemanasan atau adu sprint.",
        "Bukit, 9 km: berkelok naik ke bukit, lalu turunan panjang. Tanjakan paling curamnya 10,8 persen.",
        "Kebun, 3 km: putaran pendek dengan gundukan kecil, cukup untuk mencoba.",
        "Bromo, 8 km: menanjak terus dari 1.400 m ke 1.945 m, dengan tikungan patah dan sawah berteras khas Tengger. Siapkan gigi paling ringan.",
      ],
    },
    { kind: "h2", text: "Tiga mode" },
    {
      kind: "ul",
      items: [
        "Bebas: gowes rute pilihanmu. Rekor terbaikmu di rute itu jadi bayangan yang bisa kamu kejar, dan waktu di segmen sprint dan tanjakan dicatat.",
        "Latihan interval: blok kadens terstruktur dengan hitung mundur, yaitu Tempo 3 × 4 menit, Hard 4 × 4 menit, atau Sprint 8 × 20 detik. Layar menunjukkan blok yang sedang jalan, target kadens, dan berapa persen waktumu tepat sasaran. Rutenya berputar sampai latihan selesai.",
        "Tantangan harian: satu rute dan satu target waktu untuk semua pemain per hari (WIB). Selesai di bawah target dapat medali emas, dalam 5 persen perak, dalam 15 persen perunggu.",
      ],
    },
    { kind: "h2", text: "Papan peringkat" },
    {
      kind: "p",
      text: "Waktu terbaik tiap pemain per rute ditampilkan sebagai top 20, untuk hari ini dan sepanjang masa. Yang masuk hanya rute yang selesai penuh di mode Bebas atau Tantangan harian dengan sensor lewat HP. Mode demo, sambungan Bluetooth langsung, dan latihan interval tidak dikirim. Namamu tampil sebagai nama depan dan inisial (misalnya \"Budi S.\"), dan kamu bisa mencentang Sembunyikan namaku sebelum mengirim.",
    },
    { kind: "h2", text: "Tips" },
    {
      kind: "ul",
      items: [
        "Gigi dipilih otomatis sesuai kemiringan sampai kamu menggantinya sendiri. Lewat tombol di layar, tombol panah di keyboard, atau dari HP. Di Bromo, gigi paling ringan berguna di tanjakan yang curam.",
        "Pesepeda lain di rute adalah bot pengatur tempo, bertanda BOT di nama mereka, dan sama untuk semua pemain di satu rute. Daftar posisi dan selisih waktumu ada di pojok layar.",
        "Mengayuh tepat di belakang pesepeda lain (1 sampai 4 meter) mengurangi hambatan udara. Layar menulis Di slipstream saat itu terjadi.",
        "Daya di layar berlabel estimasi: dihitung dari kadens, gigi virtual, dan kemiringan, bukan dari alat ukur daya. Kalau kamu punya power meter, daya terukur dipakai dan diberi label terukur.",
        "Tombol: spasi atau Esc untuk jeda, L untuk lap, C untuk ganti kamera, M untuk suara, F untuk layar penuh.",
        "Layar lemot? Pilih kualitas Ringan atau Sedang di layar pilih rute.",
        "Ringkasan di akhir bisa disimpan sebagai kartu gambar untuk dibagikan.",
      ],
    },
    {
      kind: "note",
      text: "Tanpa HP, di Chrome laptop atau Android, kamu bisa menyambung sensor detak jantung dan kadens langsung lewat Web Bluetooth. Safari di iPhone tidak mendukung Web Bluetooth; di sana pakai jalur lewat HP.",
    },
  ],
  more: [
    { href: "/#ride", label: "Ride di beranda" },
    { href: "/blog/joyofit-web", label: "JoyoFit Web" },
    { href: "/ride", label: "Main sekarang" },
  ],
};
