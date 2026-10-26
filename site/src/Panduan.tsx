import { ArrowLeft, Check, ChevronDown, Users } from "lucide-react";

import {
  GITHUB_URL,
  IOS_TESTFLIGHT_LIVE,
  IOS_TESTFLIGHT_URL,
  STRAVA_PATH,
  TESTER_GROUP_URL,
  TESTER_OPTIN_URL,
  WATCH_REPORT_FORM_URL,
  goal,
} from "./lib";
import { JAM_BELUM_PAKE, JAM_BISA_DICOBA, JAM_SUDAH_DIUJI } from "./jam";
import { ButtonLink } from "./ui";

type Lang = "id" | "en";
type Pair<T = React.ReactNode> = { id: T; en: T };

const link = "font-semibold text-primary underline underline-offset-4 hover:text-primary/80";

function B({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold">{children}</span>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-[0.85em] font-semibold">{children}</code>;
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

function Steps({ items }: { items: readonly React.ReactNode[] }) {
  return (
    <ol className="mt-3 space-y-4">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-extrabold tabular-nums">
            {i + 1}
          </span>
          <p className="pt-0.5 text-[0.9375rem] leading-relaxed">{item}</p>
        </li>
      ))}
    </ol>
  );
}

function Block({
  id,
  title,
  children,
  tone = "bg-card",
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-20 rounded-3xl p-5 md:p-6 ${tone}`}>
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-[0.9375rem] leading-relaxed">{children}</div>
    </section>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-2 text-base font-bold">{children}</h3>;
}

function Chips({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {items.map((name) => (
        <li key={name} className="rounded-full bg-muted px-3 py-1 text-sm font-semibold">
          {name}
        </li>
      ))}
    </ul>
  );
}

const SECTIONS = [
  { key: "pasang", id: "1. Pasang JoyoFit", en: "1. Install JoyoFit" },
  { key: "awal", id: "2. Panduan awal di aplikasi", en: "2. The in-app setup guide" },
  { key: "sebelum", id: "3. Sebelum memasangkan jam", en: "3. Before pairing the watch" },
  { key: "pairing", id: "4. Pasangkan jam di JoyoFit", en: "4. Pair the watch in JoyoFit" },
  { key: "jam", id: "5. Jam yang didukung", en: "5. Supported watches" },
  { key: "izin", id: "6. Izin yang diminta", en: "6. Permissions" },
  { key: "fitur", id: "7. Sinkron, Strava, impor riwayat", en: "7. Sync, Strava, history import" },
  { key: "social", id: "8. Social dan berbagi", en: "8. Social and sharing" },
  { key: "coach", id: "9. Coach (Pro)", en: "9. Coach (Pro)" },
  { key: "faq", id: "10. Jika ada masalah", en: "10. Troubleshooting" },
] as const;

type FaqItem = { q: Pair<string>; a: Pair };

const FAQ: readonly FaqItem[] = [
  {
    q: { id: "Jam tidak muncul di daftar", en: "The watch does not show up in the list" },
    a: {
      id: (
        <>
          Jam hanya bisa terhubung ke satu HP atau aplikasi dalam satu waktu, dan jam yang sedang terhubung ke yang lain tidak
          muncul. Pastikan jam sudah dilepas dari Huawei Health (Unbind) dan tidak terhubung ke HP lain atau JoyoFit di HP lain.
          Nyalakan jam, dekatkan ke HP, nyalakan Bluetooth, lalu di tab <B>Watch</B> ketuk <B>Scan nearby devices</B> atau tarik
          layar ke bawah untuk menyegarkan daftar. Kalau izin Perangkat sekitar ditolak, aplikasi menawarkan <B>Open app settings</B>.
          Jam yang belum pernah dipasangkan juga bisa dicari lewat Scan; atau pasangkan dulu di Pengaturan Bluetooth Android.
        </>
      ),
      en: (
        <>
          A watch can only link to one phone or app at a time, and one that is connected elsewhere does not show up. Make sure it
          is unbound from Huawei Health and not connected to another phone or to JoyoFit on another phone. Turn the watch on,
          bring it close, turn Bluetooth on, then on the <B>Watch</B> tab tap <B>Scan nearby devices</B> or pull down to refresh
          the list. If the Nearby devices permission was denied, the app offers <B>Open app settings</B>. A watch that was never
          paired can also be found with Scan; or pair it first in Android Bluetooth settings.
        </>
      ),
    },
  },
  {
    q: { id: "Tersangkut di layar QR setelah reset jam", en: "Stuck on the QR screen after resetting the watch" },
    a: {
      id: (
        <>
          JoyoFit tidak memakai kode QR: pairing-nya lewat Bluetooth, lalu konfirmasi di layar jam. Layar QR itu datang dari jam,
          bukan dari JoyoFit, dan kami belum bisa memastikan perilakunya di tiap model (baru Watch Fit 4 Pro, Band 8, Band 11 Pro, dan Watch Fit 2 yang diuji).
          Yang bisa dicoba: pastikan jam tidak sedang terhubung ke HP atau aplikasi lain, buka tab <B>Watch</B> → <B>Scan nearby
          devices</B> (atau pasangkan di Pengaturan Bluetooth Android), ketuk <B>Connect</B>, lalu setujui permintaan di jam dalam
          30 detik. Kalau jam tetap tidak muncul, <a className={link} href={WATCH_REPORT_FORM_URL} target="_blank" rel="noopener">kirim laporan jam</a>{" "}
          dengan model jam dan apa yang terlihat di layarnya.
        </>
      ),
      en: (
        <>
          JoyoFit does not use QR codes: pairing goes over Bluetooth and is confirmed on the watch screen. The QR screen comes
          from the watch, not from JoyoFit, and we cannot yet say how it behaves on every model (only the Watch Fit 4 Pro, Band 8, Band 11 Pro and Watch Fit 2 have
          been tested). What to try: make sure the watch is not connected to another phone or app, open <B>Watch</B> → <B>Scan
          nearby devices</B> (or pair it in Android Bluetooth settings), tap <B>Connect</B>, then accept the prompt on the watch
          within 30 seconds. If it still does not appear, <a className={link} href={WATCH_REPORT_FORM_URL} target="_blank" rel="noopener">send a watch report</a>{" "}
          with the model and what the screen shows.
        </>
      ),
    },
  },
  {
    q: { id: "Muncul pesan “Could not connect to the watch”", en: "“Could not connect to the watch” appears" },
    a: {
      id: (
        <>
          Biasanya jam masih terhubung ke aplikasi atau HP lain (Huawei Health, atau JoyoFit di HP lain). Putuskan di sana dulu,
          biarkan layar jam menyala dan dekat dengan HP, lalu ketuk <B>Retry</B>. Kalau jam belum dikenal HP ini, JoyoFit
          menampilkan <B>Pair this watch with this phone?</B>: melanjutkan menggantikan pairing jam dengan HP atau aplikasi
          lain, yang lalu harus dipasangkan ulang.
        </>
      ),
      en: (
        <>
          Usually the watch is still connected to another app or phone (Huawei Health, or JoyoFit on another phone). Disconnect
          it there first, keep the watch awake and close to this phone, then tap <B>Retry</B>. If this phone does not know the
          watch yet, JoyoFit asks <B>Pair this watch with this phone?</B>: continuing replaces the watch&apos;s pairing with
          the other phone or app, which then has to pair again.
        </>
      ),
    },
  },
  {
    q: { id: "Koneksi sering putus", en: "The connection keeps dropping" },
    a: {
      id: (
        <>
          Nyalakan <B>Keep connected in the background</B> di Pengaturan → Background and sync. JoyoFit akan menyambung ulang
          sendiri setiap kali sambungan putus atau Bluetooth dinyalakan. Kalau HP-mu tetap mematikan JoyoFit di latar belakang,
          kecualikan JoyoFit dari penghemat baterai di pengaturan Android. Setelah kamu mengetuk <B>Disconnect</B>, JoyoFit
          berhenti menyambung ulang sampai kamu menyambungkannya lagi. Sambungan juga putus kalau Huawei Health atau HP lain
          mengambil alih jam.
        </>
      ),
      en: (
        <>
          Turn on <B>Keep connected in the background</B> under Settings → Background and sync. JoyoFit then reconnects on its
          own whenever the link drops or Bluetooth comes back on. If your phone still kills JoyoFit in the background, exempt it
          from battery saving in Android settings. After you tap <B>Disconnect</B>, JoyoFit stops reconnecting until you connect
          again. The link also drops if Huawei Health or another phone takes over the watch.
        </>
      ),
    },
  },
  {
    q: { id: "Notifikasi tidak sampai ke jam", en: "Notifications do not reach the watch" },
    a: {
      id: (
        <>
          Buka Pengaturan → Notifications and calls: <B>Notification access</B> harus <B>Granted</B> dan{" "}
          <B>Forward notifications to the watch</B> menyala. Pilih aplikasinya di <B>Notification apps</B>. Pakai build sendiri
          di Android 13 ke atas? Android memblokir akses ini sampai kamu membuka App info → menu tiga titik → <B>Allow restricted
          settings</B>.
        </>
      ),
      en: (
        <>
          Open Settings → Notifications and calls: <B>Notification access</B> must say <B>Granted</B> and{" "}
          <B>Forward notifications to the watch</B> must be on. Pick the apps under <B>Notification apps</B>. On a self-build
          with Android 13 or newer, Android blocks this access until you open App info → three-dot menu →{" "}
          <B>Allow restricted settings</B>.
        </>
      ),
    },
  },
  {
    q: { id: "Mau pindah ke HP lain", en: "Moving to another phone" },
    a: {
      id: "Jam hanya mengingat satu HP. Begitu dipasangkan di HP baru, HP lama harus memasangkannya ulang kalau mau dipakai lagi. Data yang sudah disinkron tetap ada di HP lama (dan di cloud kalau kamu memakainya).",
      en: "A watch remembers one phone. Once you pair it with the new phone, the old phone has to pair again to use it. Data already synced stays on the old phone (and in the cloud if you use it).",
    },
  },
  {
    q: {
      id: "Jam bilang data GNSS kedaluwarsa saat mulai olahraga luar ruangan",
      en: "The watch says GNSS data is expired when I start an outdoor workout",
    },
    a: {
      id: "Itu wajar, jam tidak rusak. GPS tetap jalan, hanya butuh 30 sampai 60 detik di luar ruangan: tunggu ikon GPS di jam sebelum mulai. Pesannya dari firmware jam dan tidak bisa kami ubah, karena data bantuan GPS jam Huawei hanya bisa datang dari Huawei Health. JoyoFit mengirim lokasi dan waktu HP untuk membantu titik GPS pertama.",
      en: "That is normal and the watch is not broken. GPS still works, it just needs 30 to 60 seconds outdoors: wait for the GPS icon on the watch before you start. The message comes from the watch firmware and we cannot change it, because a Huawei watch only gets its GPS assistance data from Huawei Health. JoyoFit sends the phone's location and time to help the first fix.",
    },
  },
  {
    q: { id: "Watch face apa yang bisa dipasang dari JoyoFit?", en: "Which watch faces can JoyoFit install?" },
    a: {
      id: (
        <>
          Photo face jalan: kamu memilih fotomu sendiri dan jam menggambar waktu serta datanya di atasnya. Face bawaan bisa
          dikustomisasi. Face buatan sendiri atau dari luar (berkas .hwt) yang tidak ditandatangani Huawei ditolak oleh jam
          (kode 100014) dan JoyoFit tidak bisa menandatanganinya; pasang lewat Huawei Health dengan HUAWEI ID yang punya izin
          designer. Langkahnya ada di{" "}
          <a className={link} href={`${GITHUB_URL}/blob/master/docs/watchfaces-signing.md#5-panduan-untuk-pengguna-bahasa-indonesia`} target="_blank" rel="noopener">
            panduan di GitHub
          </a>{" "}
          (bagian 5, Bahasa Indonesia). Langkah itu belum dibuktikan pengguna di firmware terbaru, dan setelah itu jam mungkin
          perlu disambungkan ulang ke JoyoFit.
        </>
      ),
      en: (
        <>
          The photo face works: you pick your own photo and the watch draws the time and data on top. Built-in faces can be
          customised. A custom or third-party face (.hwt file) that Huawei has not signed is rejected by the watch (code
          100014) and JoyoFit cannot sign it; install it through Huawei Health with a HUAWEI ID that has designer permission.
          The steps are in the{" "}
          <a className={link} href={`${GITHUB_URL}/blob/master/docs/watchfaces-signing.md#5-panduan-untuk-pengguna-bahasa-indonesia`} target="_blank" rel="noopener">
            guide on GitHub
          </a>{" "}
          (section 5, in Indonesian). No user has confirmed those steps on current firmware yet, and afterwards the watch may
          need to be reconnected to JoyoFit.
        </>
      ),
    },
  },
  {
    q: { id: "Fitur baru di changelog belum ada di aplikasiku", en: "A new feature is missing from my app" },
    a: {
      id: "Ada dua jenis pembaruan. Perubahan layar dan tampilan (tab bar, layar rekam, ekspor FIT/GPX, tema) sampai lewat pembaruan langsung tanpa perlu update dari toko. Fitur yang menyentuh jam atau Android (bahasa jam, rute GPS ke Health Connect, mulai latihan beban dari HP di jam, balasan cepat dan balasan pintar) butuh build toko baru dan baru ada di tes internal. Daftar lengkapnya ada di bagian Baru dan Segera hadir di beranda.",
      en: "There are two kinds of update. Screen and look changes (tab bar, record screen, FIT/GPX export, themes) arrive as live updates with no store update needed. Features that touch the watch or Android (watch language, GPS route to Health Connect, starting strength training on the watch from the phone, quick and smart replies) need a new store build and are in internal testing only. The full list is under New and Coming soon on the home page.",
    },
  },
];

