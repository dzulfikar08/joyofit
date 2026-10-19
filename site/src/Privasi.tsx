import { ArrowLeft, Check } from "lucide-react";

import { GITHUB_URL } from "./lib";

const CONTACT = "dzulfikar@joyorogo.com";
const UPDATED = "18 Oktober 2026";
const UPDATED_EN = "18 October 2026";

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-[0.85em] font-semibold">{children}</code>;
}

function Mail() {
  return (
    <a
      href={`mailto:${CONTACT}?subject=Hapus%20data%20cloud%20JoyoFit`}
      className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
    >
      {CONTACT}
    </a>
  );
}

function List({ items }: { items: readonly React.ReactNode[] }) {
  return (
    <ul className="mt-3 space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[0.9375rem] leading-relaxed">
          <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Block({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-3xl bg-card p-5 md:p-6">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-[0.9375rem] leading-relaxed">{children}</div>
    </section>
  );
}

function Indonesian() {
  return (
    <div lang="id" className="space-y-3">
      <Block title="Ringkasnya">
        <List
          items={[
            "Data jam (langkah, detak jantung, SpO2, tidur, olahraga) disimpan di HP-mu. Data kesehatanmu tidak keluar dari HP, kecuali kamu memilih membagikannya lewat Keluarga atau menyalakan sinkron cloud.",
            "Cloud JoyoFit itu opsional dan baru aktif setelah kamu masuk dengan akun JoyoRogo.",
            "Di iPhone, data jam hanya ditulis ke Apple Health bila kamu menyalakannya. JoyoFit membaca Apple Health satu kali saja, saat kamu menekan Impor riwayat dari Apple Health.",
            "Tidak ada iklan, tidak ada SDK iklan, analitik, atau pelaporan crash, dan datamu tidak dijual. Firebase Cloud Messaging dipakai hanya untuk mengantar notifikasi push Keluarga.",
            "Semua yang dikirim aplikasi lewat internet memakai HTTPS (TLS).",
            "Postingan, komentar, dan foto di tab Social ada di JoyoRogo dan hanya muncul bila kamu sendiri yang memostingnya.",
            "Koneksi AI itu opsional (khusus Pro): hanya bila kamu menyambungkan Claude, ChatGPT, atau aplikasi MCP lain, aplikasi itu bisa membaca datamu, dan hanya saat kamu bertanya di sana. Bisa kamu putuskan kapan saja di Pengaturan, Koneksi AI.",
            "Kode sumbernya terbuka (AGPL-3.0), jadi semua yang ditulis di sini bisa kamu periksa sendiri.",
          ]}
        />
        <p className="text-muted-foreground">
          JoyoFit dibuat dan dijalankan oleh Dzulfikar di Malang, Indonesia. Pertanyaan atau
          permintaan hapus data: <Mail />. Terakhir diperbarui {UPDATED}.
        </p>
      </Block>

      <Block title="Data di HP-mu (bawaan)">
        <p>
          JoyoFit tersambung langsung ke jam Huawei atau Honor lewat Bluetooth, tanpa Huawei Health dan
          tanpa server perantara. Yang diterima dari jam disimpan di database di HP-mu (
          <Code>joyofit.db</Code>), dan pengaturan disimpan di penyimpanan pribadi aplikasi:
        </p>
        <List
          items={[
            "Langkah, jarak, kalori, detak jantung, SpO2, detak jantung istirahat, tidur, olahraga beserta rute GPS yang direkam jam, stres, HRV, suhu kulit dan metrik kesehatan lain yang dilaporkan jam.",
            "Data yang kamu isi sendiri: profil (tinggi, berat, tahun lahir, jenis kelamin, target langkah), data siklus bila kamu menyalakan kalender siklus, berat dan tekanan darah yang kamu catat, alarm.",
            "Alamat Bluetooth, nama dan model jam yang kamu pasangkan, serta kunci pairing-nya (disimpan di penyimpanan pribadi aplikasi).",
            "Pengaturan: fitur mana yang menyala, aplikasi mana yang notifikasinya diteruskan, kota atau lokasi terakhir untuk cuaca.",
          ]}
        />
        <p>
          Di iPhone, data yang sama disimpan di ruang penyimpanan pribadi aplikasi, dan JoyoFit tidak mengakses
          Apple Health untuk membacanya. Cadangan otomatis Android dimatikan untuk aplikasi ini (<Code>allowBackup=false</Code>). JoyoFit tidak
          memakai iklan, ID iklan, Sentry, atau SDK analitik dan pelaporan crash apa pun. Satu-satunya layanan Google di dalamnya adalah
          Firebase Cloud Messaging (FCM), hanya untuk mengantar notifikasi push Keluarga (lihat bagian Notifikasi push).
        </p>
      </Block>

      <Block title="Cloud JoyoFit (opsional)">
        <p>
          Di Settings, Health Connect and cloud (di iPhone: Apple Health and cloud), bagian Sinkron cloud, kamu bisa masuk dengan akun JoyoRogo (login Google, atau Masuk
          dengan Apple di iPhone, lewat JoyoRogo). Setelah masuk, unggahan berjalan otomatis: sekitar dua detik setelah tiap sinkron dan saat
          aplikasi dibuka. Unggahan pertama mengirim seluruh riwayat di HP, bukan hanya yang baru. Tidak masuk
          berarti tidak ada unggahan.
        </p>
        <p className="font-semibold">Yang diunggah:</p>
        <List
          items={[
            "Jam: alamat Bluetooth, nama, model, versi perangkat lunak, waktu sinkron terakhir.",
            "Per menit: langkah, kalori, jarak, detak jantung, SpO2, detak jantung istirahat.",
            "Tidur: jam mulai dan selesai tiap segmen dan tahap tidurnya.",
            "Olahraga: dijelaskan di bagian Olahraga (JoyoRogo Pro) di bawah.",
            "Khusus JoyoRogo Pro, supaya beberapa HP menampilkan hal yang sama: pengaturan yang ikut akun (profil: tinggi, berat, tahun lahir, jenis kelamin, target langkah; target harian, tema, bahasa, satuan suhu dan nama kota cuaca, saklar kalender siklus dan pengingatnya, laporan tidur, Healthy Living), template stiker buatanmu, rute yang kamu simpan, HRV, skor tidur, metrik kesehatan lain yang dilaporkan jam, dan data siklus (periode dan catatan harian). Data siklus adalah data kesehatan: ia hanya ikut bila kamu membiarkan saklar Sinkron data siklus menyala (bawaannya menyala untuk Pro); mematikannya menghapus salinannya di cloud.",
          ]}
        />
        <p className="font-semibold">Yang tidak diunggah:</p>
        <p>
          Tekanan darah dan berat yang kamu catat, makanan, notifikasi, data panggilan, lokasi untuk cuaca, nomor
          seri jam, interval detak mentah (RRI), kunci pairing jam, dan pengaturan yang milik satu HP (Hanya Wi-Fi,
          sinkron otomatis, izin, koneksi Health Connect atau Apple Health). Pairing jam tidak ikut cloud: di HP lain
          riwayatnya tampil, tetapi jam harus dipasangkan sendiri.
        </p>
        <p>
          Data ini disimpan di database dan penyimpanan Cloudflare di akun Cloudflare milik pengembang, terkait
          ke ID akun JoyoRogo-mu. Tidak dikirim ke pihak lain, dan hanya akunmu yang bisa membacanya lewat sesi
          login. Server mencatat log permintaan standar Cloudflare Workers. Semua yang dikirim ke server ini lewat HTTPS (TLS).
        </p>
        <p>
          Keluar (sign out) menghentikan unggahan dan tidak menghapus data di cloud. Data di HP juga tidak pernah
          dihapus tanpa kamu pilih: saat keluar, aplikasi menanyakan apakah data dihapus dari HP, dan bila datamu
          belum ada di cloud (akun Gratis, atau unggahan belum selesai) ia memperingatkan bahwa data itu hanya ada di
          HP. Bila akun lain masuk di HP yang masih memegang data akun sebelumnya, sinkron berhenti sampai kamu memilih
          menyimpannya terpisah (tidak pernah diunggah ke akun baru) atau menghapusnya dari HP. Untuk menghapus data
          cloud atau akun ada tombol di aplikasi, lihat bagian Penghapusan.
        </p>
        <p className="font-semibold">Olahraga (JoyoRogo Pro):</p>
        <p>
          Untuk akun JoyoRogo Pro yang masuk di dalam JoyoFit, setiap olahraga diunggah sebagai satu berkas
          terkompresi per olahraga. Isinya ringkasan olahraga, rute GPS, detak jantung, ketinggian, kecepatan,
          kadensi, panjang langkah, daya, dan analisis yang dihitung JoyoFit dari data itu. Berkas disimpan di
          penyimpanan Cloudflare milik JoyoRogo (database untuk daftar dan penyimpanan objek untuk berkasnya),
          bersifat pribadi untuk akunmu, dan tampil di joyorogo.com untuk login yang sama. Akun Gratis tidak
          mengunggah olahraga: datanya tetap di HP. Unggahan bisa dibatasi hanya lewat Wi-Fi di Settings, Health Connect and cloud (iPhone: Apple Health and cloud),
          bagian Sinkron cloud, yang juga menampilkan perkiraan ukuran yang menunggu. Data lain di atas (langkah,
          detak jantung, tidur, jam) tetap di database cloud JoyoFit sendiri.
        </p>
        <p>
          Setelah masuk di HP baru, aplikasi membaca olahragamu dari cloud dan memulihkannya. Olahraga yang kamu
          hapus di satu HP atau di joyorogo.com ikut hilang dari HP lain. Olahraga di cloud tidak dijual dan
          tidak dipakai untuk iklan atau melatih model. Isinya terpisah dari yang kamu bagikan lewat postingan
          JoyoRogo, yang tetap berupa cuplikan pilihanmu.
        </p>
        <p>
          Selama kamu masuk, JoyoFit juga bicara dengan server JoyoRogo (<Code>api.joyorogo.com</Code>): membaca
          makanan hari ini, profil, dan berat terakhirmu dari JoyoRogo untuk ditampilkan di jam, menulis makanan
          yang kamu catat cepat dari jam, dan mengirim skor harian (pemulihan, beban, tidur, kesiapan) tiga hari
          terakhir ke JoyoRogo. Untuk hari ini, ikut terkirim ukuran tubuh yang sudah dihitung JoyoFit: jam tidur
          semalam, detak jantung istirahat, HRV semalam dan statusnya, VO2max, status latihan dan rasio bebannya, serta sisa waktu pemulihan.
          Ukuran yang belum bisa dihitung tidak dikirim. Aturan privasi JoyoRogo berlaku untuk data itu: <a
            href="https://joyorogo.com/privasi"
            className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
          >
            joyorogo.com/privasi
          </a>
          . Komponen login aplikasi bisa menghubungi server JoyoRogo untuk mengecek sesi setiap aplikasi dibuka,
          termasuk bila kamu belum masuk; permintaan itu tidak membawa data kesehatan.
        </p>
      </Block>

      <Block title="Health Connect (menulis saja)">
        <p>
          Bila kamu menyalakannya di Pengaturan, JoyoFit menyalin data jam ke Health Connect, penyimpanan
          kesehatan di HP Android, supaya aplikasi lain yang kamu izinkan bisa membacanya. Izinnya diminta lewat
          dialog Health Connect sendiri dan bisa dicabut kapan saja.
        </p>
        <List
          items={[
            "Yang ditulis: langkah, jarak, kalori aktif, detak jantung, detak jantung istirahat, saturasi oksigen, tidur (dengan tahapnya), dan sesi olahraga (jenis, nama, waktu, ringkasan). Rute GPS tidak ditulis.",
            "JoyoFit tidak pernah membaca data Health Connect, dan tidak punya izin baca.",
            "Data Health Connect tidak dijual, tidak dipakai untuk iklan atau penentuan profil iklan, tidak dikirim ke server mana pun oleh fitur ini, dan tidak dibagikan ke pihak ketiga.",
          ]}
        />
      </Block>

      <Block title="Apple Health (iPhone, menulis dan impor satu kali)">
        <p>
          Di iPhone, bila kamu menyalakannya di Pengaturan, JoyoFit menyalin data jam ke Apple Health (HealthKit)
          supaya aplikasi lain yang kamu izinkan bisa membacanya. Izinnya diminta lewat dialog Apple Health sendiri
          dan bisa dicabut kapan saja di aplikasi Kesehatan (Berbagi, Aplikasi, JoyoFit) atau Pengaturan iPhone.
        </p>
        <List
          items={[
            "Yang ditulis: langkah, jarak jalan dan lari, energi aktif, detak jantung, detak jantung istirahat, saturasi oksigen, tidur (analisis tidur dengan tahapnya), sesi olahraga, dan rute GPS olahraga yang direkam jam.",
            "Yang dibaca: hanya saat kamu menekan Impor riwayat dari Apple Health di Pengaturan. Saat itu JoyoFit meminta izin baca Apple Health untuk langkah, detak jantung, detak jantung istirahat, tidur, olahraga, saturasi oksigen (SpO2) dan energi aktif, lalu membaca riwayat yang Huawei Health simpan di sana. Izin baca tidak diminta di waktu lain, dan data yang JoyoFit tulis sendiri tidak ikut dibaca kembali.",
            "Data yang dibaca itu hanya disimpan di HP-mu, tidak dikirim ke server JoyoFit atau server mana pun, dan tidak dipakai untuk iklan.",
            "Data Apple Health tidak dijual, tidak dipakai untuk iklan atau penentuan profil iklan, tidak dikirim ke server mana pun oleh fitur ini, dan tidak dibagikan ke pihak ketiga. Data itu juga tidak dipakai untuk riset atau analitik.",
            "Menghapus data yang ditulis JoyoFit dilakukan di aplikasi Kesehatan.",
          ]}
        />
      </Block>

      <Block title="Masuk dengan Apple (iPhone)">
        <p>
          Di iPhone kamu bisa masuk ke akun JoyoRogo dengan Apple, selain dengan Google. Apple mengirim token
          identitas ke aplikasi, lalu JoyoFit meneruskannya ke server JoyoRogo (<Code>api.joyorogo.com</Code>)
          untuk diperiksa ke Apple. Yang diterima: ID pengguna Apple untuk akunmu, alamat email (alamat relai
          pribadi Apple bila kamu memilih Sembunyikan Email Saya), dan nama, hanya bila kamu mengizinkan dan hanya
          saat pertama kali. Data ini hanya dipakai untuk membuat dan mengenali akun JoyoRogo-mu, tidak untuk iklan
          dan tidak dibagikan. Saat akun dihapus, JoyoFit meminta Apple mencabut izin masuk itu, jadi JoyoFit juga
          hilang dari daftar Masuk dengan Apple di ID Apple-mu.
        </p>
      </Block>

      <Block title="Strava (opsional, gratis)">
        <p>
          Bila kamu menyambungkan Strava di Pengaturan, Strava (masuk dengan akun JoyoRogo dulu), JoyoFit
          mengirim olahraga dari jam-mu ke akun Strava-mu sendiri. Izin yang diminta hanya satu: mengunggah
          aktivitas (<Code>activity:write</Code>).
        </p>
        <List
          items={[
            "Yang dikirim: berkas olahraga (waktu, jenis, rute GPS, jarak, kalori, detak jantung) langsung dari HP-mu ke Strava, hanya untuk olahraga yang selesai setelah kamu menyambung, atau yang kamu kirim sendiri dengan Kirim ke Strava. Riwayat yang diimpor dari Huawei Health tidak dikirim otomatis.",
            "Token akses Strava-mu dan ID atlet disimpan di server JoyoRogo (akun yang sama dengan masuk di JoyoFit), supaya HP bisa mengunggah. JoyoFit dan JoyoRogo memakai satu aplikasi Strava, jadi kalau kamu juga menyambungkan Strava di JoyoRogo, sambungan itu dipakai bersama; memutus satu tidak memutus yang lain. Berkas olahraga tidak melewati atau disimpan di server JoyoFit.",
            "JoyoFit tidak membaca data dari Strava, tidak menampilkan data Strava ke orang lain, dan tidak memakainya untuk analitik, iklan, atau AI.",
            "Tambahan teks fit.joyorogo.com di deskripsi aktivitas mati secara bawaan dan hanya muncul bila kamu menyalakannya.",
            "Putuskan Strava di aplikasi, dan JoyoFit berhenti memakai sambunganmu; token dihapus dan izin dicabut di Strava saat JoyoRogo juga tidak memakainya. Cabut aplikasi di strava.com (Pengaturan, Aplikasi Saya), dan token untuk JoyoFit dan JoyoRogo langsung dihapus. Aktivitas yang sudah ada di Strava tetap milikmu dan diatur di Strava.",
          ]}
        />
      </Block>

      <Block id="koneksi-ai" title="Koneksi AI (opsional, Pro)">
        <p>
          Dengan koneksi AI opsional, kamu bisa menyambungkan Claude, ChatGPT, atau aplikasi MCP lain ke akun
          JoyoRogo-mu. Koneksinya dibuat di aplikasi AI itu, lewat halaman izin di joyorogo.com. Sesudah kamu setuju, data
          JoyoRogo dan JoyoFit-mu dikirim ke penyedia AI yang kamu pilih:
        </p>
        <List
          items={[
            "Yang bisa dibaca, sesuai izin yang kamu setujui: catatan makan, berat badan, olahraga dari jam, metrik tidur dan pemulihan (tidur, detak jantung istirahat, HRV, VO2max, status latihan, waktu pemulihan), dan profil serta targetmu.",
            "Dikirim hanya saat kamu mengajukan pertanyaan di akunmu sendiri di aplikasi AI itu. Aksesnya hanya-baca: aplikasi AI tidak bisa mengubah atau menghapus apa pun, dan hanya akun Pro yang bisa memakainya.",
            "Kamu bisa memutuskan koneksi kapan saja di Pengaturan, Koneksi AI (atau di joyorogo.com). Putus berlaku seketika: aplikasi itu langsung tidak bisa membaca apa pun lagi.",
            "JoyoRogo menyimpan catatan audit tentang apa yang dibaca (nama alat dan rentang tanggalnya, bukan isi datanya) selama 90 hari, dan kamu bisa melihatnya di layar Koneksi AI.",
            "Rute GPS dan data Strava tidak pernah dibagikan lewat koneksi ini.",
            "Setelah data sampai ke penyedia AI, aturan privasi penyedia itu yang berlaku, bukan aturan JoyoFit atau JoyoRogo. Baca aturannya sebelum menyambungkan.",
          ]}
        />
        <p>
          Jawaban AI bukan saran medis. Untuk keputusan kesehatan, tanyakan ke tenaga kesehatan. Tanpa koneksi AI,
          tidak ada data yang dikirim ke penyedia AI.
        </p>
      </Block>

      <Block id="social" title="Social: postingan, komentar, dan foto">
        <p>
          Tab Social di aplikasi menampilkan feed JoyoRogo dan butuh masuk dengan akun JoyoRogo. Tidak ada yang
          diposting otomatis: hanya yang kamu tulis atau bagikan sendiri. Semuanya disimpan di server JoyoRogo
          (Cloudflare), bukan di server JoyoFit.
        </p>
        <List
          items={[
            "Postingan, komentar, dan foto: caption, komentar (maksimal 280 karakter), dan foto yang dilampirkan ke postingan disimpan di akun JoyoRogo-mu dan tampil di feed untuk orang yang boleh melihatnya.",
            "Profil yang terlihat: nama, foto profil, dan nama pengguna (handle) JoyoRogo-mu tampil bersama postingan dan komentarmu, juga di daftar kudos dan pengikut, serta bio bila kamu mengisinya.",
            "Olahraga dari jam: lewat Share to JoyoRogo di halaman olahraga, kamu memostingkan ringkasan olahraga. Sesuai saklar yang kamu pilih (Heart-rate data, Route, Comparison with earlier workouts), postingan juga membawa rute GPS, grafik detak jantung, dan analisis olahraga. Ringkasannya terlihat oleh audiens yang kamu pilih; detailnya (peta, grafik, split, zona) terlihat oleh kamu dan anggota JoyoRogo Pro.",
            "Siapa yang bisa melihat: Group (bawaan) hanya orang yang satu grup JoyoRogo denganmu; Public bisa dilihat semua orang di JoyoRogo dan butuh profil JoyoRogo-mu berstatus publik. Pengguna lain bisa memberi kudos, berkomentar, melaporkan, dan memblokir.",
            "Postingan adalah salinan terpisah dari olahragamu: menghapus olahraga di HP atau di cloud JoyoFit tidak menghapus postingannya.",
            "Hapus: hapus postingan atau komentarmu di joyorogo.com lewat menu postingan atau komentar (penulis postingan juga bisa menghapus komentar orang lain di postingannya). Menghapus postingan ikut menghapus kudos, komentar, rute, grafik, dan foto postingan itu. Menghapus akun JoyoRogo menghapus semua postingan, komentar, dan kudosmu. Postingan dan komentar disimpan sampai kamu menghapusnya atau akunmu dihapus.",
          ]}
        />
        <p className="text-muted-foreground">
          Aturan JoyoRogo untuk feed dan grup ada di{" "}
          <a
            href="https://joyorogo.com/privasi"
            className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
          >
            joyorogo.com/privasi
          </a>
          .
        </p>
      </Block>

      <Block id="waitlist" title="Daftar undangan Strava dan iPhone">
        <p>
          Halaman fit.joyorogo.com/strava dan fit.joyorogo.com/iphone punya formulir daftar tunggu. Aplikasinya
          tidak terlibat; hanya situs ini.
        </p>
        <List
          items={[
            "Yang disimpan: jenis daftar (Strava atau iPhone), email yang kamu isi, nama atau link profil Strava (daftar Strava), model jam bila kamu isi (daftar iPhone), status (awalnya menunggu), serta waktu mendaftar dan waktu terakhir diperbarui.",
            "Untuk apa: hanya untuk memberimu undangan: mengaktifkan aksesmu ke Strava saat ada slot, atau menambahkan emailmu sebagai tester TestFlight, lalu mengabarimu lewat email. Tidak dipakai untuk pemasaran, tidak dijual, dan tidak dibagikan. Email Apple ID untuk TestFlight dimasukkan ke App Store Connect milik pengembang agar Apple mengirim undangan.",
            "Di mana: database Cloudflare D1 di akun Cloudflare pengembang, hanya bisa dibaca pemilik lewat token rahasia. Formulirnya tidak mengirim email atau isian apa pun ke RevKlik (statistik situs).",
            "Pembatas kiriman: server menghitung kiriman per jam dari alamat IP-mu memakai hash satu arah yang berlaku satu jam, bukan IP aslinya, dan menghapus hitungan itu dalam beberapa jam.",
            <>
              Hapus: kirim email dari alamat yang kamu daftarkan ke <Mail /> dengan subjek{" "}
              <span className="font-semibold">Hapus daftar tunggu JoyoFit</span>. Kami menghapus barisnya dan mengonfirmasi lewat email, paling lambat 30 hari. Setelah kamu mendapat akses, entri disimpan sampai kamu minta hapus.
            </>,
          ]}
        />
      </Block>

      <Block title="Cuaca">
        <p>
          Cuaca di jam mati secara bawaan. Bila kamu menyalakannya, JoyoFit meminta prakiraan cuaca ke Open-Meteo
          (<Code>api.open-meteo.com</Code>) saat jam tersambung dan berkala, juga saat aplikasi ditutup selama
          jam masih tersambung. Yang dikirim: koordinat yang dibulatkan ke dua desimal (sekitar 1 km) tanpa ID
          perangkat atau kunci API. Open-Meteo juga melihat alamat IP-mu. Mencari kota mengirim teks nama kota ke{" "}
          <Code>geocoding-api.open-meteo.com</Code>.
        </p>
        <p>
          Lokasinya dari lokasi HP (izin lokasi) atau kota yang kamu pilih. Lokasi HP terakhir dan nama tempatnya
          disimpan di HP supaya dipakai ulang; nama tempat dicari dengan layanan Geocoder bawaan Android.
        </p>
        <p>
          Di iPhone, JoyoFit meminta izin lokasi hanya saat aplikasi dipakai (tanpa lokasi latar belakang), dengan
          akurasi sekitar satu kilometer, karena cuaca hanya butuh kotanya. Nama tempat dicari dengan layanan geocoding
          Apple, yang menerima koordinat itu. Ke Open-Meteo tetap hanya koordinat yang dibulatkan.
        </p>
      </Block>

      <Block title="Lokasi dan GPS">
        <List
          items={[
            "Cuaca memakai lokasi HP hanya bila kamu memilih mode lokasi HP, dan ke Open-Meteo hanya terkirim koordinat yang dibulatkan ke dua desimal (sekitar 1 km).",
            "Saat olahraga luar ruang dimulai di jam, jam meminta GPS HP. JoyoFit membaca GPS HP selama olahraga itu dan mengirim posisi hanya ke jam lewat Bluetooth. HP tidak menyimpannya dan tidak mengunggahnya. JoyoFit menjelaskan hal ini sebelum meminta izin lokasi presisi. JoyoFit tidak meminta lokasi latar belakang.",
            "Jalur GPS yang direkam jam diunduh dari jam, disimpan di HP, dan ditampilkan sebagai rute. Rute itu keluar dari HP hanya dalam dua keadaan: diunggah bila kamu memakai sinkron cloud dengan JoyoRogo Pro, dan dibagikan bila kamu memposting olahraga dengan rute ke JoyoRogo (Share to JoyoRogo, saklar Route menyala) atau mengirimnya ke Strava. Posisi GPS HP saat olahraga sendiri tidak diunggah.",
            "Saat jam meminta data bantuan satelit (AGPS), HP mengunduh berkas publik Broadcom dari gllto.glpals.com lewat HTTPS, alamat tetap. JoyoFit tidak menambahkan lokasi atau ID apa pun, tetapi server itu melihat alamat IP-mu. JoyoFit tidak menghubungi server Huawei untuk ini; jenis data bantuan lain yang diminta jam ditolak.",
          ]}
        />
      </Block>

      <Block id="loop" title="Loop dari rumah">
        <p>
          Bila kamu menekan Cari rute, JoyoFit mengirim titik awal dan beberapa titik di sekitarnya (koordinat penuh, dalam
          jarak beberapa kilometer dari titik awal) ke layanan rute OSRM milik FOSSGIS e.V. (<Code>routing.openstreetmap.de</Code>).
          Tidak ada akun, ID perangkat, atau kunci API yang ikut dikirim; layanan itu melihat alamat IP-mu dan nama aplikasi
          (JoyoFit) di header permintaan. Jejak GPS latihanmu tidak dikirim ke mana pun untuk fitur ini: kebaruan jalan
          dihitung di HP dari latihan yang sudah tersimpan di HP.
        </p>
        <p>
          Titik Rumah disimpan di HP ini saja (tidak ikut sinkron cloud) dan ikut terhapus bila kamu menghapus semua data
          lokal. Izin lokasi presisi diminta hanya saat kamu memilih Lokasiku dan hanya dibaca saat layar loop dibuka. Mencari
          tempat untuk menaruh Rumah mengirim teks yang kamu tulis ke Nominatim (OpenStreetMap).
        </p>
      </Block>

      <Block title="Notifikasi ke jam">
        <p>
          Meneruskan notifikasi mati secara bawaan dan butuh akses notifikasi yang kamu berikan di pengaturan
          Android. Setelah menyala, JoyoFit membaca judul, isi, dan nama aplikasi dari notifikasi yang masuk dan
          mengirimnya ke jam lewat Bluetooth. Semua aplikasi non-sistem diteruskan kecuali kamu mematikannya di
          daftar aplikasi di Pengaturan. Notifikasi tidak disimpan di disk dan tidak dikirim lewat internet;
          hanya beberapa yang terakhir ada di memori.
        </p>
        <p className="text-muted-foreground">
          Di iPhone, JoyoFit tidak bisa dan tidak membaca notifikasi aplikasi lain. Jam menampilkan notifikasi iPhone
          sendiri lewat layanan notifikasi Bluetooth bawaan iOS (ANCS) bila kamu mengizinkannya di Pengaturan iPhone.
        </p>
      </Block>

      <Block title="Panggilan telepon">
        <p>
          Versi Google Play memakai izin status telepon agar jam bisa menampilkan bahwa HP berdering, dan izin
          menjawab panggilan agar tombol terima dan tolak di jam bekerja (keduanya hanya bila kamu menyalakannya
          di Pengaturan). Jam menampilkan &quot;Incoming call&quot;. Versi Google Play tidak membaca log
          panggilan, tidak membaca kontak, dan tidak mengirim SMS. Tidak ada data panggilan yang disimpan atau
          dikirim keluar HP.
        </p>
        <p>
          Panggilan aplikasi (WhatsApp, Telegram, Signal, Meet, LINE) dikenali dari notifikasi panggilannya, dengan
          akses notifikasi yang sama seperti di atas: nama penelepon dan nama aplikasi dari notifikasi itu dikirim
          ke jam lewat Bluetooth, dan tombol tolak atau terima di jam menekan tombol yang sama di notifikasi. Hanya
          bila Tampilkan panggilan masuk menyala dan aplikasinya tidak kamu matikan di daftar aplikasi. Tidak ada
          yang disimpan atau dikirim keluar HP.
        </p>
        <p className="text-muted-foreground">
          Build sendiri dari kode sumber bisa, bila kamu mengizinkan, membaca nomor
          penelepon (izin log panggilan) dan nama kontak, serta mengirim SMS SOS yang diminta jam. Fitur itu
          dihilangkan dari versi Google Play.
        </p>
      </Block>

      <Block title="Foto wajah jam">
        <p>
          Foto yang kamu pilih untuk wajah jam dipotong di HP lalu dikirim ke jam lewat Bluetooth. Foto tidak
          diunggah ke server mana pun. Salinan hasil potongan disimpan di penyimpanan aplikasi untuk pratinjau
          dan dihapus bersama fotonya.
        </p>
      </Block>

      <Block title="Gambar bagikan olahraga dan berkas FIT">
        <p>
          Gambar untuk membagikan olahraga dibuat di HP. Foto dari galeri atau kamera (izin kamera diminta hanya
          saat kamu mengetuk Ambil foto) hanya dipakai sebagai latar gambar itu dan tidak diunggah ke server mana
          pun. Gambar jadi hanya pergi ke aplikasi yang kamu pilih saat membagikan atau ke clipboard saat kamu
          menyalinnya.
        </p>
        <p>
          Berkas .FIT dari bike computer atau jam lain yang kamu buka dengan JoyoFit dibaca di HP dan disimpan
          sebagai olahraga impor. Olahraga impor tidak diunggah otomatis ke Strava, cloud, atau Health Connect.
        </p>
      </Block>

      <Block title="Laporan dukungan">
        <p>
          Hanya bila kamu mengetuk Laporkan di GitHub atau Bagikan: JoyoFit membuat ringkasan (versi aplikasi,
          merek dan model HP, versi Android, model dan versi jam, kemampuan yang dilaporkan jam) dan log
          sambungan. Alamat Bluetooth dan nomor seri dihapus, tetapi log bisa memuat hal lain, jadi baca dulu
          sebelum mengirim. Tidak ada yang terkirim otomatis.
        </p>
      </Block>

      <Block id="coach" title="Coach (Pro)">
        <p>
          Rencana latihan Coach (tujuan, level, hari latihan, sesi yang selesai) disimpan di akun JoyoRogo-mu agar ikut ke ponsel lain, dan ikut terhapus bersama akunmu. Pesan Tanya coach dan ringkasan datamu (metrik hari ini, rencana, latihan terakhir, dan catatan makan di JoyoRogo) dikirim ke AI JoyoRogo (Cloudflare Workers AI) untuk dijawab. Pesan tidak disimpan di server; yang dicatat hanya jumlah pesan per hari dan pemakaian token. Obrolan hanya tersimpan di ponselmu dan bisa dihapus dari layar chat. Pesan tentang nyeri atau cedera dijawab dengan anjuran menemui tenaga medis tanpa memanggil AI.
        </p>
      </Block>

      <Block id="keluarga" title="Pantau keluarga (opsional)">
        <List
          items={[
            "Fitur ini mati sampai kamu sendiri menerima undangan. Orang yang memantau (pemantau) perlu masuk dengan akun JoyoRogo; orang yang dipantau tidak perlu membayar apa pun.",
            "Yang dikirim hanya ringkasan harian: langkah, detak jantung istirahat, tidur semalam, kadar oksigen (SpO2) bila kamu menyalakannya, serta kapan jam terakhir tersambung dan baterainya. Tidak pernah dikirim: lokasi, rute olahraga, detak jantung per menit, makanan, dan foto.",
            "Kamu menyetujui tiap kategori dengan saklarnya sendiri dan bisa mengubahnya kapan saja. SpO2 mati secara bawaan.",
            "Kalau kamu jeda atau berhenti, pemantau langsung tidak bisa melihat apa pun dan riwayat ringkasan yang sudah terkirim dihapus saat itu juga.",
            "Riwayat disimpan 30 hari untuk pemantau Gratis dan 90 hari untuk pemantau Pro, lalu dihapus otomatis.",
            "Tidak ada mode tersembunyi: kamu selalu bisa melihat siapa yang memantau dan kapan terakhir melihat datamu. Undangan berupa tautan atau kode 8 karakter yang berlaku 48 jam dan hanya bisa dipakai sekali.",
            "Pemantau bisa menerima pemberitahuan push (lihat Notifikasi push di bawah), dan lewat email bila Pro, saat datamu terlihat tidak biasa (misalnya belum ada langkah sampai siang atau jam lama tidak tersinkron). Pemberitahuan itu bukan diagnosis dokter.",
            "Menghapus akun JoyoRogo menghapus semua tautan dan ringkasan, baik milikmu sebagai yang dipantau maupun sebagai pemantau.",
            "Bukan alat medis dan bukan pantauan langsung: data baru masuk setelah jam tersinkron dan HP terhubung internet, jadi bisa telat dari beberapa menit sampai berjam-jam. Di iPhone, pengiriman latar belakang ditentukan iOS dan bisa lebih telat lagi. Jangan mengandalkannya untuk keadaan darurat; hubungi orangnya atau 112.",
          ]}
        />
        <p className="text-muted-foreground">
          Halaman undangan fit.joyorogo.com/keluarga tidak mengirim kode undangan ke statistik situs.
        </p>
      </Block>

      <Block id="push" title="Notifikasi push (Keluarga)">
        <List
          items={[
            "Hanya dipakai untuk Keluarga: pemberitahuan ke pemantau saat data terlihat tidak biasa, dan colekan yang menanyakan kabarmu. Tidak untuk iklan atau pemasaran.",
            "Saat kamu mengizinkan notifikasi di Keluarga, aplikasi membuat token push (token Expo) untuk HP ini dan mengirimnya ke server JoyoFit bersama platform (Android atau iOS) dan ID instalasi aplikasi. Token disimpan di database Cloudflare, terkait ke ID akun JoyoRogo-mu, dan didaftarkan ulang saat aplikasi dibuka bila notifikasi sudah diizinkan.",
            "Cara kirim: server JoyoFit menyerahkan pemberitahuan ke layanan push Expo, yang meneruskannya lewat Google Firebase Cloud Messaging (FCM) di Android dan Apple Push Notification service (APNs) di iPhone. Judul dan isi pemberitahuan (misalnya nama dan kabar orangnya) ikut melewati Expo, Google, dan Apple. Di HP Android tanpa layanan Google, push tidak tersedia.",
            "FCM hanya dipakai untuk mengantar push ini. JoyoFit tidak memakai Firebase untuk analitik, iklan, atau pelaporan crash.",
            "Berhenti: matikan notifikasi JoyoFit di pengaturan sistem untuk menghentikan pemberitahuan. Keluar dari akun JoyoRogo di JoyoFit meminta server menghapus token HP itu (bila HP sedang online); token yang dinyatakan tidak berlaku oleh Expo, Google, atau Apple dihapus server; dan menghapus akun JoyoRogo menghapus semua tokenmu.",
          ]}
        />
      </Block>

      <Block title="Statistik situs">
        <p>
          Situs fit.joyorogo.com (bukan aplikasinya) memakai RevKlik, layanan statistik web, untuk menghitung
          pengunjung dan klik pada tombol seperti Gabung tester. RevKlik mencatat halaman yang dibuka, tautan yang
          diklik, seberapa jauh halaman digulir, asal kunjungan, jenis perangkat, browser, bahasa, ukuran layar
          dan zona waktu, serta pengenal acak yang disimpan di browser-mu. Isinya tidak dipakai untuk iklan dan
          tidak dijual. Kamu bisa mematikannya dengan pemblokir pelacak atau dengan menghapus data situs di
          browser.
        </p>
      </Block>

      <Block title="Pihak ketiga">
        <List
          items={[
            "Open-Meteo: prakiraan cuaca dan pencarian kota (bagian Cuaca).",
            "Broadcom (glpals.com): data bantuan satelit (bagian Lokasi).",
            "FOSSGIS e.V. (OSRM) dan Nominatim (OpenStreetMap): jalur rute dan pencarian tempat untuk Loop dari rumah (bagian Loop dari rumah).",
            "Cloudflare: tempat cloud JoyoFit dan situs ini berjalan.",
            "JoyoRogo, Google dan Apple: login dan layanan JoyoRogo (bagian Cloud dan Masuk dengan Apple).",
            "Expo, Google (Firebase Cloud Messaging) dan Apple (APNs): mengantar notifikasi push Keluarga (bagian Notifikasi push).",
            "Apple: Apple Health (menulis, dan membaca satu kali saat impor), Masuk dengan Apple, dan geocoding nama tempat di iPhone.",
            "Strava: tujuan unggahan olahraga bila kamu menyambungkannya (bagian Strava).",
            "Penyedia AI pilihanmu (misalnya Anthropic untuk Claude, OpenAI untuk ChatGPT): menerima data yang dibaca saat kamu bertanya, hanya bila kamu menyambungkan koneksi AI (bagian Koneksi AI).",
            "RevKlik: statistik pengunjung situs ini (bagian Statistik situs).",
          ]}
        />
        <p>Tidak ada iklan dan tidak ada penjualan data. Data tidak dipakai untuk iklan atau profil iklan. Semua yang dikirim aplikasi dan situs ini lewat internet memakai HTTPS (TLS).</p>
      </Block>

      <Block id="hapus" title="Penghapusan data">
        <List
          items={[
            "Di HP: hapus instalasi JoyoFit atau pilih Pengaturan Android, Aplikasi, JoyoFit, Penyimpanan, Hapus data. Semua data lokal terhapus. Atau pilih Hapus dari HP ini saat keluar dari akun: itu menghapus data JoyoFit dari HP tanpa melepas jam. Lepas jam dengan Forget pairing di aplikasi.",
            "Di Health Connect (Android) atau Apple Health (iPhone): hapus data yang ditulis JoyoFit lewat aplikasi Health Connect atau aplikasi Kesehatan.",
            "Di Strava: Putuskan Strava di aplikasi, atau cabut aplikasi di strava.com; token dihapus dari server JoyoRogo saat itu juga (bila JoyoRogo masih memakai sambungan yang sama, izin di Strava baru dicabut saat keduanya diputus).",
            "Daftar tunggu Strava atau iPhone: email ke alamat kontak di halaman ini dengan subjek Hapus daftar tunggu JoyoFit (lihat bagian Daftar undangan).",
            "Akun dan cloud: di aplikasi, Settings, Health Connect and cloud (di iPhone: Apple Health and cloud), bagian Sinkron cloud, ketuk Delete JoyoRogo account lalu konfirmasi. Ini langsung menghapus data cloud JoyoFit-mu (langkah, tidur, jam, berkas impor, token Strava), pengaturan, template, rute, dan data kesehatan yang ikut akun, olahraga di cloud, tautan dan ringkasan Keluarga, token push, dan akun JoyoRogo-mu beserta datanya di JoyoRogo, termasuk postingan, komentar, dan kudos. Akun JoyoRogo dipakai bersama, jadi akun itu juga hilang di JoyoRogo. Akun yang masuk dengan Apple diminta konfirmasi Apple dulu, lalu izin Masuk dengan Apple dicabut. Data di HP-mu tidak ikut terhapus.",
            "Hanya data cloud: di aplikasi, Settings, Health Connect and cloud (di iPhone: Apple Health and cloud), bagian Sinkron cloud, ketuk Delete cloud data. Olahraga, langkah, tidur, pengaturan, template, rute, dan data kesehatan (termasuk siklus) di cloud terhapus dan sinkron otomatis dimatikan, jadi tidak ada yang diunggah lagi sampai kamu menyalakannya kembali. Akun, postingan, Keluarga, dan data di HP-mu tetap ada.",
            "Postingan dan komentar Social: hapus satu per satu di joyorogo.com lewat menu postingan atau komentar, atau hapus semuanya sekaligus dengan Hapus semua data saya di halaman Profil joyorogo.com (akunnya tetap ada). Menghapus akun JoyoRogo juga menghapusnya.",
            "Token push: keluar dari akun JoyoRogo di JoyoFit menghapus token push HP itu dari server, dan menghapus akun menghapus semua tokenmu (lihat Notifikasi push). Mematikan notifikasi JoyoFit di pengaturan sistem menghentikan pemberitahuan.",
            "Olahraga cloud di web: di joyorogo.com, buka halaman Latihan JoyoFit untuk menghapus satu olahraga atau semuanya. Olahraga yang dihapus di sana ikut hilang dari HP-mu saat HP berikutnya sinkron.",
            <>
              Tanpa aplikasi: kirim email dari alamat akun yang kamu pakai ke <Mail /> dengan subjek{" "}
              <span className="font-semibold">Hapus data cloud JoyoFit</span>. Kami menghapus semua data JoyoFit di
              cloud yang terkait akunmu dan mengonfirmasi lewat email, paling lambat 30 hari.
            </>,
          ]}
        />
        <p className="text-muted-foreground">
          Data cloud disimpan sampai kamu menghapusnya, tanpa kedaluwarsa otomatis. Postingan dan komentar Social
          disimpan di JoyoRogo sampai kamu menghapusnya atau akunmu dihapus. Halaman ini juga alamat permintaan
          penghapusan data untuk JoyoFit di Google Play dan App Store.
        </p>
      </Block>

      <Block title="Anak-anak">
        <p>JoyoFit untuk pengguna berusia 18 tahun ke atas dan tidak sengaja mengumpulkan data anak.</p>
      </Block>

      <Block title="Perubahan">
        <p>
          Kalau cara JoyoFit memakai data berubah, halaman ini diperbarui sebelum perubahan dirilis, dengan
          tanggal baru di atas. Riwayat perubahannya ada di{" "}
          <a
            href={`${GITHUB_URL}/commits/master/site/src/Privasi.tsx`}
            className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
            target="_blank"
            rel="noopener"
          >
            GitHub
          </a>
          .
        </p>
      </Block>
    </div>
  );
}

function English() {
  return (
    <div lang="en" className="space-y-3">
      <Block title="Summary">
        <List
          items={[
            "Watch data (steps, heart rate, SpO2, sleep, workouts) is stored on your phone. Your health data does not leave the phone unless you choose to share it through Keluarga (family monitoring) or turn on cloud sync.",
            "The JoyoFit cloud is optional and only starts after you sign in with a JoyoRogo account.",
            "On iPhone, watch data is written to Apple Health only if you turn that on. JoyoFit reads Apple Health once, only when you tap Import history from Apple Health.",
            "No ads, no advertising, analytics or crash-reporting SDKs, and your data is not sold. Firebase Cloud Messaging is used only to deliver Keluarga push notifications.",
            "Everything the app sends over the internet uses HTTPS (TLS).",
            "Posts, comments and photos in the Social tab live on JoyoRogo and only appear when you post them yourself.",
            "The AI connection is optional (Pro only): only if you connect Claude, ChatGPT or another MCP app can it read your data, and only when you ask a question there. You can disconnect any time in Settings, Koneksi AI.",
            "The source code is open (AGPL-3.0), so you can check everything stated here.",
          ]}
        />
        <p className="text-muted-foreground">
          JoyoFit is made and run by Dzulfikar in Malang, Indonesia. Questions or data deletion requests: <Mail />.
          Last updated {UPDATED_EN}.
        </p>
      </Block>

      <Block title="Data on your phone (default)">
        <p>
          JoyoFit talks to your Huawei or Honor watch directly over Bluetooth, without Huawei Health and without
          an intermediary server. What it receives is stored in a database on your phone (<Code>joyofit.db</Code>)
          and in the app&apos;s private storage: steps, distance, calories, heart rate, SpO2, resting heart rate,
          sleep, workouts with the GPS route the watch recorded, stress, HRV, skin temperature and other metrics
          the watch reports; what you enter yourself (profile, cycle calendar if enabled, weight and blood
          pressure, alarms); the watch&apos;s Bluetooth address, name, model and pairing key; and your settings.
          Android auto-backup is off for the app (<Code>allowBackup=false</Code>). On iPhone the same data lives
          in the app&apos;s private storage; JoyoFit reads Apple Health only for the one-time history import you start yourself.
          JoyoFit has no ads, advertising ID, Sentry, or analytics or crash-reporting SDK. The only Google service in it
          is Firebase Cloud Messaging (FCM), used only to deliver Keluarga push notifications (see Push notifications).
        </p>
      </Block>

      <Block title="JoyoFit cloud (optional)">
        <p>
          After you sign in with your JoyoRogo account (Google sign-in, or Sign in with Apple on iPhone, through JoyoRogo) under Settings, Health Connect and
          cloud (Apple Health and cloud on iPhone), in the Sinkron cloud section, uploads run automatically, about two seconds after each sync and when the app opens. The first
          upload sends your whole history. Without signing in, nothing is uploaded.
        </p>
        <p>
          <span className="font-semibold">Uploaded:</span> the watch&apos;s Bluetooth address, name, model and
          software version; per-minute steps, calories, distance, heart rate, SpO2 and resting heart rate; sleep
          segments and stages. Workouts are covered under Workouts (JoyoRogo Pro) below.
        </p>
        <p>
          <span className="font-semibold">JoyoRogo Pro only, so several phones show the same thing:</span> the
          settings that follow the account (profile: height, weight, birth year, sex, step goal; daily goals, theme,
          language, temperature unit and the weather city&apos;s name, the cycle calendar switch and its reminder
          switches, the sleep report, Healthy Living), sticker templates you made, routes you saved, HRV, sleep
          scores, other health metrics the watch reports, and cycle data (periods and daily entries). Cycle data is
          health data: it only syncs while the Sync cycle data switch is on (it is on by default for Pro), and turning
          it off deletes the copy in the cloud.{" "}
          <span className="font-semibold">Not uploaded:</span> logged weight and blood pressure, meals,
          notifications, call data, weather location, the watch&apos;s serial number, raw beat intervals (RRI), the
          watch pairing key, and settings that belong to one phone (Wi-Fi only, automatic sync, permissions, the
          Health Connect or Apple Health connection). Watch pairing does not go to the cloud: on another phone your
          history shows, but the watch has to be paired there.
        </p>
        <p>
          The data is stored in Cloudflare database and storage under the developer&apos;s Cloudflare account,
          keyed by your JoyoRogo account ID. It is not sent to anyone else. Signing out stops uploads and deletes
          nothing in the cloud. Data on the phone is never deleted unless you choose it: when you sign out, the app
          asks whether to delete it from the phone, and if it is not all in the cloud yet (a Free account, or an
          unfinished upload) it warns that the data exists only on the phone. If another account signs in on a
          phone that still holds the previous account&apos;s data, sync stops until you choose to keep that data
          apart (it is never uploaded to the new account) or delete it from the phone. The app has buttons to
          delete the cloud data or the account (see Deleting your data). Everything the app sends to this server goes over HTTPS (TLS).
        </p>
        <p className="font-semibold">Workouts (JoyoRogo Pro):</p>
        <p>
          For a JoyoRogo Pro account signed in inside JoyoFit, every workout is uploaded as one compressed file
          per workout. It holds the workout summary, the GPS route, heart rate, altitude, speed, cadence, stride
          length and power, and the analysis JoyoFit derives from them. These files are kept in JoyoRogo&apos;s
          Cloudflare storage (a database for the list and object storage for the files), private to your
          account, and shown on joyorogo.com to the same login. Free accounts upload no workouts: they stay on the
          phone. Upload can be limited to Wi-Fi in Settings, Health Connect and cloud (Apple Health and cloud on iPhone), Sinkron cloud section, which also shows an estimate of what is
          waiting. The other data above (steps, heart rate, sleep, devices) stays in JoyoFit&apos;s own cloud
          database.
        </p>
        <p>
          After signing in on a new phone, the app reads your workouts back from the cloud and restores them. A
          workout you delete on one phone or on joyorogo.com is removed from your other phones too. Your
          cloud workouts are never sold and not used for ads or to train models. They are separate from what you
          share in a JoyoRogo post, which stays a snapshot you choose.
        </p>
        <p>
          While signed in, JoyoFit also talks to JoyoRogo (<Code>api.joyorogo.com</Code>): it reads today&apos;s
          meals, your profile and latest weight to show calories on the watch, writes meals you quick-log on the
          watch, and sends the last three days of daily scores (recovery, strain, sleep, readiness). For today it also
          sends the body metrics JoyoFit has computed: hours slept last night, resting heart rate, overnight HRV and
          its status, VO2max, training status and load ratio, and the recovery time left; a metric that cannot be computed yet
          is not sent. JoyoRogo&apos;s policy covers that data:{" "}
          <a
            href="https://joyorogo.com/privasi"
            className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
          >
            joyorogo.com/privasi
          </a>
          . The sign-in component may contact JoyoRogo to check the session whenever the app opens, even if you
          have not signed in; that request carries no health data.
        </p>
      </Block>

      <Block title="Health Connect (write only)">
        <p>
          If you turn it on, JoyoFit copies watch data into Health Connect so other apps you allow can read it:
          steps, distance, active calories, heart rate, resting heart rate, blood oxygen, sleep with stages, and
          exercise sessions (no GPS route). JoyoFit never reads Health Connect and holds no read permission.
          Health Connect data is not sold, not used for ads or ad profiling, not sent to any server by this feature
          and not shared with third parties. Permissions can be revoked at any time in Health Connect.
        </p>
      </Block>

      <Block title="Apple Health (iPhone, write and one-time import)">
        <p>
          On iPhone, if you turn it on under Settings, JoyoFit copies watch data into Apple Health (HealthKit) so
          other apps you allow can read it. Permission is asked through Apple Health&apos;s own dialog and can be
          revoked at any time in the Health app (Sharing, Apps, JoyoFit) or iPhone Settings.{" "}
          <span className="font-semibold">Written:</span> steps, walking and running distance, active energy,
          heart rate, resting heart rate, blood oxygen, sleep analysis with stages, workouts, and the GPS route of
          workouts the watch recorded. <span className="font-semibold">Read:</span> only when you tap Import history
          from Apple Health in Settings. Then JoyoFit asks for read permission for steps, heart rate, resting heart
          rate, sleep, workouts, blood oxygen (SpO2) and active energy, and reads the history Huawei Health saved
          there, once. It does not ask for read permission at any other time, and data JoyoFit wrote itself is not
          read back. What is read stays on your phone and is not sent to any server or used for ads. Apple Health data
          is not sold, not used for advertising or ad profiling, not used for research or analytics, and not shared
          with third parties. To remove what JoyoFit wrote, delete it in the Health app.
        </p>
      </Block>

      <Block title="Sign in with Apple (iPhone)">
        <p>
          On iPhone you can sign in to your JoyoRogo account with Apple as well as Google. Apple hands the app an
          identity token, which JoyoFit passes to the JoyoRogo server (<Code>api.joyorogo.com</Code>) to be
          verified with Apple. What is received: your Apple user ID for this account, your email address (Apple&apos;s
          private relay address if you choose Hide My Email), and your name only if you allow it and only the first
          time. It is used only to create and recognize your JoyoRogo account, not for advertising, and not shared.
          When the account is deleted, JoyoFit asks Apple to revoke the sign-in grant, so JoyoFit also disappears
          from the Sign in with Apple list in your Apple ID.
        </p>
      </Block>

      <Block title="Strava (optional, free)">
        <p>
          If you connect Strava under Settings, Strava (after signing in with your JoyoRogo account), JoyoFit sends
          workouts from your watch to your own Strava account. It asks for one permission only: uploading
          activities (<Code>activity:write</Code>). The workout file (time, type, GPS route, distance, calories,
          heart rate) goes straight from your phone to Strava, only for workouts that finish after you connect or
          that you send yourself with Send to Strava; history imported from Huawei Health is never sent
          automatically. Your Strava tokens and athlete ID are kept on the JoyoRogo server (the same account you
          sign in with in JoyoFit) so the phone can upload; JoyoFit and JoyoRogo use one Strava application, so if you
          also connect Strava in JoyoRogo the connection is shared, and disconnecting in one does not disconnect the
          other. Workout files do not pass through or stay on the JoyoFit server. JoyoFit does not read data from
          Strava, does not show Strava data to anyone else, and does not use it for analytics, ads or AI. The
          fit.joyorogo.com line in the activity description is off by default. Disconnect Strava in the app and
          JoyoFit stops using your connection; the tokens are deleted and the access revoked on Strava once JoyoRogo
          is not using it either. Revoke the app on strava.com (Settings, My Apps) and the tokens for both JoyoFit and
          JoyoRogo are deleted immediately; activities already on Strava stay yours and are managed on Strava.
        </p>
      </Block>

      <Block id="koneksi-ai-en" title="AI connection (optional, Pro)">
        <p>
          With the optional AI connection you can connect Claude, ChatGPT or another MCP app to your JoyoRogo
          account. The connection is made in that AI app, through a consent page on joyorogo.com. Once you agree,
          your JoyoRogo and JoyoFit data is sent to the AI provider you chose:
        </p>
        <List
          items={[
            "What can be read, per the permissions you agree to: your food diary, weight, workouts from the watch, sleep and recovery metrics (sleep, resting heart rate, HRV, VO2max, training status, recovery time), and your profile and targets.",
            "It is sent only when you ask a question in your own account in that AI app. Access is read-only: the AI app cannot change or delete anything, and only a Pro account can use it.",
            "You can disconnect at any time in Settings, Koneksi AI (or on joyorogo.com). Disconnecting is immediate: that app cannot read anything any more.",
            "JoyoRogo keeps an audit log of what was read (the tool name and the date range, not the data itself) for 90 days, and you can see it in the Koneksi AI screen.",
            "GPS routes and Strava data are never shared through this connection.",
            "Once the data reaches the AI provider, the provider's own privacy terms apply, not JoyoFit's or JoyoRogo's. Read them before you connect.",
          ]}
        />
        <p>
          What the AI answers is not medical advice. For health decisions, ask a health professional. Without the AI
          connection, no data is sent to an AI provider.
        </p>
      </Block>

      <Block id="social-en" title="Social: posts, comments and photos">
        <p>
          The Social tab in the app shows the JoyoRogo feed and needs a JoyoRogo sign-in. Nothing is posted
          automatically: only what you write or share yourself. Everything is stored on JoyoRogo&apos;s servers
          (Cloudflare), not on the JoyoFit server.
        </p>
        <List
          items={[
            "Posts, comments and photos: captions, comments (up to 280 characters) and photos attached to a post are stored in your JoyoRogo account and shown in the feed to the people allowed to see them.",
            "Visible profile: your JoyoRogo name, profile photo and handle appear with your posts and comments, in the kudos and follower lists, and your bio if you fill one in.",
            "Watch workouts: through Share to JoyoRogo on the workout screen you post a workout summary. According to the switches you choose (Heart-rate data, Route, Comparison with earlier workouts), the post can also carry the GPS route, the heart-rate chart and the workout analysis. The summary is visible to the audience you choose; the detail (map, charts, splits, zones) is visible to you and to JoyoRogo Pro members.",
            "Who can see it: Group (the default) is only people who share a JoyoRogo group with you; Public can be seen by anyone on JoyoRogo and needs your JoyoRogo profile to be public. Other users can give kudos, comment, report and block.",
            "A post is a separate copy of your workout: deleting the workout on the phone or in the JoyoFit cloud does not delete the post.",
            "Delete: delete your posts or comments on joyorogo.com from the post or comment menu (the author of a post can also delete other people's comments on it). Deleting a post also deletes its kudos, comments, route, charts and photos. Deleting your JoyoRogo account deletes all your posts, comments and kudos. Posts and comments are kept until you delete them or your account is deleted.",
          ]}
        />
        <p className="text-muted-foreground">
          JoyoRogo&apos;s rules for the feed and groups are at{" "}
          <a
            href="https://joyorogo.com/privasi"
            className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
          >
            joyorogo.com/privasi
          </a>
          .
        </p>
      </Block>

      <Block id="waitlist-en" title="Strava and iPhone invite lists">
        <p>
          fit.joyorogo.com/strava and fit.joyorogo.com/iphone have waitlist forms. The app is not involved; only this
          site.
        </p>
        <List
          items={[
            "What is stored: the list (Strava or iPhone), the email you enter, your Strava profile name or link (Strava list), your watch model if you enter one (iPhone list), a status (pending at first), and the time you signed up and the time of the last update.",
            "Why: only to invite you: to enable your Strava access when a slot is free, or to add your email as a TestFlight tester, and to tell you by email. It is not used for marketing, not sold and not shared. The Apple ID email for TestFlight is entered into the developer's App Store Connect so that Apple sends the invitation.",
            "Where: a Cloudflare D1 database in the developer's Cloudflare account, readable only by the owner through a secret token. The form sends no email or field to RevKlik (site analytics).",
            "Rate limit: the server counts submissions per hour from your IP address using a one-way hash that is only valid for that hour, not the IP itself, and deletes the count within a few hours.",
            <>
              Delete: email <Mail /> from the address you signed up with, subject{" "}
              <span className="font-semibold">Hapus daftar tunggu JoyoFit</span> (delete JoyoFit waitlist). We delete the row and
              confirm by email, within 30 days. After you are given access, the entry is kept until you ask for deletion.
            </>,
          ]}
        />
      </Block>

      <Block title="Weather">
        <p>
          Off by default. When on, JoyoFit requests a forecast from Open-Meteo when the watch connects and
          periodically, also while the app is closed as long as the watch is connected. It sends coordinates
          rounded to two decimals (about 1 km), with no device ID or API key; Open-Meteo also sees your IP address.
          City search sends the city name to Open-Meteo&apos;s geocoding service. The location comes from the phone
          (location permission) or from a city you pick. The last phone location and its place name are kept on the
          phone for reuse; the place name is looked up with Android&apos;s built-in Geocoder. On iPhone, JoyoFit asks for location only while
          the app is in use (no background location), at about one kilometer of accuracy because the weather only
          needs the city; the place name is looked up with Apple&apos;s geocoding service, which receives those
          coordinates. Open-Meteo still gets only the rounded coordinates.
        </p>
      </Block>

      <Block title="Location and GPS">
        <p>
          When an outdoor workout starts on the watch, the watch asks for the phone&apos;s GPS. JoyoFit reads the
          phone&apos;s GPS during that workout and sends the position only to the watch over Bluetooth; the phone
          does not store or upload it. JoyoFit explains this before asking for precise location and does not ask for
          background location. The GPS track the watch recorded is downloaded to the phone and shown as a route. It leaves the phone
          in two cases only: it is uploaded if you use cloud sync with JoyoRogo Pro, and it is shared when you post a workout with a route to
          JoyoRogo (Share to JoyoRogo, Route switch on) or send it to Strava. Weather uses only a location rounded to about 1 km (see
          Weather). When the watch asks for satellite-assist (AGPS) data, the phone downloads
          the public Broadcom file over HTTPS from <Code>gllto.glpals.com</Code>, a fixed address. JoyoFit adds no
          location or ID, but that server sees your IP address. JoyoFit does not contact Huawei servers for this;
          other kinds of assist data the watch may ask for are declined.
        </p>
      </Block>

      <Block id="loop-en" title="Loop from home">
        <p>
          When you tap Find a route, JoyoFit sends the start point and a few points around it (full-precision coordinates, within a few
          kilometers of the start) to the OSRM routing service run by FOSSGIS e.V. (<Code>routing.openstreetmap.de</Code>). No account, device
          ID or API key is sent; the service sees your IP address and the app name (JoyoFit) in the request header. Your workout GPS
          tracks are not sent anywhere for this feature: new streets are counted on the phone from workouts already stored on the phone.
        </p>
        <p>
          The Home point is stored on this phone only (it does not sync to the cloud) and is removed when you delete all local data. Precise
          location is requested only when you choose My location, and is read only while the loop screen is open. Searching a place to set
          Home sends the text you type to Nominatim (OpenStreetMap).
        </p>
      </Block>

      <Block title="Notifications, calls, photos">
        <p>
          <span className="font-semibold">Notifications:</span> off by default and need notification access that
          you grant in Android settings. Once on, JoyoFit reads title, text and app name of incoming notifications
          and sends them to the watch over Bluetooth. All non-system apps are forwarded unless you switch them off
          in the app list. Notifications are not written to disk and never sent over the internet. On iPhone, JoyoFit cannot and does
          not read other apps&apos; notifications; the watch shows the iPhone&apos;s own notifications through iOS&apos;s
          built-in Bluetooth notification service (ANCS) if you allow it in iPhone Settings.
        </p>
        <p>
          <span className="font-semibold">Calls:</span> the Google Play version uses the phone-state permission so
          the watch can show that the phone is ringing (it shows &quot;Incoming call&quot;) and the answer-calls
          permission for the watch&apos;s accept and reject buttons, both only if you enable them. It does not read
          your call log or contacts and does not send SMS. Self-builds from source can,
          with your permission, also read the caller&apos;s number and contact name and send the SOS text message
          the watch asks for.
        </p>
        <p>
          <span className="font-semibold">App calls:</span> WhatsApp, Telegram, Signal, Meet and LINE calls are
          recognised from their call notifications, using the same notification access: the caller name and app
          name from that notification go to the watch over Bluetooth, and the watch&apos;s reject or accept button
          presses the matching button on the notification. Only while Show incoming calls is on and the app is not
          switched off in the app list. Nothing is stored or sent off the phone.
        </p>
        <p>
          <span className="font-semibold">Watch-face photos:</span> a photo you pick is cropped on the phone and
          sent to the watch over Bluetooth. It is not uploaded to any server.
        </p>
        <p>
          <span className="font-semibold">Workout share images and FIT files:</span> share images are made on the
          phone. A gallery or camera photo (camera permission is asked only when you tap Take photo) is used only as
          the image background and is not uploaded anywhere; the image goes only to the app you share it to, or the
          clipboard when you copy it. A .FIT file you open with JoyoFit is read on the phone and stored as an
          imported workout, which is never uploaded automatically to Strava, the cloud or Health Connect.
        </p>
        <p>
          <span className="font-semibold">Support report:</span> only when you tap Report on GitHub or Share, JoyoFit
          builds a summary (app version, phone make and model, Android version, watch model and version) and a
          connection log. Bluetooth addresses and the serial number are removed, but the log can contain other
          text, so read it before sending. Nothing is sent automatically.
        </p>
      </Block>

      <Block id="keluarga-en" title="Family monitoring (optional)">
        <List
          items={[
            "This is off until you accept an invite yourself. The person watching (the watcher) needs a JoyoRogo account; the person being watched is never charged.",
            "Only daily summaries are sent: steps, resting heart rate, last night's sleep, blood oxygen (SpO2) if you turn it on, and when the watch last connected plus its battery. Never sent: location, workout routes, per-minute heart rate, food and photos.",
            "You consent to each category with its own switch and can change it at any time. SpO2 is off by default.",
            "If you pause or stop, the watcher immediately cannot see anything and the summaries already sent are deleted at once.",
            "History is kept for 30 days for Free watchers and 90 days for Pro watchers, then deleted automatically.",
            "There is no covert mode: you can always see who is watching and when they last viewed your data. An invite is a link or an 8-character code that is valid for 48 hours and works once.",
            "The watcher can receive push notifications (see Push notifications below), and email if Pro, when your data looks unusual (for example no steps by midday, or the watch has not synced for a long time). These are not a doctor's diagnosis.",
            "Deleting your JoyoRogo account deletes every link and summary, both as the watched person and as a watcher.",
            "Not a medical device and not real-time: data arrives after the watch syncs and the phone is online, so it can be late by minutes to hours. On iPhone, iOS decides when background uploads run, so it can be later still. Do not rely on it in an emergency; call the person or 112.",
          ]}
        />
        <p className="text-muted-foreground">
          The invite page fit.joyorogo.com/keluarga does not send the invite code to the site analytics.
        </p>
      </Block>

      <Block id="push-en" title="Push notifications (Keluarga)">
        <List
          items={[
            "Used only for Keluarga: notifications to a watcher when your data looks unusual, and a poke that asks how you are. Not for ads or marketing.",
            "When you allow notifications in Keluarga, the app creates a push token (an Expo token) for this phone and sends it to the JoyoFit server together with the platform (Android or iOS) and an app-installation ID. The token is stored in a Cloudflare database, tied to your JoyoRogo account ID, and registered again when the app opens if notifications are already allowed.",
            "Delivery: the JoyoFit server hands the notification to Expo's push service, which forwards it through Google Firebase Cloud Messaging (FCM) on Android and Apple Push Notification service (APNs) on iPhone. The title and text of the notification (for example the person's name and their update) pass through Expo, Google and Apple. On an Android phone without Google services, push is not available.",
            "FCM is used only to deliver this push. JoyoFit does not use Firebase for analytics, ads or crash reporting.",
            "Stopping: turn off JoyoFit notifications in system settings to stop them. Signing out of your JoyoRogo account in JoyoFit asks the server to delete that phone's token (when the phone is online); tokens that Expo, Google or Apple report as no longer valid are deleted by the server; and deleting your JoyoRogo account deletes all your tokens.",
          ]}
        />
      </Block>

      <Block title="Site analytics">
        <p>
          The site fit.joyorogo.com (not the app) uses RevKlik, a web analytics service, to count visitors and
          clicks on buttons such as Join testers. RevKlik records the pages opened, links clicked, how far a
          page is scrolled, where the visit came from, device type, browser, language, screen size and time
          zone, plus a random identifier stored in your browser. It is not used for advertising and is not
          sold. A tracker blocker, or clearing the site&apos;s data in your browser, turns it off.
        </p>
      </Block>

      <Block title="Third parties">
        <p>
          Open-Meteo (weather), Broadcom (satellite-assist data), FOSSGIS e.V. (OSRM) and Nominatim (OpenStreetMap) (route paths and place search for Loop from home), Cloudflare (hosting of the cloud and this
          site), JoyoRogo, Google and Apple (sign-in), Apple (Apple Health write and one-time import read, and place-name geocoding on iPhone), Strava (upload destination when you connect it), the AI provider you choose, for example Anthropic for Claude or OpenAI for ChatGPT (receives the data read while you ask questions, only if you connect the AI connection), Expo, Google (Firebase Cloud Messaging) and Apple (APNs) (delivery of Keluarga push notifications), RevKlik (visitor
          statistics for this site). No ads and no sale of data. Data is not used for advertising or
          ad profiling. Everything the app and this site send over the internet uses HTTPS (TLS).
        </p>
      </Block>

      <Block title="Deleting your data">
        <List
          items={[
            "On the phone: uninstall JoyoFit, or Android Settings, Apps, JoyoFit, Storage, Clear data. Or choose Delete from this phone when you sign out: that removes JoyoFit data from the phone without releasing the watch. Use Forget pairing in the app to release the watch.",
            "In Health Connect (Android) or Apple Health (iPhone): delete what JoyoFit wrote in the Health Connect or Health app.",
            "Strava: Disconnect Strava in the app, or revoke the app on strava.com; the tokens are deleted from the JoyoRogo server at once (if JoyoRogo still uses the same connection, the access on Strava is revoked when both are disconnected).",
            "Strava or iPhone waitlist: email the contact address on this page with the subject Hapus daftar tunggu JoyoFit (see the invite lists section).",
            "Account and cloud: in the app, Settings, Health Connect and cloud (Apple Health and cloud on iPhone), Sinkron cloud section, tap Delete JoyoRogo account and confirm. It immediately deletes your JoyoFit cloud data (steps, sleep, devices, imported files, Strava tokens), the settings, templates, routes and health data that follow your account, your cloud workouts, your Keluarga links and summaries, your push tokens, and your JoyoRogo account with its JoyoRogo data, including posts, comments and kudos. The JoyoRogo account is shared, so it is gone in JoyoRogo as well. An account that signs in with Apple asks you to confirm with Apple first, and the Sign in with Apple grant is revoked. Data on your phone is not deleted.",
            "Cloud data only: in the app, Settings, Health Connect and cloud (Apple Health and cloud on iPhone), Sinkron cloud section, tap Delete cloud data. It wipes your workouts, steps, sleep, settings, templates, routes and health data (including cycle data) from the cloud and turns automatic sync off, so nothing is uploaded again until you switch it back on. Your account, posts, Keluarga and the data on your phone stay.",
            "Social posts and comments: delete them one by one on joyorogo.com from the post or comment menu, or delete all of them at once with Hapus semua data saya on the joyorogo.com Profil page (the account stays). Deleting your JoyoRogo account removes them too.",
            "Push token: signing out of your JoyoRogo account in JoyoFit deletes that phone's push token from the server, and deleting the account deletes all your tokens (see Push notifications). Turning off JoyoFit notifications in system settings stops the notifications.",
            "Cloud workouts on the web: on joyorogo.com, open the JoyoFit workouts page (Latihan JoyoFit) to delete a single workout or everything. A workout deleted there is also removed from your phones the next time they sync.",
            <>
              Without the app: email <Mail /> from the address of the account you signed in with, subject{" "}
              <span className="font-semibold">Hapus data cloud JoyoFit</span> (delete JoyoFit cloud data). We delete
              everything JoyoFit holds for your account and confirm by email, within 30 days.
            </>,
          ]}
        />
        <p className="text-muted-foreground">
          Cloud data is kept until you delete it, with no automatic expiry. Social posts and comments are kept on
          JoyoRogo until you delete them or your account is deleted. This page is also the data deletion
          request page for JoyoFit on Google Play and the App Store.
        </p>
      </Block>

      <Block title="Children and changes">
        <p>
          JoyoFit is for users aged 18 and over and does not knowingly collect children&apos;s data. When JoyoFit
          changes how it uses data, this page is updated before the change ships, with a new date at the top.
        </p>
      </Block>
    </div>
  );
}

export function PrivasiPage() {
  return (
    <section data-section="privasi" className="py-12 md:py-16">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
        <a
          href="/"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Kembali ke beranda
        </a>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
          Kebijakan privasi JoyoFit
        </h1>
        <p className="mt-3 text-muted-foreground">
          Bahasa Indonesia di bawah, <a href="#english" className="font-semibold underline underline-offset-4">English version</a> setelahnya.
        </p>
        <div className="mt-8">
          <Indonesian />
        </div>
        <h2 id="english" className="mt-14 text-2xl font-extrabold tracking-tight md:text-3xl">
          Privacy policy (English)
        </h2>
        <div className="mt-6">
          <English />
        </div>
      </div>
    </section>
  );
}