function Install({ lang }: { lang: Lang }) {
  const id = lang === "id";
  return (
    <>
      <Sub>{id ? "A. Lewat Google Play (tes tertutup)" : "A. Through Google Play (closed test)"}</Sub>
      <p>
        {id
          ? "JoyoFit di Google Play masih tes tertutup. Gratis, dan butuh Android 10 ke atas."
          : "JoyoFit on Google Play is still a closed test. Free, and it needs Android 10 or newer."}
      </p>
      <Steps
        items={
          id
            ? [
                "Gabung grup Google joyofit-testers dengan akun Google yang sama dengan di Play Store. Hanya anggota grup yang bisa ikut tes.",
                "Buka halaman tes di Play dan ketuk Become a tester. Kalau halamannya belum terbuka, aksesmu belum aktif: tunggu beberapa menit lalu coba lagi.",
                "Pasang JoyoFit dari Play Store. Akun tidak wajib: data jam tersimpan di HP. Akun JoyoRogo hanya dibutuhkan untuk cloud, Strava, dan Social.",
              ]
            : [
                "Join the joyofit-testers Google group with the same Google account you use on the Play Store. Only group members can join the test.",
                "Open the test page on Play and tap Become a tester. If the page does not open yet, your access is not active: wait a few minutes and try again.",
                "Install JoyoFit from the Play Store. No account needed: watch data stays on the phone. A JoyoRogo account is only for the cloud, Strava and Social.",
              ]
        }
      />
      <div className="flex flex-wrap gap-3 pt-1">
        <ButtonLink href={TESTER_GROUP_URL} target="_blank" rel="noopener" {...goal("tester_group_click", "panduan")}>
          <Users aria-hidden />
          {id ? "1. Gabung grup Google" : "1. Join the Google group"}
        </ButtonLink>
        <ButtonLink
          variant="outline"
          href={TESTER_OPTIN_URL}
          target="_blank"
          rel="noopener"
          {...goal("tester_optin_click", "panduan")}
        >
          {id ? "2. Become a tester di Play" : "2. Become a tester on Play"}
        </ButtonLink>
      </div>

      <Sub>{id ? "B. Build sendiri dari kode sumber" : "B. Build it yourself from source"}</Sub>
      <p>
        {id ? (
          <>
            JoyoFit hanya tersedia di Google Play dan App Store; tidak ada unduhan APK di situs ini. Kalau mau membangun
            sendiri, kode dan caranya ada di <a className={link} href={GITHUB_URL} target="_blank" rel="noopener">GitHub</a>{" "}
            (bagian Build di README). Build sendiri punya dua fitur yang tidak ada di versi Play Store dan App Store: nama penelepon dari log
            panggilan dan SMS SOS.
          </>
        ) : (
          <>
            JoyoFit is only on Google Play and the App Store; this site has no APK download. To build it yourself, the code and
            instructions are on <a className={link} href={GITHUB_URL} target="_blank" rel="noopener">GitHub</a>{" "}
            (Build section of the README). A self-build has two features the store versions lack: caller names from the call
            log and SOS texts.
          </>
        )}
      </p>
      <div className="rounded-2xl bg-muted p-4">
        <p className="font-semibold">
          {id ? "Jangan campur versi Play Store dan build sendiri" : "Do not mix the Play Store version and a self-build"}
        </p>
        <p className="mt-1 text-muted-foreground">
          {id
            ? "Versi Play Store dan build sendiri ditandatangani dengan kunci berbeda, jadi Android tidak bisa memperbarui yang satu dengan yang lain. Untuk pindah, uninstall yang lama dulu. Uninstall menghapus data di HP, jadi unggah ke cloud dulu kalau kamu memakainya."
            : "The Play Store version and a self-build are signed with different keys, so Android cannot update one with the other. To switch, uninstall the old one first. Uninstalling wipes the data on the phone, so upload to the cloud first if you use it."}
        </p>
      </div>

      {IOS_TESTFLIGHT_LIVE && (
        <>
          <Sub>{id ? "C. iPhone (beta)" : "C. iPhone (beta)"}</Sub>
          <p>
            {id ? (
              <>
                Versi iPhone masih beta di TestFlight. Pasang TestFlight dari App Store, buka{" "}
                <a className={link} href={IOS_TESTFLIGHT_URL} target="_blank" rel="noopener" {...goal("ios_testflight_click", "panduan")}>undangan TestFlight</a>,
                ketuk <B>Accept</B>, lalu <B>Install</B>. Panduan ini ditulis untuk Android; di iPhone langkahnya mirip, dan
                tab Watch menampilkan petunjuknya sendiri.
              </>
            ) : (
              <>
                The iPhone version is in beta on TestFlight. Install TestFlight from the App Store, open the{" "}
                <a className={link} href={IOS_TESTFLIGHT_URL} target="_blank" rel="noopener" {...goal("ios_testflight_click", "panduan")}>TestFlight invitation</a>,
                tap <B>Accept</B>, then <B>Install</B>. This guide is written for Android; on iPhone the steps are similar and
                the Watch tab shows its own instructions.
              </>
            )}
          </p>
        </>
      )}
    </>
  );
}

function BeforePairing({ lang }: { lang: Lang }) {
  const id = lang === "id";
  return (
    <>
      <Steps
        items={
          id
            ? [
                <>
                  <B>Lepaskan jam dari Huawei Health</B> (Unbind). Jam hanya bisa terikat ke satu aplikasi; selama masih terikat
                  ke Huawei Health, jam menolak JoyoFit. Setelah itu Huawei Health boleh dihapus, dan kamu tidak butuh akun Huawei.
                </>,
                "Pastikan jam tidak sedang terhubung ke HP lain atau JoyoFit di HP lain.",
                <>
                  Nyalakan Bluetooth dan dekatkan jam ke HP. Kalau jam sudah dipasangkan di Pengaturan Bluetooth Android, jam
                  langsung muncul di JoyoFit (namanya seperti <Code>HUAWEI WATCH FIT 4-XXX</Code>). Kalau belum, cari lewat{" "}
                  <B>Scan nearby devices</B> (Android 12 ke atas).
                </>,
              ]
            : [
                <>
                  <B>Unbind the watch from Huawei Health.</B> A watch can only be bound to one app; while it is still bound to
                  Huawei Health, it refuses JoyoFit. After that you can uninstall Huawei Health, and you do not need a Huawei
                  account.
                </>,
                "Make sure the watch is not connected to another phone or to JoyoFit on another phone.",
                <>
                  Turn Bluetooth on and bring the watch close to the phone. If the watch is already paired in Android Bluetooth
                  settings, it shows up in JoyoFit right away (named like <Code>HUAWEI WATCH FIT 4-XXX</Code>). If not, find it
                  with <B>Scan nearby devices</B> (Android 12 and newer).
                </>,
              ]
        }
      />
      <div className="rounded-2xl bg-muted p-4">
        <p className="font-semibold">
          {id ? "Perlu reset pabrik jam? Tidak wajib." : "Do you need a factory reset of the watch? Not required."}
        </p>
        <p className="mt-1 text-muted-foreground">
          {id
            ? "Cukup lepaskan jam dari Huawei Health. Reset pabrik juga melepas jam, tapi menghapus semua isinya. JoyoFit tidak punya langkah reset atau pindai QR."
            : "Unbinding from Huawei Health is enough. A factory reset also releases the watch, but wipes everything on it. JoyoFit has no reset or QR-scan step."}
        </p>
      </div>
      <div className="rounded-2xl bg-makan-soft p-4 text-makan-ink">
        <p className="font-semibold">
          {id ? "Mau membawa riwayat Huawei Health? Lakukan ini sebelum melepas jam." : "Want to bring your Huawei Health history? Do this before unbinding."}
        </p>
        <p className="mt-1">
          {id
            ? "Sinkronkan jam sekali lagi di Huawei Health (tarik layar ke bawah): data yang belum sinkron hilang saat jam dilepas. Lalu minta ekspor datamu (langkahnya di bagian 7)."
            : "Sync the watch once more in Huawei Health (pull down): anything not yet synced is lost when the watch is unbound. Then request your data export (steps in section 7)."}
        </p>
      </div>
    </>
  );
}

function Pairing({ lang }: { lang: Lang }) {
  const id = lang === "id";
  return (
    <>
      <p>
        {id
          ? "Aplikasi JoyoFit berbahasa Inggris, jadi nama tombol di panduan ini ditulis persis seperti di layar."
          : "Button names are written exactly as they appear in the app."}
      </p>
      <Steps
        items={
          id
            ? [
                <>
                  Buka tab <B>Watch</B>. Aplikasi meminta izin <B>Nearby devices</B> (Bluetooth); ketuk <B>Continue</B> dan
                  izinkan. Kalau sudah terlanjur ditolak, ketuk <B>Open app settings</B>.
                </>,
                <>
                  Di <B>Available watches</B> pilih jam-mu. Belum ada? Ketuk <B>Scan nearby devices</B>, atau pasangkan dulu di
                  Pengaturan Android → Bluetooth.
                </>,
                <>
                  Ketuk <B>Connect</B> pada jam itu.
                </>,
                <>
                  Kalau jam belum pernah tersambung ke HP ini, muncul <B>Pair this watch with this phone?</B>. Ketuk{" "}
                  <B>Continue</B>. HP atau aplikasi yang sebelumnya tersambung ke jam akan terputus.
                </>,
                "Jaga layar jam tetap menyala, lalu setujui permintaan di jam dalam 30 detik.",
                <>
                  Setelah tersambung, buka <B>Today</B> dan ketuk <B>Sync now</B> untuk sinkron pertama.
                </>,
              ]
            : [
                <>
                  Open the <B>Watch</B> tab. The app asks for the <B>Nearby devices</B> (Bluetooth) permission; tap{" "}
                  <B>Continue</B> and allow it. If it was already denied, tap <B>Open app settings</B>.
                </>,
                <>
                  Under <B>Available watches</B> pick your watch. Not there yet? Tap <B>Scan nearby devices</B>, or pair it in
                  Android Settings → Bluetooth.
                </>,
                <>
                  Tap <B>Connect</B> on that watch.
                </>,
                <>
                  If the watch has never connected to this phone, <B>Pair this watch with this phone?</B> appears. Tap{" "}
                  <B>Continue</B>. Whatever phone or app the watch was paired with before gets disconnected.
                </>,
                "Keep the watch screen awake and accept the prompt on the watch within 30 seconds.",
                <>
                  Once connected, open <B>Today</B> and tap <B>Sync now</B> for the first sync.
                </>,
              ]
        }
      />
      <p className="text-muted-foreground">
        {id
          ? "Forget pairing di tab Watch hanya membuat JoyoFit melupakan jam; pairing Bluetooth Android tetap ada. Saat menyambung lagi, kamu perlu menyetujuinya di jam seperti pertama kali."
          : "Forget pairing on the Watch tab only makes JoyoFit forget the watch; the Android Bluetooth pairing stays. Next time you connect, you confirm it on the watch like the first time."}
      </p>
    </>
  );
}

function Watches({ lang }: { lang: Lang }) {
  const id = lang === "id";
  return (
    <>
      <p>
        {id ? (
          <>
            Yang sudah diuji: <B>Huawei Watch Fit 4 Pro, Band 8, Band 11 Pro, dan Watch Fit 2</B>. JoyoFit bisa mencoba {JAM_BISA_DICOBA} model jam dan band Huawei
            dan Honor, tapi model lainnya masih eksperimen: secara teori didukung, belum ada yang mencobanya. Punya model
            eksperimen? Sambungkan sekali, lalu kirim laporan (tab Watch → Bantu dukung jam-mu → Kirim laporan) supaya
            modelnya bisa ditandai teruji.
          </>
        ) : (
          <>
            Tested so far: the <B>Huawei Watch Fit 4 Pro, Band 8, Band 11 Pro and Watch Fit 2</B>. JoyoFit can attempt {JAM_BISA_DICOBA} Huawei and Honor watch
            and band models, but the others are experimental: supported in theory, not tried by anyone yet. Have an experimental
            model? Connect once, then send a report (Watch tab → Help support your watch → Send report) so it can be marked
            tested.
          </>
        )}
      </p>
      <p className="font-semibold">{id ? "Sudah diuji" : "Tested"}</p>
      <Chips items={JAM_SUDAH_DIUJI} />
      <p className="font-semibold">{id ? "Belum bisa" : "Not yet"}</p>
      <p className="text-muted-foreground">
        {id
          ? "Model Honor yang lebih baru memakai cara pairing (HiChain PAKE) yang belum didukung. Earphone juga tidak didukung."
          : "Newer Honor models use a pairing method (HiChain PAKE) that is not supported yet. Earphones are not supported either."}
      </p>
      <Chips items={JAM_BELUM_PAKE} />
      <p>
        {id ? (
          <>
            Daftar lengkap model eksperimen ada di halaman{" "}
            <a className={link} href="/jam">Jam yang didukung</a>. Jam Huawei atau Honor yang tidak ada di daftar tetap bisa
            dicoba, tapi belum tentu berhasil. Merek lain tidak bisa disambungkan.
          </>
        ) : (
          <>
            The full list of experimental models is on the <a className={link} href="/jam">Supported watches</a> page. Huawei
            and Honor watches that are not listed can still be tried, but may not work. Other brands cannot connect.
          </>
        )}
      </p>
    </>
  );
}

function Permissions({ lang }: { lang: Lang }) {
  const id = lang === "id";
  return (
    <>
      <p>
        {id
          ? "Aplikasi hanya meminta izin saat kamu membuka fitur yang membutuhkannya. Yang penting untuk memulai:"
          : "The app only asks for a permission when you open the feature that needs it. What matters to get started:"}
      </p>
      <List
        items={
          id
            ? [
                <>
                  <B>Nearby devices (Bluetooth)</B>: wajib, diminta di tab Watch untuk mencari dan menyambung ke jam. Tidak
                  butuh izin lokasi.
                </>,
                <>
                  <B>Notifikasi</B> (Android 13 ke atas): diminta saat kamu menyalakan <B>Keep connected in the background</B>.
                  Kalau ditolak, sambungan latar belakang tetap jalan; hanya notifikasinya yang tidak tampil.
                </>,
                <>
                  <B>Akses notifikasi</B> (Notification access): untuk meneruskan notifikasi ke jam. Pengaturan → Notifications
                  and calls → <B>Open notification access</B>, izinkan JoyoFit, lalu nyalakan{" "}
                  <B>Forward notifications to the watch</B>. Pilih aplikasinya di <B>Notification apps</B>. Pakai build sendiri di Android 13 ke atas? Buka dulu <B>Allow restricted settings</B> (lihat bagian 9).
                </>,
                <>
                  <B>Latar belakang</B>: Pengaturan → Background and sync → nyalakan <B>Keep connected in the background</B>.
                  Interval sinkron bisa diatur dari 15 menit sampai 4 jam.
                </>,
                <>
                  <B>Optimasi baterai</B>: aplikasi tidak memintanya. Kalau HP-mu mematikan JoyoFit di latar belakang, kecualikan
                  JoyoFit dari penghemat baterai di pengaturan Android.
                </>,
              ]
            : [
                <>
                  <B>Nearby devices (Bluetooth)</B>: required, asked on the Watch tab to find and connect to the watch. No
                  location permission needed.
                </>,
                <>
                  <B>Notifications</B> (Android 13 and newer): asked when you turn on <B>Keep connected in the background</B>.
                  If you deny it, the background connection still works; only its notification is hidden.
                </>,
                <>
                  <B>Notification access</B>: to forward notifications to the watch. Settings → Notifications and calls →{" "}
                  <B>Open notification access</B>, allow JoyoFit, then turn on <B>Forward notifications to the watch</B>. Pick
                  the apps under <B>Notification apps</B>. On a self-build with Android 13 or newer, turn on{" "}
                  <B>Allow restricted settings</B> first (see section 9).
                </>,
                <>
                  <B>Background</B>: Settings → Background and sync → turn on <B>Keep connected in the background</B>. The sync
                  interval can be 15 minutes to 4 hours.
                </>,
                <>
                  <B>Battery optimization</B>: the app does not ask for it. If your phone kills JoyoFit in the background, exempt
                  it from battery saving in Android settings.
                </>,
              ]
        }
      />
      <p className="text-muted-foreground">
        {id
          ? "Opsional, hanya diminta saat kamu menyalakan fiturnya: lokasi (cuaca dan GPS olahraga luar ruang, hanya saat aplikasi dibuka), telepon (menerima panggilan dari jam), dan Health Connect (berbagi data jam dengan aplikasi lain)."
          : "Optional, only asked when you turn the feature on: location (weather and GPS for outdoor workouts, only while the app is open), phone (answering calls from the watch), and Health Connect (sharing watch data with other apps)."}
      </p>
    </>
  );
}

function Features({ lang }: { lang: Lang }) {
  const id = lang === "id";
  return (
    <>
      <Sub>{id ? "Sinkron" : "Sync"}</Sub>
      <p>
        {id ? (
          <>
            Buka <B>Today</B> dan ketuk <B>Sync now</B> (atau tarik layar ke bawah). Sinkron pertama mengambil semua riwayat
            yang masih ada di jam; berikutnya hanya data baru. Dengan <B>Keep connected in the background</B>, JoyoFit
            sinkron sendiri tiap 30 menit (bisa diubah), walau aplikasi ditutup.
          </>
        ) : (
          <>
            Open <B>Today</B> and tap <B>Sync now</B> (or pull down). The first sync pulls all history still on the watch; after
            that, only new data. With <B>Keep connected in the background</B>, JoyoFit syncs on its own every 30 minutes
            (adjustable), even with the app closed.
          </>
        )}
      </p>

      <Sub>Strava</Sub>
      <p>
        {id ? (
          <>
            Pengaturan → <B>Strava</B> mengirim olahraga dari jam ke akun Strava-mu. Gratis, tanpa JoyoRogo Pro. Masuk dulu
            dengan <B>Sign in with JoyoRogo</B>, lalu ketuk <B>Connect with Strava</B>. Olahraga baru dikirim otomatis tiap
            sinkron; olahraga sebelum tersambung bisa dikirim manual lewat <B>Send to Strava</B> di layar olahraganya, dan{" "}
            <B>View on Strava</B> membuka aktivitasnya setelah terkirim.
          </>
        ) : (
          <>
            Settings → <B>Strava</B> sends watch workouts to your Strava account. Free, no JoyoRogo Pro needed. First tap{" "}
            <B>Sign in with JoyoRogo</B>, then <B>Connect with Strava</B>. New workouts go up automatically on each sync; ones
            from before you connected can be sent by hand with <B>Send to Strava</B> on the workout screen, and{" "}
            <B>View on Strava</B> opens the activity once it is sent.
          </>
        )}
      </p>
      <p>
        {id
          ? "Yang diunggah adalah satu file FIT dengan angka dari jam: semua sampel dari awal sampai akhir (titik GPS dan sampel yang hanya berisi detak jantung), jarak yang dicocokkan dengan jarak jam, waktu aktif, kalori, detak jantung, kenaikan elevasi, dan kadensi dari langkah. Yang tidak diberikan jam tidak diisi."
          : "What goes up is one FIT file with the watch's numbers: every sample from start to end (GPS points and heart-rate-only samples), distance matched to the watch's distance, active time, calories, heart rate, elevation gain and step-based cadence. Anything the watch does not provide is left out."}
      </p>
      <p className="rounded-2xl bg-muted p-4">
        {id ? (
          <>
            <B>Kuota terbatas.</B> Strava membatasi jumlah pengguna aplikasi baru sampai aplikasinya disetujui, jadi untuk
            sementara Strava hanya lewat undangan.{" "}
            <a className={link} href={STRAVA_PATH} {...goal("strava_waitlist_click", "panduan")}>Daftar undangan Strava</a>.
          </>
        ) : (
          <>
            <B>Limited spots.</B> Strava caps how many people can use a new app until it is approved, so for now Strava is
            invite-only.{" "}
            <a className={link} href={STRAVA_PATH} {...goal("strava_waitlist_click", "panduan")}>Join the Strava waitlist</a>.
          </>
        )}
      </p>

      <Sub>{id ? "Impor riwayat Huawei Health" : "Import Huawei Health history"}</Sub>
      <p>
        {id
          ? "Pengaturan → Import from Huawei Health memindahkan detak jantung, tidur, langkah, dan olahraga dari Huawei Health ke JoyoFit. Gratis, diproses di HP, tidak ada data yang dikirim keluar."
          : "Settings → Import from Huawei Health moves heart rate, sleep, steps and workouts from Huawei Health into JoyoFit. Free, processed on the phone, nothing is sent out."}
      </p>
      <Steps
        items={
          id
            ? [
                <>
                  Minta datamu ke Huawei di <Code>privacy.consumer.huawei.com</Code>, atau di Huawei Health → Me → akunmu →
                  Privacy Center. Pilih <B>Request Your Data</B> dan centang <B>Health</B>.
                </>,
                "Buat password untuk ZIP-nya dan catat. Huawei butuh hingga 7 hari untuk menyiapkan berkas, lalu mengirim tautan unduhan lewat email. Tautannya berlaku 21 hari.",
                "Sebelum melepas jam dari Huawei Health, sinkronkan sekali lagi di sana. Data yang hanya ada di jam hilang saat dilepas.",
                <>
                  Unduh ZIP-nya, di JoyoFit pilih <B>Choose the ZIP file</B>, isi password, lalu ketuk <B>Import</B>.
                </>,
              ]
            : [
                <>
                  Request your data from Huawei at <Code>privacy.consumer.huawei.com</Code>, or in Huawei Health → Me → your
                  account → Privacy Center. Choose <B>Request Your Data</B> and tick <B>Health</B>.
                </>,
                "Set a password for the ZIP and note it down. Huawei takes up to 7 days to prepare the file, then emails a download link. The link works for 21 days.",
                "Before unbinding the watch from Huawei Health, sync it there once more. Data only on the watch is lost when it is unbound.",
                <>
                  Download the ZIP. In JoyoFit, tap <B>Choose the ZIP file</B>, enter the password, then tap <B>Import</B>.
                </>,
              ]
        }
      />
      <p className="text-muted-foreground">
        {id
          ? "Data jam yang sudah ada tidak ditimpa, dan data impor tidak diunggah ke cloud, Health Connect, atau Strava. Fitur ini baru dan belum dicoba dengan berkas ekspor asli; kalau ada data yang tidak terbaca, laporkan di GitHub."
          : "Existing watch data is never overwritten, and imported data is not uploaded to the cloud, Health Connect or Strava. The feature is new and has not been tried on a real export file yet; if some data fails to import, report it on GitHub."}
      </p>
    </>
  );
}

function SetupGuide({ lang }: { lang: Lang }) {
  const id = lang === "id";
  return (
    <>
      <p>
        {id ? (
          <>
            Saat pertama dibuka, JoyoFit menampilkan <B>Set up JoyoFit</B>: panduan yang menuntun dari jam yang masih
            terikat ke Huawei Health sampai data pertama masuk. Urutannya sengaja begini karena pairing hanya berhasil kalau
            jam sudah dilepas dulu.
          </>
        ) : (
          <>
            On first launch JoyoFit shows <B>Set up JoyoFit</B>: a guide that walks from a watch still bound to Huawei Health to
            the first data coming in. The order is deliberate, because pairing only works once the watch has been released.
          </>
        )}
      </p>
      <Steps
        items={
          id
            ? [
                <>
                  <B>Welcome</B>: isi panduan, dan satu-satunya tempat untuk keluar dari panduan.
                </>,
                <>
                  <B>Huawei Health</B>: lepas jam (Unbind). Ini juga kesempatan terakhir menyinkronkan jam sekali lagi di sana
                  dan meminta ekspor datanya. Ekspor butuh berhari-hari, jadi minta sekarang dan impor kapan pun berkasnya tiba.
                </>,
                <>
                  <B>Pair</B>: pilih jam, ketuk <B>Connect</B>, lalu setujui permintaan di layar jam.
                </>,
                <>
                  <B>First sync</B>: tarik riwayat pertama. Langkah ini membuktikan sambungannya jalan.
                </>,
                "Notifications, Health Connect (Apple Health di iPhone), dan Weather: izin opsional.",
                "Background (hanya Android): jaga jam tetap tersambung di latar belakang.",
                "JoyoRogo: masuk dengan akun JoyoRogo untuk cloud, Strava, dan Social. Lalu JoyoRogo Pro, hanya informasi dan tidak menghalangi langkah berikutnya.",
                <>
                  <B>JoyoRogo Cloud</B>: cadangan semua workout beserta analisisnya, bisa dilihat di joyorogo.com/jam dan dipulihkan di HP baru.
                  Untuk akun Pro; akun Free tetap menyimpan workout di HP. Bisa dilewati.
                </>,
                <>
                  <B>Done</B>: tips terakhir.
                </>,
              ]
            : [
                <>
                  <B>Welcome</B>: what the guide covers, and the one place to leave it.
                </>,
                <>
                  <B>Huawei Health</B>: unbind the watch. This is also the last chance to sync it once more there and request
                  its data export. The export takes days, so ask now and import it whenever the file arrives.
                </>,
                <>
                  <B>Pair</B>: pick the watch, tap <B>Connect</B>, then accept the prompt on the watch.
                </>,
                <>
                  <B>First sync</B>: pull the first history. This step proves the link works.
                </>,
                "Notifications, Health Connect (Apple Health on iPhone), and Weather: optional permissions.",
                "Background (Android only): keep the watch connected in the background.",
                "JoyoRogo: sign in with your JoyoRogo account for the cloud, Strava and Social. Then JoyoRogo Pro, information only, which never blocks the next step.",
                <>
                  <B>JoyoRogo Cloud</B>: a backup of every workout with its analysis, viewable at joyorogo.com/jam and restorable on a
                  new phone. For Pro accounts; Free accounts keep workouts on the phone. Can be skipped.
                </>,
                <>
                  <B>Done</B>: last tips.
                </>,
              ]
        }
      />
      <p className="text-muted-foreground">
        {id ? (
          <>
            Setiap langkah bisa dilewati atau dilanjutkan, dan kalau aplikasi ditutup di tengah jalan, panduan lanjut dari
            langkah terakhir. Buka lagi kapan saja lewat Pengaturan → <B>Setup guide</B>; kalau jam sudah terpasang, langkah
            lepas jam tidak ditampilkan. Pengguna lama yang jamnya sudah terpasang tidak dipaksa melewatinya. Bagian 3 dan 4 di
            bawah menjelaskan langkah yang sama dengan lebih rinci.
          </>
        ) : (
          <>
            Every step can be skipped or continued, and if the app is closed midway, the guide resumes from the last step.
            Reopen it any time from Settings → <B>Setup guide</B>; if a watch is already paired, the unbind step is left out.
            Existing users whose watch is already paired are not forced through it. Sections 3 and 4 below cover the same steps
            in more detail.
          </>
        )}
      </p>
    </>
  );
}

function SocialGuide({ lang }: { lang: Lang }) {
  const id = lang === "id";
  return (
    <>
      <p>
        {id ? (
          <>
            Tab <B>Social</B> menampilkan feed JoyoRogo di dalam JoyoFit. Kamu perlu masuk dengan akun JoyoRogo dulu (Sign in
            with JoyoRogo); sebelum itu tab ini meminta kamu masuk.
          </>
        ) : (
          <>
            The <B>Social</B> tab shows the JoyoRogo feed inside JoyoFit. Sign in with your JoyoRogo account first (Sign in with
            JoyoRogo); until then the tab asks you to.
          </>
        )}
      </p>
      <Sub>{id ? "Feed, grup, profil" : "Feed, groups, profiles"}</Sub>
      <List
        items={
          id
            ? [
                <>
                  Feed punya dua tab: <B>Following</B> (kamu, orang yang kamu ikuti, dan grupmu) dan <B>Explore</B> (postingan
                  publik di JoyoRogo).
                </>,
                <>
                  <B>Groups</B>: gabung dengan kode undangan dari teman (isi <B>Invite code</B>, ketuk <B>Join</B>). Membuat grup
                  baru masih lewat JoyoRogo.
                </>,
                <>
                  <B>My profile</B> menampilkan postinganmu; profil orang lain terbuka dari feed atau dari daftar anggota grup.
                </>,
                "Di setiap postingan kamu bisa memberi kudos dan berkomentar.",
                "Grup JoyoRogo bisa membagikan skor harian JoyoFit (Recovery, Strain, tidur, Readiness). Hanya skornya, bukan detak jantung atau langkah. Pengaturannya ada di grup di JoyoRogo.",
              ]
            : [
                <>
                  The feed has two tabs: <B>Following</B> (you, people you follow, and your groups) and <B>Explore</B> (public
                  posts on JoyoRogo).
                </>,
                <>
                  <B>Groups</B>: join with an invite code from a friend (fill in <B>Invite code</B>, tap <B>Join</B>). Creating a
                  new group is still done in JoyoRogo.
                </>,
                <>
                  <B>My profile</B> shows your posts; other people's profiles open from the feed or from a group's member list.
                </>,
                "On any post you can give kudos and comment.",
                "A JoyoRogo group can share the daily JoyoFit scores (Recovery, Strain, sleep, Readiness). Only the scores, not heart rate or steps. The setting is on the group in JoyoRogo.",
              ]
        }
      />
      <Sub>{id ? "Bagikan latihan" : "Share a workout"}</Sub>
      <Steps
        items={
          id
            ? [
                <>
                  Buka latihan dari tab <B>Workouts</B> dan ketuk <B>Share to JoyoRogo</B>.
                </>,
                "Tulis caption (sampai 1.000 karakter) kalau mau.",
                <>
                  Pilih <B>Group</B> (hanya orang yang satu grup JoyoRogo denganmu) atau <B>Public</B> (siapa saja di JoyoRogo;
                  profil JoyoRogo-mu harus publik).
                </>,
                <>
                  Nyalakan atau matikan <B>Heart-rate data</B>, <B>Route</B>, dan <B>Comparison with earlier workouts</B>. Yang
                  datanya tidak ada tidak ditampilkan.
                </>,
                <>
                  Ketuk <B>Post</B>, lalu <B>View post</B> untuk melihatnya.
                </>,
              ]
            : [
                <>
                  Open the workout from the <B>Workouts</B> tab and tap <B>Share to JoyoRogo</B>.
                </>,
                "Write a caption (up to 1,000 characters) if you like.",
                <>
                  Choose <B>Group</B> (only people who share a JoyoRogo group with you) or <B>Public</B> (anyone on JoyoRogo; your
                  JoyoRogo profile has to be public).
                </>,
                <>
                  Turn <B>Heart-rate data</B>, <B>Route</B>, and <B>Comparison with earlier workouts</B> on or off. Ones with no
                  data are not shown.
                </>,
                <>
                  Tap <B>Post</B>, then <B>View post</B> to see it.
                </>,
              ]
        }
      />
      <p className="rounded-2xl bg-muted p-4">
        {id ? (
          <>
            <B>Yang gratis dan yang Pro.</B> Membagikan latihan gratis. Melihat grafik detak jantung dan rute di postingan orang
            lain adalah fitur JoyoRogo Pro; milikmu sendiri selalu bisa kamu lihat.
          </>
        ) : (
          <>
            <B>Free and Pro.</B> Sharing a workout is free. Seeing the heart-rate chart and route on someone else's post is a
            JoyoRogo Pro feature; your own are always visible to you.
          </>
        )}
      </p>
      <Sub>{id ? "Kartu bagikan (gambar)" : "Share card (image)"}</Sub>
      <p>
        {id ? (
          <>
            Tombol bagikan di layar latihan dan di <B>Today</B> membuka lembar berbagi: pilih <B>Story 9:16</B> atau{" "}
            <B>Square 1:1</B>, latar rute, fotomu, atau stiker transparan (latihan), lalu kirim ke Instagram, <B>Copy</B>,{" "}
            <B>Save</B>, atau <B>More</B>. Di Android 11 ke atas, Save tidak butuh izin penyimpanan. Kartu hanya gambar;
            postingan yang bisa dikomentari lewat Share to JoyoRogo.
          </>
        ) : (
          <>
            The share button on a workout and on <B>Today</B> opens a share sheet: pick <B>Story 9:16</B> or <B>Square 1:1</B>, a
            route, photo or transparent-sticker background (workouts), then send it to Instagram, <B>Copy</B>, <B>Save</B> or{" "}
            <B>More</B>. On Android 11 and newer, Save needs no storage permission. The card is only an image; a post friends
            can comment on goes through Share to JoyoRogo.
          </>
        )}
      </p>
    </>
  );
}

function Faq({ lang }: { lang: Lang }) {
  return (
    <div className="divide-y divide-border/70 rounded-3xl bg-card">
      {FAQ.map((item) => (
        <details key={item.q.id} className="group px-5 md:px-6">
          <summary className="-mx-2 flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-2 py-4 text-base font-bold focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            {item.q[lang]}
            <ChevronDown
              className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden
            />
          </summary>
          <p className="pb-5 text-[0.9375rem] leading-relaxed text-muted-foreground">{item.a[lang]}</p>
        </details>
      ))}
    </div>
  );
}

function CoachGuide({ lang }: { lang: Lang }) {
  const id = lang === "id";
  return (
    <>
      <p>
        {id
          ? "Coach adalah fitur JoyoRogo Pro. Buka dari kartu Saran hari ini di layar Hari Ini, atau lewat Coach. Kamu perlu masuk dengan akun JoyoRogo."
          : "Coach is a JoyoRogo Pro feature. Open it from the Today's suggestion card on the Today screen. You need to be signed in with your JoyoRogo account."}
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          {id
            ? "Saran harian: dari kesiapan, HRV, tidur, beban latihan, dan beban kemarin. Aturannya terbuka dan tanpa AI; alasannya ditampilkan di kartu."
            : "Daily suggestion: from readiness, HRV, sleep, training load and yesterday's strain. The rules are open and there is no AI; the reasons show on the card."}
        </li>
        <li>
          {id
            ? "Rencana: lari 5K, 10K, half marathon, lari rutin 3x seminggu, atau kekuatan full body 2 atau 3 kali seminggu di rumah atau gym. Pilih tujuan, level, dan hari latihan; tiap minggu volumenya disesuaikan dengan sesi yang selesai dan pemulihanmu."
            : "Plans: 5K, 10K, half marathon, regular running 3 times a week, or full-body strength 2 or 3 times a week at home or in the gym. Pick a goal, a level and your days; each week the volume is adjusted to the sessions you finished and your recovery."}
        </li>
        <li>
          {id
            ? "Sesi lari dicocokkan otomatis dengan latihan dari jam, dan detail latihan membandingkannya dengan rencana (durasi, zona detak jantung, pace, jarak)."
            : "Running sessions are matched automatically to the workouts from your watch, and the workout detail compares them with the plan (duration, heart-rate zone, pace, distance)."}
        </li>
        <li>
          {id
            ? "Sesi kekuatan dimulai di pencatat latihan. Jam Huawei tidak melaporkan jumlah ulangan dari latihan kekuatan, jadi ulangan dan beban dicatat manual."
            : "Strength sessions start in the workout logger. A Huawei watch does not report repetitions from strength workouts, so reps and loads are logged by hand."}
        </li>
        <li>
          {id
            ? "Perpustakaan latihan: sekitar 100 gerakan dengan langkah, otot, dan kesalahan umum. Gambar dari wger.de (CC BY-SA)."
            : "Exercise library: about 100 exercises with steps, muscles and common mistakes. Images from wger.de (CC BY-SA)."}
        </li>
        <li>
          {id
            ? "Tanya coach: chat tentang latihan, pemulihan, dan rencanamu, maksimal 20 pesan per hari. Pesan dan ringkasan datamu dikirim ke AI JoyoRogo untuk dijawab dan tidak disimpan di server; obrolan hanya tersimpan di ponselmu."
            : "Ask coach: a chat about your training, recovery and plan, up to 20 messages a day. Your message and a summary of your data go to JoyoRogo's AI to be answered and are not stored on the server; the chat is kept only on your phone."}
        </li>
      </ul>
      <p>
        {id
          ? "Coach bukan saran medis. Kalau ada nyeri, pusing, atau cedera, berhenti dan temui dokter. Dalam mode Hamil jawabannya lebih berhati-hati dan selalu menyarankan bertanya ke dokter atau bidan."
          : "Coach is not medical advice. If you feel pain, dizziness or an injury, stop and see a doctor. In Hamil mode the answers are more careful and always point to a doctor or midwife."}
      </p>
    </>
  );
}

function Guide({ lang }: { lang: Lang }) {
  const prefix = lang === "id" ? "" : "en-";
  const body: Record<(typeof SECTIONS)[number]["key"], React.ReactNode> = {
    pasang: <Install lang={lang} />,
    awal: <SetupGuide lang={lang} />,
    sebelum: <BeforePairing lang={lang} />,
    pairing: <Pairing lang={lang} />,
    jam: <Watches lang={lang} />,
    izin: <Permissions lang={lang} />,
    fitur: <Features lang={lang} />,
    social: <SocialGuide lang={lang} />,
    coach: <CoachGuide lang={lang} />,
    faq: null,
  };
  return (
    <div lang={lang} className="space-y-3">
      <nav aria-label={lang === "id" ? "Isi panduan" : "Guide contents"} className="rounded-3xl bg-card p-5 md:p-6">
        <ul className="grid gap-1 sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <li key={s.key}>
              <a
                href={`#${prefix}${s.key}`}
                className="inline-flex min-h-11 items-center text-[0.9375rem] font-semibold text-primary underline-offset-4 hover:underline"
              >
                {s[lang]}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {SECTIONS.map((s) =>
        s.key === "faq" ? (
          <section key={s.key} id={`${prefix}${s.key}`} className="scroll-mt-20 pt-3">
            <h2 className="mb-3 text-lg font-bold tracking-tight">{s[lang]}</h2>
            <Faq lang={lang} />
          </section>
        ) : (
          <Block key={s.key} id={`${prefix}${s.key}`} title={s[lang]}>
            {body[s.key]}
          </Block>
        ),
      )}
      <p className="pt-2 text-sm text-muted-foreground">
        {lang === "id" ? (
          <>
            Masih buntu? <a className={link} href={WATCH_REPORT_FORM_URL} target="_blank" rel="noopener">Kirim laporan jam</a>{" "}
            atau buka isu di <a className={link} href={GITHUB_URL} target="_blank" rel="noopener">GitHub</a>.
          </>
        ) : (
          <>
            Still stuck? <a className={link} href={WATCH_REPORT_FORM_URL} target="_blank" rel="noopener">Send a watch report</a>{" "}
            or open an issue on <a className={link} href={GITHUB_URL} target="_blank" rel="noopener">GitHub</a>.
          </>
        )}
      </p>
    </div>
  );
}

export function PanduanPage() {
  return (
    <section data-section="panduan" className="py-12 md:py-16">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
        <a
          href="/"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Kembali ke beranda
        </a>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
          Pakai Huawei Watch Fit 4 Pro tanpa Huawei Health: panduan JoyoFit
        </h1>
        <p className="mt-3 text-muted-foreground">
          Dari pasang aplikasi sampai jam tersambung dan data masuk. Bahasa Indonesia di bawah,{" "}
          <a href="#english" className="font-semibold underline underline-offset-4">English version</a> setelahnya.
        </p>
        <div className="mt-8">
          <Guide lang="id" />
        </div>
        <h2 id="english" className="mt-14 scroll-mt-20 text-2xl font-extrabold tracking-tight md:text-3xl">
          Install and use guide (English)
        </h2>
        <div className="mt-6">
          <Guide lang="en" />
        </div>
      </div>
    </section>
  );
}
