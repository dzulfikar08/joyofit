import { useEffect, useState } from "react";
import {
  Activity,
  Bike,
  History,
  Radio,
  Timer,
  ArrowRight,
  AlarmClock,
  ArrowLeft,
  Bell,
  BellRing,
  Bluetooth,
  Check,
  ChevronDown,
  Cloud,
  CloudSun,
  Download,
  Droplet,
  Dumbbell,
  Flame,
  Footprints,
  Heart,
  HeartPulse,
  LayoutDashboard,
  ListChecks,
  Lock,
  Mail,
  Medal,
  MessageCircle,
  Moon,
  Package,
  Palette,
  Plug,
  Route,
  Server,
  Share2,
  ShieldCheck,
  Trophy,
  Upload,
  Users,
  Watch,
  Weight,
  type LucideIcon,
} from "lucide-react";
import {
  BLOG_PATH,
  CLOUDAGNI_URL,
  CONTACT_EMAIL,
  DUKUNG_JAM_PATH,
  GITHUB_URL,
  HARGA_URL,
  IPHONE_PATH,
  JAM_PATH,
  JOYOROGO_URL,
  KELUARGA_PATH,
  IOS_TESTFLIGHT_LIVE,
  IOS_TESTFLIGHT_URL,
  PANDUAN_PATH,
  PRIVASI_PATH,
  RIDE_PATH,
  RIDE_WEB_URL,
  SELF_HOST_PATH,
  STRAVA_PATH,
  STUDIO_URL,
  TESTER_GROUP_URL,
  TESTER_OPTIN_URL,
  TIMBANGAN_PATH,
  TRAKTEER_URL,
  WATCH_REPORTS_URL,
  WATCH_REPORT_FORM_URL,
  WATCH_REQUEST_URL,
  WEB_URL,
  goal,
  cn,
} from "./lib";
import { usePlatform } from "./platform";
import {
  JAM_BELUM_PAKE,
  JAM_BISA_DICOBA,
  JAM_EKSPERIMEN_CLASSIC,
  JAM_EKSPERIMEN_LE,
  JAM_SUDAH_DIUJI,
} from "./jam";
import { FAQ } from "./faq";
import { useScrollReveal } from "./reveal";
import { FooterLandscape } from "./footer-landscape";
import { BlogIndexPage, BlogPostPage } from "./Blog";
import { KeluargaPage } from "./Keluarga";
import { PanduanPage } from "./Panduan";
import { PrivasiPage } from "./Privasi";
import { TimbanganPage } from "./Timbangan";
import { isPublicPath } from "./seo";
import { Testimonials } from "./testimonials-section";
import { TESTIMONIALS } from "./testimonials";
import { AndroidMark, ANDROID_ROBOT_CREDIT, AppleMark, ButtonLink, GithubMark, Phone, Ring } from "./ui";
import roadmap from "../../docs/roadmap.json";
import { IphonePage, StravaPage } from "./Waitlist";

/** Harga JoyoRogo Pro, sama dengan joyorogo.com/harga (api.joyorogo.com/api/config). */
const PRICE = { monthly: "Rp29.000", yearly: "Rp199.000", next: "Rp49.000", slots: 110 };

const FACTS = [
  { value: `${JAM_BISA_DICOBA} model`, label: "jam dan band Huawei dan Honor bisa dicoba", href: "/jam" },
  { value: "Live", label: "detak, kkal, lemak dan karbo saat olahraga" },
  { value: "AGPL-3.0", label: "kode terbuka" },
  { value: "Tanpa jam", label: "catat latihan beban dari HP saja", href: "#beban" },
] as const;

const BASICS = [
  {
    icon: HeartPulse,
    tone: "bg-bakar-soft text-bakar-ink",
    title: "Langkah, detak jantung, SpO2",
    body: "Data per menit dari jam: langkah, kalori, jarak, detak jantung, detak istirahat, dan SpO2. Detak jantung langsung tampil selama layar Hari ini terbuka.",
  },
  {
    icon: Moon,
    tone: "bg-tidur-soft text-tidur-ink",
    title: "Tidur dengan tahapnya",
    body: "Awake, REM, ringan, dan dalam dari TruSleep, lengkap dengan skor tidur dari jam, bukan hitungan kami.",
  },
  {
    icon: Route,
    tone: "bg-makan-soft text-makan-ink",
    title: "Olahraga beserta rute",
    body: "Total, detak jantung, pace per bagian, dan jalur GPS yang digambar sebagai garis di layar. Tanpa peta pihak ketiga.",
  },
] as const;

const WATCH_FEATURES = [
  {
    icon: Bell,
    title: "Notifikasi",
    body: "Nama aplikasi, judul, dan isi diteruskan ke jam. Kamu pilih aplikasi mana saja.",
  },
  {
    icon: CloudSun,
    title: "Cuaca",
    body: "Kondisi sekarang dan prakiraan 24 jam serta 8 hari dari Open-Meteo, tanpa kunci API.",
  },
  {
    icon: AlarmClock,
    title: "Alarm",
    body: "Baca, ubah, tambah, dan hapus alarm jam dari HP, termasuk alarm pintar.",
  },
  {
    icon: BellRing,
    title: "Cari jam, cari HP",
    body: "Bunyikan jam dari HP, atau bunyikan HP dari jam, juga saat aplikasi di latar belakang.",
  },
] as const;

const PROMISES = [
  {
    icon: ShieldCheck,
    title: "Langsung ke HP",
    body: "Jam terhubung langsung lewat Bluetooth ke HP-mu. Huawei Health tidak perlu terpasang.",
  },
  {
    icon: Bluetooth,
    title: "Disimpan di HP dulu",
    body: "Data masuk ke database SQLite lokal. Tidak ada yang keluar sebelum kamu masuk ke cloud.",
  },
  {
    icon: Footprints,
    title: "Ekspor ke Health Connect dan Apple Health",
    body: "Langkah, jarak, kalori, detak jantung, SpO2, tidur, dan olahraga bisa ditulis ke Health Connect di Android atau Apple Health di iPhone untuk aplikasi lain.",
  },
] as const;

const LIVE: { Icon: LucideIcon; name: string; note: string }[] = [
  { Icon: HeartPulse, name: "Detak jantung realtime", note: "dari jam" },
  { Icon: Flame, name: "Kalori terbakar", note: "rumus Keytel" },
  { Icon: Droplet, name: "Lemak terbakar", note: "perkiraan per zona" },
  { Icon: Dumbbell, name: "Karbo terbakar", note: "perkiraan per zona" },
];

const FACES: { Icon: LucideIcon; name: string; note: string }[] = [
  { Icon: Palette, name: "Watch face", note: "Daftar, pratinjau, ganti, dan hapus. File .hwt dicek dulu; jam menolak face yang tidak ditandatangani Huawei, dan aplikasi menjelaskannya." },
  { Icon: Watch, name: "Ruang di jam", note: "Meter penyimpanan jam dan perkiraan apakah face baru masih muat." },
  { Icon: Download, name: "Photo face jalan", note: "Pilih fotomu sendiri dan jam menggambar waktu dan datanya di atasnya. Face buatan sendiri harus lewat Huawei Health (lihat FAQ)." },
];

function Check2({ className }: { className?: string }) {
  return <Check className={className} aria-hidden />;
}

function Header() {
  const link =
    "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 md:h-16 md:px-6">
        <a
          href="/"
          aria-label="JoyoFit, ke halaman utama"
          className="flex items-center gap-2 rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <img src="/brand/logo-mark.svg" alt="" width={32} height={32} className="h-7 w-auto md:h-8" />
          <span className="text-lg font-extrabold tracking-tight">JoyoFit</span>
        </a>
        <nav aria-label="Utama" className="hidden items-center gap-1 md:flex">
          <a href="/#fitur" className={link}>
            Fitur
          </a>
          <a href="/jam" className={link}>
            Jam
          </a>
          <a href="/#cara" className={link}>
            Tiga cara pakai
          </a>
          <a href="/#web" className={link}>
            JoyoFit Web
          </a>
          <a href="/#ride" className={link}>
            Ride
          </a>
          <a href={BLOG_PATH} className={link}>
            Blog
          </a>
          <a href="/#faq" className={link}>
            Tanya jawab
          </a>
          <a href={JOYOROGO_URL} className={link}>
            JoyoRogo
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener"
            aria-label="Kode JoyoFit di GitHub (open source)"
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <GithubMark className="size-5" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <ButtonLink href="/#cara">Mulai</ButtonLink>
        </div>
      </div>
    </header>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[0.6875rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">{title}</p>
      <div className="mt-2 flex flex-col">{children}</div>
    </div>
  );
}

function Footer() {
  const link = "inline-flex min-h-11 items-center text-sm font-semibold hover:text-primary";
  return (
    <footer className="mt-8">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-6 gap-y-8 px-4 pt-14 pb-4 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:gap-10 md:px-6">
        <div className="col-span-2 max-w-sm md:col-span-1">
          <p className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <img src="/brand/logo-mark.svg" alt="" width={28} height={28} className="h-7 w-auto" />
            JoyoFit
          </p>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
            Jam Huawei dan Honor tanpa Huawei Health: langkah, detak jantung, dan{" "}
            <span className="font-semibold text-tidur-ink">tidur</span> masuk ke HP, kalori{" "}
            <span className="font-semibold text-makan-ink">makan</span> dari JoyoRogo tampil di jam-mu.
          </p>
          <p className="mt-4 flex items-start gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            Dibuat di Malang oleh Dzulfikar. Turunan Gadgetbridge, lisensi AGPL-3.0. Tidak berafiliasi dengan Huawei atau Honor.
          </p>
        </div>
        <nav aria-label="Tautan" className="contents">
          <FooterColumn title="Pakai">
            <a href="/#cara" className={link}>
              Tiga cara pakai
            </a>
            <a href="/#tester" className={cn(link, "gap-1.5")}>
              <AndroidMark className="size-4" />
              Android
            </a>
            <a href={IPHONE_PATH} className={cn(link, "gap-1.5")} {...goal("iphone_waitlist_click", "footer")}>
              <AppleMark className="size-4" />
              iPhone
            </a>
            <a href={STRAVA_PATH} className={link} {...goal("strava_waitlist_click", "footer")}>
              Strava
            </a>
            <a href={PANDUAN_PATH} className={link}>
              Panduan
            </a>
            <a href={TIMBANGAN_PATH} className={link}>
              Timbangan
            </a>
            <a href={BLOG_PATH} className={link}>
              Blog
            </a>
            <a href="/#roadmap" className={link}>
              Roadmap
            </a>
          </FooterColumn>
          <FooterColumn title="Ekosistem">
            <a href={WEB_URL} className={link} {...goal("joyofit_web_click", "footer")}>
              JoyoFit Web
            </a>
            <a href={STUDIO_URL} className={link}>
              Studio
            </a>
            <a href={RIDE_PATH} className={link}>
              Ride
            </a>
            <a href={HARGA_URL} className={link} {...goal("founder_cta_click", "footer")}>
              Harga
            </a>
            <a href={JOYOROGO_URL} className={link}>
              JoyoRogo
            </a>
            <a href={CLOUDAGNI_URL} className={link}>
              CloudAgni
            </a>
            <a href={DUKUNG_JAM_PATH} className={link} {...goal("dukung_jam_click", "footer")}>
              Dukung jam
            </a>
            <a
              href={TRAKTEER_URL}
              className={link}
              target="_blank"
              rel="noopener"
              {...goal("trakteer_click", "footer")}
            >
              Dukung di Trakteer
            </a>
          </FooterColumn>
          <FooterColumn title="Terbuka">
            <a href={GITHUB_URL} className={link}>
              Kode sumber
            </a>
            <a href={PRIVASI_PATH} className={link}>
              Privasi
            </a>
            <a href={`${GITHUB_URL}/blob/master/LEGAL.md`} className={link} target="_blank" rel="noopener">
              Hukum
            </a>
          </FooterColumn>
        </nav>
      </div>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 pt-4 pb-2 text-xs leading-relaxed text-muted-foreground md:px-6">
        <p>© {new Date().getFullYear()} JoyoFit · AGPL-3.0</p>
        <p>{ANDROID_ROBOT_CREDIT}</p>
      </div>
      <FooterLandscape />
    </footer>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
      {children}
    </h2>
  );
}

function Dot() {
  return (
    <span aria-hidden className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
  );
}

function Hero() {
  const platform = usePlatform();
  return (
    <section
      data-section="hero"
      className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-8 pb-14 md:grid-cols-[1.05fr_1fr] md:gap-8 md:px-6 md:pt-14 md:pb-20"
    >
      <div>
        <h1 className="max-w-xl text-[2.625rem] leading-[1.04] font-extrabold tracking-tight text-balance md:text-[4rem]">
          <span className="mb-3 block text-base leading-snug font-bold tracking-normal text-primary md:text-lg">
            Aplikasi pengganti Huawei Health
          </span>
          <span className="block">Jam-mu.</span>
          <span className="block">Data-mu.</span>
          <span className="block">HP-mu.</span>
        </h1>
        {/* Headline and lead stay unfaded: the lead is the LCP element on mobile, and a text fade from opacity 0 would hide it from LCP. */}
        <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground md:text-xl">
          Pendamping jam Huawei yang jalan di HP sendiri. Langkah, detak jantung, tidur, dan olahraga
          ditarik langsung lewat Bluetooth dan disimpan di HP. Tanpa Huawei Health, cloud hanya kalau
          kamu mau. Belum punya jam? Catat latihan beban dari HP saja.
        </p>
        <PlatformButtons location="hero" className="hero-rise mt-8 [--i:1]" />
        <div className="hero-rise mt-4 grid max-w-lg gap-3 text-sm leading-relaxed text-muted-foreground sm:grid-cols-2 [--i:2]">
          <p className={cn(platform === "ios" && "order-1")}>
            <span className="font-bold text-foreground">Android:</span> tes tertutup Google Play. Gabung grup dulu, lalu
            ketuk{" "}
            <a
              href={TESTER_OPTIN_URL}
              target="_blank"
              rel="noopener"
              className="font-semibold text-foreground underline underline-offset-4"
              {...goal("tester_optin_click", "hero")}
            >
              Become a tester
            </a>{" "}
            setelah Google menyetujui akses tesnya. Android 10 ke atas.
          </p>
          {IOS_TESTFLIGHT_LIVE && (
            <p className={cn(platform === "ios" && "-order-1")}>
              <span className="font-bold text-foreground">iPhone:</span> beta publik TestFlight; versi App Store 1.0
              sedang menunggu review Apple. iOS 16.4 ke atas.
            </p>
          )}
        </div>
        <p className="hero-rise mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground [--i:3]">
          Gratis dan open source. Diuji di Watch Fit 4 Pro, Band 8, Band 11 Pro, dan Watch Fit 2, jam lain eksperimen.{" "}
          <a
            href={DUKUNG_JAM_PATH}
            className="font-semibold text-foreground underline underline-offset-4"
            {...goal("dukung_jam_click", "hero")}
          >
            Jam-mu belum diuji? Bantu kami mendukungnya.
          </a>
        </p>
        <div className="hero-rise mt-4 flex flex-wrap items-center gap-3 [--i:4]">
          <ButtonLink variant="secondary" href="#cara">
            Cara pakai
          </ButtonLink>
          <ButtonLink variant="secondary" href={GITHUB_URL} target="_blank" rel="noopener">
            <GithubMark className="size-[1.125rem]" />
            GitHub
          </ButtonLink>
        </div>
        <p className="hero-rise mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground [--i:5]">
          Di browser:{" "}
          <a href="#web" className="font-semibold text-foreground underline underline-offset-4">
            JoyoFit Web
          </a>
          ,{" "}
          <a href="#web" className="font-semibold text-foreground underline underline-offset-4">
            Studio
          </a>{" "}
          dan{" "}
          <a href="#ride" className="font-semibold text-foreground underline underline-offset-4">
            Ride
          </a>
          .
        </p>
      </div>

      <figure className="relative mx-auto w-full max-w-[22rem] md:max-w-[26rem]">
        <div
          aria-hidden
          className="hero-backdrop absolute inset-x-4 top-10 bottom-6 rounded-[2.5rem] bg-makan-soft md:inset-x-0"
        />
        <Phone
          priority
          className="relative"
          src="/shots/today.webp"
          alt="Layar Hari ini di JoyoFit: jam terhubung, langkah, detak jantung 80 bpm, baterai 58 persen, dan tombol Sync now. Antarmuka aplikasi berbahasa Inggris."
        />
        <div
          className="hero-card relative z-10 mx-auto -mt-4 w-[13.5rem] rounded-[1.25rem] bg-card p-3.5 shadow-float md:absolute md:bottom-6 md:-left-20 md:mx-0 md:mt-0 md:w-60"
          role="img"
          aria-label="Skor tidur 84 dari jam, tidur 6 jam 45 menit."
        >
          <p className="flex items-center gap-1.5 text-[0.6875rem] font-bold text-muted-foreground">
            <Moon className="size-3.5" aria-hidden />
            Tidur semalam
          </p>
          <div className="mt-2 flex items-center gap-3">
            <Ring value={84} max={100} tone="tidur" size={64} stroke={7} label="Skor tidur 84">
              <span className="text-base leading-none font-extrabold tabular-nums">84</span>
            </Ring>
            <div>
              <p className="text-xl leading-none font-extrabold tracking-tight tabular-nums">6 j 45 mnt</p>
              <p className="mt-1 text-xs text-muted-foreground">skor dari jam</p>
            </div>
          </div>
        </div>
      </figure>
    </section>
  );
}

function Facts() {
  return (
    <section aria-label="Fakta singkat" className="border-y border-border/70 bg-card">
      <dl className="mx-auto grid w-full max-w-6xl grid-cols-2 px-4 md:grid-cols-4 md:px-6">
        {FACTS.map((fact, i) => (
          <div
            key={fact.value}
            className={`py-6 md:py-8 ${i % 2 === 1 ? "pl-5 md:pl-8" : i > 0 ? "md:pl-8" : ""} ${i > 0 ? "md:border-l md:border-border/70" : ""} ${i % 2 === 1 ? "border-l border-border/70" : ""} ${i > 1 ? "border-t border-border/70 md:border-t-0" : ""}`}
          >
            <dd>
              {"href" in fact ? (
                <a href={fact.href} className="block rounded-lg hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none">
                  <span className="block text-2xl font-extrabold tracking-tight tabular-nums underline decoration-border decoration-2 underline-offset-4 md:text-3xl">
                    {fact.value}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">{fact.label}</span>
                </a>
              ) : (
                <>
                  <span className="block text-2xl font-extrabold tracking-tight tabular-nums md:text-3xl">
                    {fact.value}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">{fact.label}</span>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Basics() {
  return (
    <section
      id="fitur"
      data-section="basics"
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-20 md:px-6 md:py-28"
    >
      <div className="max-w-2xl">
        <SectionTitle>Semua data jam-mu, di HP-mu.</SectionTitle>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Sinkron pertama menarik 7 hari terakhir, sinkron berikutnya lanjut dari terakhir. Mode
          latar belakang menjaga jam tetap terhubung dan menyinkron tiap 30 menit.
        </p>
      </div>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {BASICS.map((item) => (
          <article key={item.title} className="flex items-start gap-5 rounded-[1.75rem] bg-card p-5 md:block md:p-7">
            <span className={`flex size-14 shrink-0 items-center justify-center rounded-full ${item.tone}`}>
              <item.icon className="size-7" aria-hidden />
            </span>
            <div>
              <h3 className="text-xl font-extrabold tracking-tight md:mt-6">{item.title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">{item.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SleepSection() {
  return (
    <section data-section="sleep" className="scroll-mt-16 bg-card py-20 md:py-28">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 md:grid-cols-[1fr_1.05fr] md:gap-16 md:px-6">
        <div>
          <SectionTitle>Tidur lengkap dengan tahapnya</SectionTitle>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Tahap tidur dari TruSleep dan skor tidur yang dihitung jam sendiri, ditampilkan per malam
            dengan garis waktu tahapnya.
          </p>
          <ol className="mt-8 space-y-5">
            {[
              ["Pakai jam tidur", "Nyalakan sensor detak jantung, SpO2, dan TruSleep di Pengaturan. Aplikasi menyalakannya di jam tiap kali tersambung."],
              ["Sinkron pagi hari", "Tekan Sync now, atau biarkan mode latar belakang yang bekerja."],
              ["Lihat malammu", "Durasi tidur, persen tiap tahap, dan skor dari jam."],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground tabular-nums">
                  {i + 1}
                </span>
                <div>
                  <p className="font-bold">{title}</p>
                  <p className="mt-0.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-8 rounded-2xl border border-border/70 bg-background p-5">
            <p className="flex items-center gap-2 font-bold">
              <Check2 className="size-5 text-primary" />
              Angka dari jam, bukan angka ajaib
            </p>
            <ul className="mt-3 space-y-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
              <li className="flex gap-2.5">
                <Dot />
                Skor tidur dikirim jam; aplikasi tidak membuat skor sendiri.
              </li>
              <li className="flex gap-2.5">
                <Dot />
                Tahap tidur mengikuti kemampuan jam, sama seperti di Gadgetbridge.
              </li>
            </ul>
          </div>
        </div>
        <div>
          <Phone
            src="/shots/sleep.webp"
            alt="Layar Tidur di JoyoFit: 6 jam 45 menit, skor 84, tahap Awake, REM, Light, dan Deep beserta grafik tahap sepanjang malam. Antarmuka berbahasa Inggris."
          />
        </div>
      </div>
    </section>
  );
}

function Workouts() {
  return (
    <section
      data-section="workouts"
      className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-20 md:grid-cols-[1.05fr_1fr] md:gap-16 md:px-6 md:py-28"
    >
      <div className="md:order-2">
        <SectionTitle>Olahraga langsung, lemak dan karbo ikut terhitung</SectionTitle>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Latihan di jam masuk sebagai sesi lengkap. Saat latihan jalan, JoyoFit mengikuti detak
          jantung realtime dari jam dan memperkirakan kalori serta berapa dari lemak dan karbohidrat.
        </p>
        <ul className="mt-6 space-y-2.5">
          {[
            "Mulai otomatis saat jam meminta GPS, atau mulai sendiri dari HP",
            "Kalori dengan rumus Keytel dari detak jantung",
            "Lemak dan karbo terbakar, diperkirakan per zona detak jantung",
            "Rute GPS dari HP untuk latihan di jam, digambar sebagai garis",
          ].map((line) => (
            <li key={line} className="flex gap-2.5 text-[0.9375rem]">
              <Check className="mt-0.5 size-[1.125rem] shrink-0 text-primary" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-6 rounded-2xl bg-muted p-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
          <span className="font-bold text-foreground">Perkiraan, bukan hasil lab.</span> Angka lemak
          dan karbo adalah estimasi dari detak jantung, jangan dipakai sebagai nasihat medis.
        </p>
      </div>
      <div className="md:order-1">
        <article className="rounded-[1.75rem] bg-bakar-soft p-6 md:p-8">
          <h3 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-bakar-ink">
            <Flame className="size-6" aria-hidden />
            Latihan berjalan
          </h3>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-bakar-ink">
            Yang dilacak selama sesi aktif, dari detak jantung jam.
          </p>
          <ul className="mt-6 grid gap-2 sm:grid-cols-2">
            {LIVE.map(({ Icon, name, note }) => (
              <li key={name} className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-bakar-soft text-bakar-ink">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm leading-snug font-bold">{name}</span>
                  <span className="block text-xs text-muted-foreground">{note}</span>
                </span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

const SCORES: { Icon: LucideIcon; name: string; line: string; method: string; tone: string }[] = [
  {
    Icon: Moon,
    name: "Recovery",
    line: "Seberapa pulih badanmu pagi ini, dalam persen.",
    method: "HRV (ln RMSSD) malam ini dibanding baseline 30 harinya, mengikuti Plews dan Buchheit.",
    tone: "bg-tidur-soft text-tidur-ink",
  },
  {
    Icon: Flame,
    name: "Strain",
    line: "Seberapa berat hari ini untuk jantungmu, skala 0 sampai 21.",
    method: "TRIMP Edwards dari zona detak jantung seharian, dipetakan ke skala 0 sampai 21.",
    tone: "bg-bakar-soft text-bakar-ink",
  },
  {
    Icon: HeartPulse,
    name: "Readiness",
    line: "Siap atau perlu santai hari ini.",
    method: "Selisih detak istirahat dari biasanya, tidur dibanding kebutuhan, dan beban latihan 7 hari lawan 28 hari.",
    tone: "bg-makan-soft text-makan-ink",
  },
];

function Scores() {
  return (
    <section id="skor" data-section="scores" className="scroll-mt-16 bg-card py-20 md:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <div className="max-w-2xl">
          <p className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
            Baru, masih diuji
          </p>
          <SectionTitle>Recovery, Strain, dan Readiness</SectionTitle>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Tiga skor harian gaya aplikasi pelatih kebugaran, terinspirasi dari WHOOP tapi bukan
            produk WHOOP. Semuanya dihitung di HP dari data jam-mu dengan metode yang dipublikasikan.
          </p>
        </div>
        <ul className="mt-10 grid gap-4 md:grid-cols-3">
          {SCORES.map(({ Icon, name, line, method, tone }) => (
            <li key={name} className="rounded-[1.75rem] border border-border/70 bg-background p-6">
              <span className={`flex size-10 items-center justify-center rounded-full ${tone}`}>
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-xl font-extrabold tracking-tight">{name}</h3>
              <p className="mt-1 font-semibold">{line}</p>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">{method}</p>
            </li>
          ))}
        </ul>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <p className="rounded-2xl bg-muted p-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
            <span className="font-bold text-foreground">Recovery butuh beberapa malam data.</span>{" "}
            Nyalakan stres otomatis di jam supaya HRV tercatat saat tidur. Sebelum baseline cukup,
            skornya belum muncul.
          </p>
          <p className="rounded-2xl bg-muted p-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
            <span className="font-bold text-foreground">Ukur HRV 1 menit kapan saja.</span> Diam
            sebentar, jam mengukur, hasilnya ikut jadi bahan Recovery. Ini perkiraan, bukan alat
            medis.
          </p>
        </div>
        <p className="mt-4 rounded-2xl bg-makan-soft p-4 text-[0.9375rem] leading-relaxed text-makan-ink">
          <span className="font-bold">Juga di JoyoRogo.</span> Kalau kamu masuk dengan akun{" "}
          <a href={JOYOROGO_URL} className="font-bold underline underline-offset-2">
            JoyoRogo
          </a>
          , skor harian ikut tampil di catatan makanmu, lengkap dengan saran singkat. Misalnya saat
          Strain tinggi, kebutuhan energi dan karbohidratmu lebih besar dari biasa. Saat Recovery
          rendah, utamakan protein, cairan, dan tidur.
        </p>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section
      data-section="features"
      className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-20 md:grid-cols-[1.4fr_1fr] md:px-6 md:py-28"
    >
      <article className="rounded-[1.75rem] bg-makan-soft p-6 md:p-8">
        <h3 className="text-2xl font-extrabold tracking-tight text-makan-ink">
          Makan di JoyoRogo, gerak di JoyoFit
        </h3>
        <p className="mt-2 max-w-md text-[0.9375rem] leading-relaxed text-makan-ink/80">
          JoyoRogo mencatat makananmu dari foto. Asupan kalorinya bisa dikirim ke kartu kalori di
          jam, dan skor harian JoyoFit kembali ke catatan makanmu. JoyoFit tetap bisa dipakai tanpa
          JoyoRogo.
        </p>
        <ul className="mt-6 grid gap-2 sm:grid-cols-3">
          {[
            ["Kartu kalori", "asupan dari JoyoRogo"],
            ["Skor harian", "Recovery dan Strain di JoyoRogo"],
            ["Satu akun", "masuk cloud JoyoFit dengan akun JoyoRogo"],
          ].map(([name, note]) => (
            <li key={name} className="rounded-2xl bg-card px-4 py-3.5">
              <p className="text-sm leading-snug font-semibold">{name}</p>
              <p className="mt-1.5 text-xs font-semibold text-makan-ink">{note}</p>
            </li>
          ))}
        </ul>
        <a
          href={JOYOROGO_URL}
          className="group mt-6 flex items-center gap-4 rounded-2xl bg-card p-3 pr-5 transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-makan-ink focus-visible:outline-none"
        >
          <img src="/brand/joyorogo-icon.webp" alt="" width={56} height={56} loading="lazy" decoding="async" className="size-14 shrink-0 rounded-xl" />
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-extrabold tracking-tight">Coba JoyoRogo</span>
            <span className="block text-sm text-muted-foreground">
              Catat makanmu cukup dari foto
            </span>
          </span>
          <ArrowRight className="size-5 shrink-0 text-makan-ink transition-transform group-hover:translate-x-0.5" aria-hidden />
        </a>
        <p className="mt-4 text-xs text-makan-ink">
          Kartu kalori dibuat dari hasil reverse engineering Huawei Health dan belum diuji di Fit 4
          Pro.
        </p>
      </article>

      <article className="rounded-[1.75rem] bg-card p-6 md:p-8">
        <h3 className="text-2xl font-extrabold tracking-tight">Tampilan jam sendiri</h3>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
          Atur tampilan jam dari HP. Layar watch face dikerjakan bersama kontributor komunitas (terima kasih David4rr).
        </p>
        <ul className="mt-6 space-y-3">
          {FACES.map(({ Icon, name, note }) => (
            <li key={name} className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-bakar-soft text-bakar-ink">
                <Icon className="size-5" aria-hidden />
              </span>
              <span>
                <span className="block text-[0.9375rem] font-bold">{name}</span>
                <span className="block text-sm text-muted-foreground">{note}</span>
              </span>
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}

const SOCIAL_POINTS: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: Users,
    title: "Feed dan grup",
    body: "Feed JoyoRogo dengan tab Following dan Explore. Gabung grup dengan kode undangan; grup baru dibuat lewat JoyoRogo.",
  },
  {
    Icon: MessageCircle,
    title: "Profil, komentar, kudos",
    body: "Buka profil teman, balas komentar, dan beri kudos di latihan mereka.",
  },
  {
    Icon: Share2,
    title: "Share to JoyoRogo",
    body: "Dari layar latihan: tulis caption, pilih Group atau Public, lalu pilih apakah detak jantung, rute, dan perbandingan ikut.",
  },
  {
    Icon: Lock,
    title: "Detail itu fitur Pro",
    body: "Grafik detak jantung dan rute di postingan orang lain butuh JoyoRogo Pro. Milikmu selalu bisa kamu lihat, dan membagikannya gratis.",
  },
];

const COACH_POINTS: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: HeartPulse,
    title: "Saran harian",
    body: "\"Lari santai 30 menit, zona 2\" atau \"istirahat aktif\", dihitung dari kesiapan, HRV, tidur, dan beban latihan. Aturannya terbuka, tanpa AI, dan alasannya ditampilkan.",
  },
  {
    Icon: Route,
    title: "Rencana lari",
    body: "5K, 10K, half marathon, atau lari rutin 3x seminggu. Kamu pilih tujuan, level, dan hari; volume disesuaikan tiap minggu dengan sesi yang selesai dan pemulihanmu.",
  },
  {
    Icon: Dumbbell,
    title: "Kekuatan dan perpustakaan gerakan",
    body: "Full body 2 atau 3 kali seminggu di rumah atau gym, dengan sekitar 100 gerakan lengkap dengan langkah dan kesalahan umum. Sesinya langsung dibuka di pencatat latihan beban.",
  },
  {
    Icon: MessageCircle,
    title: "Tanya coach",
    body: "Chat tentang latihan, pemulihan, dan rencanamu dengan konteks data jam dan catatan makanmu. Maksimal 20 pesan sehari, tidak disimpan di server, dan bukan saran medis.",
  },
];

function CoachSection() {
  return (
    <section id="coach" data-section="coach" className="scroll-mt-16 border-t border-border/70 py-20 md:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <div className="max-w-2xl">
          <p className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">Baru, untuk JoyoRogo Pro</p>
          <SectionTitle>Coach: tahu harus latihan apa hari ini</SectionTitle>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Coach membaca pemulihanmu dan memberi saran latihan hari ini, lengkap dengan rencana lari dan latihan kekuatan. Tanpa jam, kamu menjawab satu pertanyaan, &quot;badanmu terasa bagaimana hari ini&quot;, sebagai pengganti kesiapan. Rencanamu tersimpan di akun JoyoRogo dan ikut ke ponsel lain.
          </p>
        </div>
        <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {COACH_POINTS.map(({ Icon, title, body }) => (
            <li key={title} className="rounded-[1.75rem] bg-card p-6">
              <span className="flex size-10 items-center justify-center rounded-full bg-bakar-soft text-bakar-ink">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-lg font-extrabold tracking-tight">{title}</h3>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[0.9375rem] text-muted-foreground">
          Langkahnya ada di{" "}
          <a href={`${PANDUAN_PATH}#coach`} className="font-semibold text-foreground underline underline-offset-4">
            panduan Coach
          </a>{" "}
          dan{" "}
          <a href="/blog/coach" className="font-semibold text-foreground underline underline-offset-4">
            tulisan tentang Coach
          </a>
          . Coach bukan saran medis.
        </p>
      </div>
    </section>
  );
}

function SocialSection() {
  return (
    <section id="social" data-section="social" className="scroll-mt-16 bg-card py-20 md:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <div className="max-w-2xl">
          <p className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">Baru</p>
          <SectionTitle>Social: latihan dari jam-mu, dilihat teman</SectionTitle>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Tab Social membuka feed{" "}
            <a href={JOYOROGO_URL} className="font-bold underline underline-offset-2">
              JoyoRogo
            </a>{" "}
            di dalam JoyoFit. Masuk dengan akun JoyoRogo, gabung grup temanmu, dan bagikan latihan langsung dari jam.
            Grup juga bisa membagikan skor harian Recovery, Strain, tidur, dan Readiness.
          </p>
        </div>
        <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {SOCIAL_POINTS.map(({ Icon, title, body }) => (
            <li key={title} className="rounded-[1.75rem] border border-border/70 bg-background p-6">
              <span className="flex size-10 items-center justify-center rounded-full bg-makan-soft text-makan-ink">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-lg font-extrabold tracking-tight">{title}</h3>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[0.9375rem] text-muted-foreground">
          Langkahnya ada di{" "}
          <a href={`${PANDUAN_PATH}#social`} className="font-semibold text-foreground underline underline-offset-4">
            panduan Social
          </a>{" "}
          dan{" "}
          <a href="/blog/social-joyofit" className="font-semibold text-foreground underline underline-offset-4">
            tulisan tentang tab Social
          </a>
          .
        </p>
      </div>
    </section>
  );
}

function Screenshot({ name, alt, caption }: { name: string; alt: string; caption: string }) {
  return (
    <figure>
      <div className="overflow-hidden rounded-[1.5rem] border border-border/70 bg-card shadow-float">
        <img
          src={`/shots/${name}.webp`}
          srcSet={`/shots/${name}-640.webp 640w, /shots/${name}.webp 1280w`}
          sizes="(min-width: 1024px) 560px, calc(100vw - 2rem)"
          alt={alt}
          width={1280}
          height={800}
          loading="lazy"
          decoding="async"
          className="block h-auto w-full"
        />
      </div>
      <figcaption className="mt-3 text-sm leading-relaxed text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

const WEB_POINTS: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: LayoutDashboard,
    title: "Ringkasan",
    body: "Beban latihan, pemulihan, HRV, detak jantung istirahat, VO2max, dan tidur di satu halaman, dari data jam yang sudah masuk ke akun JoyoRogo-mu.",
  },
  {
    Icon: Activity,
    title: "Latihan",
    body: "Daftar latihan, lalu detailnya dengan peta rute dan grafik yang disinkronkan satu sama lain.",
  },
  {
    Icon: Moon,
    title: "Tidur dan pemulihan",
    body: "Tahap tidur semalam dan tren pemulihanmu dari hari ke hari, di layar yang lebih lebar dari ponsel.",
  },
  {
    Icon: Upload,
    title: "Unggah",
    body: "Impor file .fit, .gpx, dan .tcx dari perangkat lain. Di sini juga ada perpustakaan tampilan jam yang bisa kamu pasang dari aplikasi.",
  },
  {
    Icon: Plug,
    title: "Koneksi",
    body: "Sambungkan aplikasi AI lewat MCP, buka chat coach, dan ekspor latihan sebagai GPX, FIT, atau JSON.",
  },
];

function WebSection() {
  return (
    <section id="web" data-section="web" className="scroll-mt-16 border-t border-border/70 py-20 md:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <div className="max-w-2xl">
          <p className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
            Untuk JoyoRogo Pro
          </p>
          <SectionTitle>JoyoFit Web: analisis latihan di browser</SectionTitle>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Angka dari jam-mu, dibaca di layar laptop. JoyoFit Web membuka data yang sudah tersimpan di akun JoyoRogo
            untuk dianalisis lebih lega: ringkasan, latihan dengan peta dan grafik, tidur, sampai ekspor. Datanya tetap
            di akunmu, tidak ada akun terpisah.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <ButtonLink href={WEB_URL} target="_blank" rel="noopener" {...goal("joyofit_web_click", "web_section")}>
              Buka JoyoFit Web
              <ArrowRight className="size-[1.125rem]" aria-hidden />
            </ButtonLink>
            <ButtonLink variant="secondary" href="/blog/joyofit-web">
              Baca selengkapnya
            </ButtonLink>
          </div>
        </div>
        <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {WEB_POINTS.map(({ Icon, title, body }) => (
            <li key={title} className="rounded-[1.75rem] bg-card p-6">
              <span className="flex size-10 items-center justify-center rounded-full bg-tidur-soft text-tidur-ink">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-lg font-extrabold tracking-tight">{title}</h3>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
          <li className="rounded-[1.75rem] border border-primary/30 bg-primary/5 p-6">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Lock className="size-5" aria-hidden />
            </span>
            <h3 className="mt-4 text-lg font-extrabold tracking-tight">Perlu JoyoRogo Pro</h3>
            <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted-foreground">
              Masuk dengan akun JoyoRogo yang sama dengan di aplikasi. Pro mulai {PRICE.monthly} per bulan atau{" "}
              {PRICE.yearly} per tahun.
            </p>
            <a
              href={HARGA_URL}
              className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-primary underline-offset-4 hover:underline"
              {...goal("founder_cta_click", "web_section")}
            >
              Lihat harga di joyorogo.com
              <ArrowRight className="size-4" aria-hidden />
            </a>
          </li>
        </ul>
        <div className="mt-14 grid items-center gap-8 lg:grid-cols-[1fr_1.1fr] lg:gap-12">
          <div className="max-w-md">
            <p className="inline-flex rounded-full bg-makan-soft px-3 py-1 text-xs font-bold text-makan-ink">
              Gratis, tanpa Pro
            </p>
            <h3 className="mt-3 text-2xl font-extrabold tracking-tight text-balance md:text-3xl">
              JoyoFit Studio: rancang tampilan jam
            </h3>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              Editor tampilan jam untuk Huawei Watch Fit 4 dan Fit 4 Pro. Kamu menggambar di browser, mengekspornya
              sebagai gambar 408 × 480, lalu memilihnya di JoyoFit lewat Watch, Photo face. Tidak ada yang diunggah
              kecuali kamu sendiri yang menyimpan proyek ke akun Pro.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Photo face hanya gambar: jam menggambar sendiri waktu dan datanya di atasnya.
            </p>
            <ButtonLink
              variant="secondary"
              className="mt-5"
              href={STUDIO_URL}
              target="_blank"
              rel="noopener"
              {...goal("joyofit_studio_click", "web_section")}
            >
              <Palette className="size-[1.125rem]" aria-hidden />
              Buka Studio
            </ButtonLink>
          </div>
          <Screenshot
            name="studio-face"
            alt="JoyoFit Studio di browser: daftar lapisan di kiri, pratinjau tampilan jam Olahraga dengan jam 10.09, detak jantung, baterai, dan cincin langkah di tengah, serta slider jam simulasi."
            caption="Studio dengan template Olahraga. Nilai di pratinjau hanya contoh dari slider jam simulasi."
          />
        </div>
      </div>
    </section>
  );
}

const RIDE_MODES: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: Bike,
    title: "Bebas",
    body: "Gowes rute pilihanmu. Rekor terbaikmu di rute itu jadi bayangan yang bisa kamu kejar, dan waktu tiap segmen sprint dan tanjakan dicatat.",
  },
  {
    Icon: Timer,
    title: "Latihan interval",
    body: "Blok kadens terstruktur: Tempo 3 × 4 menit, Hard 4 × 4 menit, atau Sprint 8 × 20 detik. Layar menunjukkan target kadens dan berapa persen waktumu tepat sasaran.",
  },
  {
    Icon: Medal,
    title: "Tantangan harian",
    body: "Satu rute dan target waktu yang sama untuk semua pemain tiap hari. Selesai di bawah target dapat emas, dalam 5 persen perak, dalam 15 persen perunggu.",
  },
  {
    Icon: Trophy,
    title: "Papan peringkat",
    body: "Waktu terbaik per rute, hari ini dan sepanjang masa, top 20. Hanya rute selesai yang dikayuh dengan sensor lewat HP yang masuk, dan kamu bisa menyembunyikan namamu.",
  },
];

const RIDE_STEPS = [
  "Buka fit.joyorogo.com/ride di browser laptop, tablet, atau TV.",
  "Buka JoyoFit di HP, masuk ke JoyoRogo, lalu pilih Main di web. Pindai QR atau ketik kode 6 angka di layar.",
  "Nyalakan sensor kadens Bluetooth-mu, pilih rute, lalu mulai mengayuh.",
];

function RideSection() {
  return (
    <section id="ride" data-section="ride" className="scroll-mt-16 bg-card py-20 md:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-12">
          <div>
            <p className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">Gratis</p>
            <SectionTitle>JoyoFit Ride: main sepeda virtual di web</SectionTitle>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Sepedaan indoor di layar besar, sensornya dari HP-mu. Kadens dari pedalmu menggerakkan pesepeda 3D di
              rute berpemandangan Indonesia: pantai, bukit, kebun, dan tanjakan Bromo. Kamu bisa langsung mencoba
              tanpa sensor lewat mode demo.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <ButtonLink href={RIDE_PATH} {...goal("ride_click", "ride_section")}>
                <Bike className="size-[1.125rem]" aria-hidden />
                Main sekarang
              </ButtonLink>
              <ButtonLink variant="secondary" href="/blog/joyofit-ride">
                Baca selengkapnya
              </ButtonLink>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Alamat yang sama juga ada di{" "}
              <a href={RIDE_WEB_URL} className="font-semibold text-foreground underline underline-offset-4">
                app.fit.joyorogo.com/ride
              </a>
              . Memainkannya tidak butuh JoyoRogo Pro.
            </p>
          </div>
          <Screenshot
            name="ride-hud"
            alt="Layar Ride di rute Bromo: pesepeda di jalan menanjak, daftar pesepeda bot dengan selisih waktu, dan HUD berisi kecepatan, kadens, detak jantung, daya estimasi, kemiringan, gigi, dan profil tanjakan."
            caption="Rute Bromo dalam mode demo. Pesepeda lain adalah bot, dan daya di HUD berlabel estimasi."
          />
        </div>
        <ul className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {RIDE_MODES.map(({ Icon, title, body }) => (
            <li key={title} className="rounded-[1.75rem] border border-border/70 bg-background p-6">
              <span className="flex size-10 items-center justify-center rounded-full bg-bakar-soft text-bakar-ink">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-lg font-extrabold tracking-tight">{title}</h3>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
        <div className="mt-12 grid items-center gap-8 lg:grid-cols-[1fr_1.1fr] lg:gap-12">
          <div>
            <h3 className="text-xl font-extrabold tracking-tight md:text-2xl">Cara mulai</h3>
            <ol className="mt-5 space-y-4">
              {RIDE_STEPS.map((step, i) => (
                <li key={step} className="flex gap-3.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-extrabold tabular-nums">
                    {i + 1}
                  </span>
                  <p className="pt-0.5 text-[0.9375rem] leading-relaxed">{step}</p>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Di Chrome laptop atau Android, sensor detak jantung dan kadens juga bisa disambung langsung lewat Web
              Bluetooth tanpa HP, tetapi hasilnya tidak masuk papan peringkat.
            </p>
          </div>
          <Screenshot
            name="ride-routes"
            alt="Layar pilih rute Ride: mode Bebas, Latihan interval, dan Tantangan harian, lalu rute Pantai, Bukit, Kebun, dan Bromo dengan jarak dan tanjakan masing-masing."
            caption="Pilih mode dan rute: Pantai 12 km, Bukit 9 km, Kebun 3 km, Bromo 8 km."
          />
        </div>
      </div>
    </section>
  );
}

const SEND_POINTS: { Icon: LucideIcon; title: string; body: string; href?: string; label?: string }[] = [
  {
    Icon: Share2,
    title: "Kartu bagikan",
    body: "Latihan atau ringkasan Hari ini jadi gambar Story 9:16 atau Square 1:1, berlatar rute, fotomu, atau stiker transparan. Kirim ke Instagram Stories, salin, atau simpan.",
    href: "/blog/kartu-bagikan",
    label: "Soal kartu bagikan",
  },
  {
    Icon: Upload,
    title: "Upload ke Strava",
    body: "Olahraga dikirim ke Strava sebagai file FIT berisi angka dari jam: jarak, waktu gerak, kalori, detak jantung, elevasi, kadensi, dan rute. Angka di JoyoFit sama dengan yang tampil di Strava. Gratis selama slot masih ada; sebagian slot disimpan untuk pengguna Pro, dan unggah manual selalu bisa.",
    href: "/blog/strava-file-fit",
    label: "Soal upload Strava",
  },
  {
    Icon: Footprints,
    title: "Sepatu dan sepeda",
    body: "Catat jarak seumur pakai per sepatu atau sepeda, atur bawaan per olahraga, dan dapat pengingat pensiun di 90 dan 100 persen jarak yang kamu tetapkan. Bisa ditautkan ke sepatu dan sepeda di Strava. Salinan cloud-nya fitur JoyoRogo Pro.",
  },
  {
    Icon: ListChecks,
    title: "Panduan awal",
    body: "Saat pertama dibuka, aplikasi menuntun dari lepas jam dari Huawei Health, pairing, dan sinkron pertama sampai izin dan masuk JoyoRogo. Bisa dilewati, dilanjutkan, dan dibuka lagi dari Settings.",
    href: "/blog/panduan-awal",
    label: "Soal panduan awal",
  },
];

function SendSection() {
  return (
    <section data-section="send" className="mx-auto w-full max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <div className="max-w-2xl">
        <SectionTitle>Bagikan, kirim, dan mulai tanpa bingung</SectionTitle>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Empat hal yang sudah ada di aplikasi sekarang. JoyoFit dari Google Play juga memberi tahu kalau ada versi baru.
        </p>
      </div>
      <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {SEND_POINTS.map(({ Icon, title, body, href, label }) => (
          <li key={title} className="flex flex-col rounded-[1.75rem] bg-card p-6 md:p-7">
            <span className="flex size-12 items-center justify-center rounded-full bg-bakar-soft text-bakar-ink">
              <Icon className="size-6" aria-hidden />
            </span>
            <h3 className="mt-5 text-xl font-extrabold tracking-tight">{title}</h3>
            <p className="mt-2 flex-1 text-[0.9375rem] leading-relaxed text-muted-foreground">{body}</p>
            {href && (
              <a
                href={href}
                className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-primary underline-offset-4 hover:underline"
              >
                {label}
                <ArrowRight className="size-4" aria-hidden />
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function WatchSection() {
  return (
    <section data-section="watch" className="scroll-mt-16 bg-tidur-soft py-20 md:py-28">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 md:grid-cols-[1.05fr_1fr] md:gap-16 md:px-6">
        <div>
          <SectionTitle>Jam yang ikut bekerja untukmu.</SectionTitle>
          <p className="mt-4 text-lg leading-relaxed text-tidur-ink/90">
            Notifikasi, cuaca, alarm, dan cari jam. Cukup nyalakan mode latar belakang, JoyoFit
            menjaga jam tetap tersambung.
          </p>
          <ul className="mt-8 space-y-5">
            {WATCH_FEATURES.map((feature) => (
              <li key={feature.title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-tidur-ink">
                  <feature.icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="font-bold">{feature.title}</p>
                  <p className="mt-0.5 text-[0.9375rem] leading-relaxed text-tidur-ink/80">{feature.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <Phone
          src="/shots/watch.webp"
          alt="Layar Watch di JoyoFit: Watch faces, Photo face, Alarms, dan tombol Ring the watch untuk mencari jam. Antarmuka berbahasa Inggris."
        />
      </div>
    </section>
  );
}

const STRENGTH_POINTS: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: Timer,
    title: "Timer istirahat",
    body: "Satu timer untuk seluruh aplikasi, dengan notifikasi lokal saat habis dan layar tetap menyala selama sesi.",
  },
  {
    Icon: Dumbbell,
    title: "Set, RPE, superset",
    body: "Set biasa, pemanasan, drop set, dan sampai gagal. Beban dan ulangan sesi lalu tampil di tiap baris, rekor ditandai di ringkasan. Pemanasan tidak dihitung ke volume.",
  },
  {
    Icon: ListChecks,
    title: "Rutinitas dan perpustakaan gerakan",
    body: "Buat rutinitas sendiri, simpan di folder, atau salin rutinitas awal. Sekitar 100 gerakan dengan langkah, otot, dan kesalahan umum; gerakan sendiri bisa kamu tambah.",
  },
  {
    Icon: History,
    title: "Riwayat, grafik, peta otot",
    body: "Riwayat dengan kalender di samping latihan dari jam, grafik per gerakan, dan peta panas otot mingguan.",
  },
];

function StrengthSection() {
  return (
    <section id="beban" data-section="strength" className="scroll-mt-16 bg-card py-20 md:py-28">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 md:grid-cols-[1.1fr_1fr] md:gap-12 md:px-6">
        <div>
          <p className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">Baru</p>
          <SectionTitle>Latihan beban, dengan jam atau tanpa jam</SectionTitle>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Pencatat latihan beban ada di dalam JoyoFit dan gratis. Kamu tidak perlu jam: kalorinya
            diperkirakan dari jumlah set dengan metode MET. Kalau jam merekam sesi yang sama, angka
            jam yang dipakai dan jam tidak membuat catatan ganda.
          </p>
          <ul className="mt-8 grid gap-6 sm:grid-cols-2">
            {STRENGTH_POINTS.map(({ Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-bakar-soft text-bakar-ink">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div>
                  <h3 className="font-bold">{title}</h3>
                  <p className="mt-0.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-[0.9375rem] leading-relaxed text-muted-foreground">
            Sesi selesai bisa dikirim ke Strava, dan kalorinya masuk ke JoyoRogo. Riwayat beban yang disalin ke cloud adalah fitur{" "}
            <a href={HARGA_URL} className="font-semibold text-foreground underline underline-offset-4" {...goal("founder_cta_click", "strength")}>
              JoyoRogo Pro
            </a>
            ; mencatat dan melihat riwayat di HP tetap gratis. Pencatat latihan beban pindah ke sini dari JoyoRogo; riwayat lamamu bisa diimpor.
          </p>
        </div>
        <div className="flex justify-center gap-4 md:gap-5">
          <Phone
            className="md:w-52 lg:w-56"
            src="/shots/strength-routines.webp"
            alt="Layar Routines di pencatat latihan beban JoyoFit: mulai latihan kosong, rutinitas sendiri, folder, dan rutinitas awal. Antarmuka berbahasa Inggris."
          />
          <Phone
            className="mt-12 hidden md:block md:w-52 lg:w-56"
            src="/shots/strength-exercises.webp"
            alt="Layar Exercises: perpustakaan gerakan yang bisa dicari, dengan otot utama di tiap gerakan. Antarmuka berbahasa Inggris."
          />
        </div>
      </div>
    </section>
  );
}

const COMING_SOON: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: Watch,
    title: "Lebih dari satu jam",
    body: "Simpan beberapa jam di JoyoFit, misalnya satu untuk harian dan satu untuk lari. Satu jam aktif, ganti dengan satu ketukan. Data harian tetap milik satu jam utama, dan latihan yang direkam dua jam tidak tercatat dua kali.",
  },
  {
    Icon: Radio,
    title: "Sensor Bluetooth dan rekam dari HP",
    body: "Chest strap detak jantung, sensor kadens dan kecepatan sepeda, power meter, dan foot pod. Latihan direkam langsung dari HP dengan GPS dan sensor, dan tetap jalan saat layar terkunci. Yang didukung sensor Bluetooth, bukan ANT+, karena HP tidak punya radio ANT.",
  },
  {
    Icon: Bike,
    title: "Data bersepeda kelas pro",
    body: "Normalized Power, TSS, FTP, kurva power, dan deteksi tanjakan dari power meter-mu.",
  },
  {
    Icon: Watch,
    title: "Bahasa jam ikut bahasa aplikasi",
    body: "JoyoFit mengirim bahasa HP (atau yang kamu pilih) ke jam setiap tersambung, supaya suara arahan latihan tidak tinggal berbahasa Mandarin. Butuh build toko; belum diuji di jam nyata.",
  },
  {
    Icon: Route,
    title: "Rute GPS ke Health Connect",
    body: "Latihan berGPS ikut membawa rutenya ke Health Connect, jadi aplikasi lain bisa menggambar petanya. Butuh build toko, baru di tes internal.",
  },
  {
    Icon: Dumbbell,
    title: "Latihan beban mulai dari HP",
    body: "Mulai latihan beban di HP, jam ikut memulai Latihan kekuatan, jeda, dan berhenti. Butuh build toko; belum diuji di jam nyata.",
  },
  {
    Icon: MessageCircle,
    title: "Balasan pintar dan balasan cepat",
    body: "Balas pesan dari jam: balasan pintar ke aplikasi Android, dan daftar balasan cepat (Otw, Lagi nyetir, dan lainnya) yang bisa kamu atur sendiri. Butuh build toko, baru di tes internal.",
  },
];

const NEW_IN_APP: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: LayoutDashboard,
    title: "Bilah tab baru",
    body: "Hari ini, Latihan, tombol Mulai di tengah, Social, dan Lainnya. Jam dan Pengaturan pindah ke Lainnya, dan tombol tengah membuka menu mulai latihan dari tab mana pun.",
  },
  {
    Icon: Route,
    title: "Rekam latihan dimulai dari peta",
    body: "Posisimu di peta, satu pil untuk sinyal GPS dan sensor, deretan ikon olahraga, dan satu tombol Mulai. Treadmill dan olahraga dalam ruangan memakai angka besar.",
  },
  {
    Icon: Download,
    title: "Simpan file FIT dan GPX",
    body: "Dari layar latihan, simpan .fit (dan GPX kalau ada rute) ke HP tanpa internet, bagikan, atau upload sendiri di strava.com.",
  },
  {
    Icon: Palette,
    title: "17 tema, termasuk pastel dan batik",
    body: "Enam tema pastel baru (Sakura, Lavender, Persik, Rose Gold, Susu Stroberi, Matcha Latte) dan hiasan header, termasuk batik kawung di tema Sogan.",
  },
  {
    Icon: Share2,
    title: "Post ke JoyoRogo dengan lembar profil",
    body: "Membagikan latihan tanpa profil JoyoRogo kini membuka lembar yang menjelaskan kenapa dan mengantarmu menyelesaikan profil, bukan pesan galat.",
  },
  {
    Icon: Watch,
    title: "Pesan jam yang lebih jelas",
    body: "Watch face yang tidak ditandatangani Huawei dijelaskan dalam bahasamu, dan pesan GNSS kedaluwarsa saat mulai olahraga luar ruangan punya petunjuk tenang: tunggu ikon GPS di jam.",
  },
];

function NewInAppSection() {
  return (
    <section id="baru" data-section="new" className="scroll-mt-16 bg-card py-20 md:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <div className="max-w-2xl">
          <p className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">Sudah ada</p>
          <SectionTitle>Baru di aplikasi</SectionTitle>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Perubahan tampilan dan layar ini sampai lewat pembaruan langsung, tanpa update dari toko. Yang butuh build toko ada di Segera hadir di bawah.
          </p>
        </div>
        <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {NEW_IN_APP.map(({ Icon, title, body }) => (
            <li key={title} className="rounded-[1.75rem] bg-background p-6 md:p-7">
              <span className="flex size-12 items-center justify-center rounded-full bg-bakar-soft text-bakar-ink">
                <Icon className="size-6" aria-hidden />
              </span>
              <h3 className="mt-5 text-xl font-extrabold tracking-tight">{title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ComingSoonSection() {
  return (
    <section id="segera" data-section="coming" className="scroll-mt-16 mx-auto w-full max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <div className="max-w-2xl">
        <SectionTitle>Segera hadir</SectionTitle>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Tiga hal pertama sudah dikerjakan di cabang pengembangan. Empat berikutnya sudah selesai tapi butuh build toko baru, jadi baru ada di tes internal, belum di Play atau App Store. Belum ada tanggal.
        </p>
      </div>
      <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {COMING_SOON.map(({ Icon, title, body }) => (
          <li key={title} className="flex flex-col rounded-[1.75rem] border border-dashed border-border bg-background p-6 md:p-7">
            <div className="flex items-center justify-between gap-3">
              <span className="flex size-12 items-center justify-center rounded-full bg-tidur-soft text-tidur-ink">
                <Icon className="size-6" aria-hidden />
              </span>
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">Segera hadir</span>
            </div>
            <h3 className="mt-5 text-xl font-extrabold tracking-tight">{title}</h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** "2026-10-18" -> "18 Oktober 2026", without Intl so the prerendered and client text cannot differ. */
function roadmapDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Reads docs/roadmap.json, the same file the README section is generated from (scripts/roadmap-sync.ts). */
function RoadmapSection() {
  const { updated, groups } = roadmap as { updated: string; groups: { id: string; title: string; items: string[] }[] };
  return (
    <section id="roadmap" data-section="roadmap" className="scroll-mt-16 bg-card py-20 md:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <div className="max-w-2xl">
          <SectionTitle>Roadmap</SectionTitle>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Yang sedang dikerjakan dan yang menyusul. Urutannya bisa berubah dan belum ada tanggal. Diperbarui {roadmapDate(updated)}.
          </p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr]">
          {groups.map((group) => (
            <section
              key={group.id}
              aria-labelledby={`roadmap-${group.id}`}
              className={cn(
                "rounded-[1.75rem] p-6 md:p-7",
                group.id === "doing" ? "bg-bakar-soft md:col-span-2 lg:col-span-1" : "bg-background",
              )}
            >
              <h3
                id={`roadmap-${group.id}`}
                className={cn("text-xl font-extrabold tracking-tight", group.id === "doing" && "text-bakar-ink")}
              >
                {group.title}
              </h3>
              <ul className="mt-4 space-y-3">
                {group.items.map((item) => (
                  <li key={item} className="flex gap-3 text-[0.9375rem] leading-relaxed">
                    <Dot />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-6 text-[0.9375rem] text-muted-foreground">
          Ada fitur yang kamu tunggu?{" "}
          <a href={`${GITHUB_URL}/issues`} className="font-semibold text-foreground underline underline-offset-4" target="_blank" rel="noopener">
            Tulis di GitHub
          </a>
          .
        </p>
      </div>
    </section>
  );
}

function Chips({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-4 flex flex-wrap gap-2">
      {items.map((m) => (
        <li key={m} className="rounded-full bg-muted px-3 py-1 text-sm font-medium text-foreground">
          {m}
        </li>
      ))}
    </ul>
  );
}

function JamTeaser() {
  return (
    <section data-section="jam" className="border-t border-border/70 py-14 md:py-16">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 md:flex-row md:items-center md:justify-between md:px-6">
        <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
          Diuji di Watch Fit 4 Pro, Band 8, Band 11 Pro, dan Watch Fit 2. Puluhan jam Huawei dan Honor lain bisa dicoba.
        </p>
        <div className="flex shrink-0 flex-wrap gap-3">
          <ButtonLink variant="secondary" href={JAM_PATH}>
            Lihat daftar jam
          </ButtonLink>
          <ButtonLink variant="outline" href={DUKUNG_JAM_PATH} {...goal("dukung_jam_click", "teaser")}>
            <Watch aria-hidden />
            Dukung jam barumu
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

function TimbanganTeaser() {
  return (
    <section data-section="timbangan" className="border-t border-border/70 py-14 md:py-16">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 md:flex-row md:items-center md:justify-between md:px-6">
        <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
          Punya timbangan badan Bluetooth? JoyoFit membaca Xiaomi, Renpho, Yunmai, dan merek lain, lalu
          mengirim beratmu ke JoyoRogo. Baru satu jenis yang diuji di timbangan asli.
        </p>
        <div className="flex shrink-0 flex-wrap gap-3">
          <ButtonLink variant="secondary" href={TIMBANGAN_PATH} {...goal("timbangan_click", "teaser")}>
            <Weight aria-hidden />
            Lihat daftar timbangan
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

function Promises() {
  return (
    <section aria-label="Janji privasi" className="border-y border-border/70 bg-card">
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:grid-cols-3 md:px-6 md:py-12">
        {PROMISES.map((promise) => (
          <div key={promise.title} className="flex items-start gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-makan-soft text-makan-ink">
              <promise.icon className="size-5" aria-hidden />
            </span>
            <div>
              <p className="font-bold">{promise.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{promise.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md bg-muted px-1.5 py-0.5 text-[0.85em] font-semibold text-foreground">
      {children}
    </code>
  );
}

const UNBIND_STEP =
  "Lepas jam dari Huawei Health dulu (Unbind), lalu pasangkan di tab Watch. Jam hanya bisa terikat ke satu HP dalam satu waktu, jadi memasangkannya di sini menggantikan pairing yang lama.";

const ANDROID_STEPS = [
  "Gabung grup Google joyofit-testers dengan akun Google yang kamu pakai di Play Store. Grup inilah yang memberi akses ke tes tertutup.",
  "Setelah Google mengaktifkan aksesnya, buka halaman tes di Play dan ketuk Become a tester. Kalau halaman belum bisa dibuka, tunggu sebentar lalu coba lagi.",
  "Pasang JoyoFit dari Play Store. Data jam tetap tersimpan di HP; masuk dengan akun JoyoRogo hanya perlu kalau kamu mau cloud.",
  UNBIND_STEP,
] as const;

const IOS_STEPS = [
  "Pasang TestFlight dari App Store, kalau belum ada di iPhone-mu.",
  "Buka link TestFlight JoyoFit di iPhone dan ketuk Terima.",
  "Ketuk Pasang di TestFlight untuk memasang JoyoFit.",
  UNBIND_STEP,
] as const;

const IOS_LIMITS = [
  "Butuh iOS 16.4 ke atas. Baru diuji dengan Huawei Watch Fit 4 Pro; jam lain belum dicoba di iPhone.",
  "Watch face, olahraga dengan rute GPS ke Apple Health, cari jam, alarm, cuaca, siklus, makanan, target, olahraga langsung, laporan pagi, impor Huawei Health, dan Strava sudah ada di iPhone. Sebagian baru diuji lewat tes otomatis, belum di iPhone sungguhan.",
  "iOS tidak mengizinkan JoyoFit meneruskan notifikasi aplikasi lain, mencari iPhone dari jam, mengatur panggilan, atau mengirim SMS SOS. Jam membaca notifikasi iPhone sendiri lewat iOS.",
] as const;

type Tab = "android" | "ios";

function StepList({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="space-y-4">
      {steps.map((step, i) => (
        <li key={step} className="flex gap-3.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-sm font-extrabold text-tidur-ink tabular-nums">
            {i + 1}
          </span>
          <p className="pt-0.5 text-[0.9375rem] leading-relaxed text-tidur-ink/90">{step}</p>
        </li>
      ))}
    </ol>
  );
}

/**
 * Android and iPhone install steps behind a segmented switch. Both panels are always in the HTML (the inactive one is
 * `hidden`), so crawlers read both; the visitor's phone picks the tab that opens first.
 */
function Install() {
  const platform = usePlatform();
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab: Tab = picked ?? (platform === "ios" ? "ios" : "android");

  useEffect(() => {
    const fromHash = () => {
      if (location.hash === "#iphone-beta") setPicked("ios");
      else if (location.hash === "#tester") setPicked("android");
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: "android", label: "Android" },
    { id: "ios", label: "iPhone" },
  ];

  return (
    <div data-section="install" className="mt-12 rounded-[1.75rem] bg-tidur-soft p-6 md:p-8">
      <div role="tablist" aria-label="Pilih HP-mu" className="inline-flex rounded-full bg-card p-1">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`install-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={id === "android" ? "tester" : "iphone-beta"}
            onClick={() => setPicked(id)}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full px-5 text-sm font-bold transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
              tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {id === "android" ? <AndroidMark className="mr-2 size-[1.125rem]" /> : <AppleMark className="mr-2 size-[1.125rem]" />}
            {label}
          </button>
        ))}
      </div>

      <div
        id="tester"
        role="tabpanel"
        aria-labelledby="install-tab-android"
        data-section="tester"
        hidden={tab !== "android"}
        className="mt-6 scroll-mt-20"
      >
        <div className="grid gap-8 md:grid-cols-[1fr_1.1fr] md:items-start">
          <div>
            <h3 className="text-2xl font-extrabold tracking-tight text-tidur-ink md:text-3xl">JoyoFit di Android (tes tertutup)</h3>
            <p className="mt-3 max-w-md text-[0.9375rem] leading-relaxed text-tidur-ink/85">
              JoyoFit lewat Google Play masih tes tertutup. Gratis, butuh Android 10 ke atas, dan kamu bisa membantu
              menemukan yang rusak sebelum dirilis untuk semua orang.{" "}
              <a className="font-semibold underline underline-offset-4" href={PANDUAN_PATH}>
                Baca panduan pasang dan pakai
              </a>
              .
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href={TESTER_GROUP_URL} target="_blank" rel="noopener" {...goal("tester_group_click", "cara")}>
                <AndroidMark />
                1. Gabung grup Google
              </ButtonLink>
              <ButtonLink
                variant="outline"
                href={TESTER_OPTIN_URL}
                target="_blank"
                rel="noopener"
                {...goal("tester_optin_click", "cara")}
              >
                2. Become a tester di Play
              </ButtonLink>
            </div>
          </div>
          <StepList steps={ANDROID_STEPS} />
        </div>
      </div>

      {IOS_TESTFLIGHT_LIVE && (
        <div
          id="iphone-beta"
          role="tabpanel"
          aria-labelledby="install-tab-ios"
          data-section="iphone-beta"
          hidden={tab !== "ios"}
          className="mt-6 scroll-mt-20"
        >
          <div className="grid gap-8 md:grid-cols-[1fr_1.1fr] md:items-start">
            <div>
              <h3 className="text-2xl font-extrabold tracking-tight text-tidur-ink md:text-3xl">JoyoFit di iPhone (beta publik)</h3>
              <p className="mt-3 max-w-md text-[0.9375rem] leading-relaxed text-tidur-ink/85">
                Versi iPhone sudah bisa dicoba lewat TestFlight, dan versi App Store 1.0 sedang menunggu review Apple.
                Gratis, butuh iOS 16.4 ke atas, dan masukanmu membantu kami merapikannya.
              </p>
              <div className="mt-6">
                <ButtonLink
                  href={IOS_TESTFLIGHT_URL}
                  target="_blank"
                  rel="noopener"
                  {...goal("ios_testflight_click", "cara")}
                >
                  <AppleMark />
                  Buka TestFlight
                </ButtonLink>
                <p className="mt-3 text-sm">
                  <a
                    href={IPHONE_PATH}
                    className="font-semibold text-tidur-ink underline underline-offset-4"
                    {...goal("iphone_waitlist_click", "cara")}
                  >
                    Detail dan batasan di iPhone
                  </a>
                </p>
              </div>
            </div>
            <div>
              <StepList steps={IOS_STEPS} />
              <p className="mt-6 text-sm font-bold text-tidur-ink">Yang perlu kamu tahu</p>
              <ul className="mt-2 space-y-2">
                {IOS_LIMITS.map((line) => (
                  <li key={line} className="flex gap-2 text-sm leading-relaxed text-tidur-ink/85">
                    <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The two app buttons, the visitor's platform first. Both are always rendered. */
function PlatformButtons({ location, className, buttonClassName }: { location: string; className?: string; buttonClassName?: string }) {
  const platform = usePlatform();
  return (
    <div className={cn("flex flex-wrap gap-3", className)}>
      <ButtonLink
        size="lg"
        className={cn(platform === "ios" && "order-last", buttonClassName)}
        href={TESTER_GROUP_URL}
        target="_blank"
        rel="noopener"
        {...goal("tester_group_click", location)}
      >
        <AndroidMark />
        JoyoFit untuk Android
      </ButtonLink>
      {IOS_TESTFLIGHT_LIVE && (
        <ButtonLink
          size="lg"
          className={cn(platform === "android" && "order-last", buttonClassName)}
          href={IOS_TESTFLIGHT_URL}
          target="_blank"
          rel="noopener"
          {...goal("ios_testflight_click", location)}
        >
          <AppleMark />
          JoyoFit untuk iPhone
        </ButtonLink>
      )}
    </div>
  );
}

function ClosingButtons() {
  return (
    <div className="mt-8 flex flex-col items-center gap-4">
      <PlatformButtons
        location="closing"
        className="justify-center"
        buttonClassName="bg-primary-foreground text-primary hover:bg-primary-foreground/90 focus-visible:ring-primary-foreground/50"
      />
      <ButtonLink
        size="lg"
        variant="ghost"
        className="border-primary-foreground/35 text-primary-foreground hover:bg-primary-foreground/10 focus-visible:ring-primary-foreground/50"
        href="#cara"
      >
        Cara pasang
      </ButtonLink>
    </div>
  );
}

function Options() {
  return (
    <section id="cara" data-section="options" className="scroll-mt-16 border-t border-border/70 py-20 md:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <div className="max-w-2xl">
          <SectionTitle>Tiga cara memakai JoyoFit</SectionTitle>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Aplikasinya selalu gratis dan terbuka. Yang berbeda hanya di mana datamu dicadangkan.
          </p>
        </div>

        <Install />

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {/* 1. Open source */}
          <section className="flex flex-col rounded-[1.75rem] bg-card p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold">Open source</h3>
              <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-bold text-muted-foreground">
                AGPL-3.0
              </span>
            </div>
            <p className="mt-3 text-4xl font-extrabold tracking-tight">Rp0</p>
            <p className="text-sm text-muted-foreground">selamanya</p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {[
                "Seluruh kode di GitHub, termasuk protokol jam",
                "Bangun sendiri dari kode sumber",
                "Data tetap di HP, tanpa cloud",
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                Slot penuh
              </span>
              Gratis selama slot masih ada: olahraga terkirim ke Strava. Slot terbatas, unggah manual selalu bisa.
              <a
                href={STRAVA_PATH}
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
                {...goal("strava_waitlist_click", "cara")}
              >
                Daftar
              </a>
            </p>
            <div className="mt-auto pt-6">
              <ButtonLink variant="secondary" className="w-full" href={GITHUB_URL} target="_blank" rel="noopener">
                <GithubMark className="size-4" />
                Buka GitHub
              </ButtonLink>
            </div>
          </section>

          {/* 2. Self-host on CloudAgni */}
          <section className="flex flex-col rounded-[1.75rem] bg-card p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold">Cloud sendiri di CloudAgni</h3>
              <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-bold text-muted-foreground">
                Self-host
              </span>
            </div>
            <p className="mt-3 text-4xl font-extrabold tracking-tight">Milikmu</p>
            <p className="text-sm text-muted-foreground">server, D1, dan R2 di akunmu</p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {[
                "Worker joyofit-api dari folder server/",
                "Cadangan di database yang kamu kendalikan",
                "Platform edge Indonesia kompatibel Workers",
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-6">
              <ButtonLink variant="secondary" className="w-full" href={SELF_HOST_PATH}>
                <Server aria-hidden />
                Lihat langkahnya
              </ButtonLink>
            </div>
          </section>

          {/* 3. JoyoFit Cloud via JoyoRogo Pro */}
          <section className="flex flex-col rounded-[1.75rem] bg-makan-soft p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-makan-ink">JoyoFit Cloud</h3>
              <span className="inline-flex h-6 items-center rounded-full bg-card px-2.5 text-xs font-bold text-makan-ink">
                JoyoRogo Pro
              </span>
            </div>
            <p className="mt-3 text-4xl font-extrabold tracking-tight tabular-nums">{PRICE.monthly}</p>
            <p className="text-sm text-muted-foreground">per bulan</p>
            <p className="mt-0.5 text-xs font-semibold text-makan-ink">
              Harga perkenalan untuk {PRICE.slots} pembeli pertama, lalu {PRICE.next}/bulan. Atau {PRICE.yearly}/tahun (~Rp16.600/bulan).
            </p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {[
                "Termasuk di JoyoRogo Pro (cadangan cloud JoyoFit)",
                "Server kami yang urus, tanpa setup",
                "Masuk dengan akun JoyoRogo yang sama",
                "Dukungan prioritas: laporan dan permintaan fiturmu didahulukan",
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-makan-ink" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-6">
              <ButtonLink className="w-full" href={HARGA_URL} {...goal("founder_cta_click", "cara")}>
                Ambil JoyoRogo Pro
              </ButtonLink>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Harga dan paket mengikuti joyorogo.com/harga.
              </p>
            </div>
          </section>
        </div>

      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" data-section="faq" className="mx-auto w-full max-w-3xl scroll-mt-16 px-4 pt-20 pb-20 md:px-6 md:pb-28">
      <h2 className="text-3xl font-extrabold tracking-tight md:text-[2.75rem] md:leading-[1.1]">
        Pertanyaan yang sering muncul
      </h2>
      <div className="mt-8 divide-y divide-border/70 rounded-[1.75rem] bg-card">
        {FAQ.map((item) => (
          <details key={item.q} className="group px-5 md:px-6">
            <summary className="-mx-2 flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-2 py-4 text-[1.0625rem] font-bold focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown
                className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden
              />
            </summary>
            <p className="pb-5 text-[0.9375rem] leading-relaxed text-muted-foreground">
              {item.a}
              {item.link && (
                <>
                  {" "}
                  <a
                    className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
                    href={item.link.href}
                    {...(item.link.goal ? goal(item.link.goal.name, item.link.goal.location) : {})}
                  >
                    {item.link.label}
                  </a>
                  .
                </>
              )}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

function OpenSource() {
  return (
    <section data-section="opensource" className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-6">
      <div className="flex flex-col gap-5 rounded-[1.75rem] bg-card p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <div className="flex gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-foreground">
            <GithubMark className="size-6" />
          </span>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight md:text-2xl">
              Kodenya terbuka, bisa kamu cek sendiri
            </h2>
            <p className="mt-1 max-w-xl text-[0.9375rem] leading-relaxed text-muted-foreground">
              Seluruh kode JoyoFit ada di GitHub dengan lisensi AGPL-3.0-or-later, termasuk modul
              protokol yang porting dari Gadgetbridge. Ada yang salah di jam-mu? Buka issue dan
              lampirkan log dari Pengaturan.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-3">
          <ButtonLink variant="outline" href={GITHUB_URL} target="_blank" rel="noopener" {...goal("github_click", "opensource")}>
            <GithubMark className="size-4" />
            Lihat di GitHub
          </ButtonLink>
          <ButtonLink variant="outline" href={TRAKTEER_URL} target="_blank" rel="noopener" {...goal("trakteer_click", "opensource")}>
            <Heart aria-hidden />
            Dukung di Trakteer
          </ButtonLink>
        </div>
      </div>
      <p className="mt-4 max-w-2xl px-1 text-sm leading-relaxed text-muted-foreground">
        JoyoFit gratis dan dibuat di Malang oleh Dzulfikar. Dukungan lewat Trakteer membantu pengembangan dan
        jam untuk diuji, dan tidak membeli fitur atau prioritas.{" "}
        <a
          href={DUKUNG_JAM_PATH}
          className="font-semibold text-foreground underline underline-offset-4"
          {...goal("dukung_jam_click", "opensource")}
        >
          Lihat cara membantu mendukung jam baru.
        </a>
      </p>
    </section>
  );
}

function Closing() {
  return (
    <section data-section="signup" className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-6">
      <div className="rounded-[2rem] bg-primary px-6 py-12 text-center text-primary-foreground md:px-14 md:py-16">
        <h2 className="mx-auto max-w-xl text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
          Pindahkan data jam-mu ke HP hari ini
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-primary-foreground/95">
          Pasang JoyoFit, sambungkan jam lewat Bluetooth, dan data jam-mu ada di HP-mu hari ini juga.
        </p>
        <ClosingButtons />
      </div>
    </section>
  );
}

function SelfHostPage() {
  return (
    <section data-section="self-host" className="py-12 md:py-16">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <a
          href="/#cara"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Kembali ke tiga cara pakai
        </a>
        <div className="mt-4 rounded-[1.75rem] bg-card p-6 md:p-8">
          <div className="flex gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-foreground">
              <Cloud className="size-6" aria-hidden />
            </span>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight md:text-4xl">
                Pasang cloud JoyoFit di CloudAgni
              </h1>
              <p className="mt-1 max-w-2xl text-[0.9375rem] leading-relaxed text-muted-foreground">
                Cloud JoyoFit adalah satu Cloudflare Worker (Hono) dengan database D1 dan bucket R2.
                CloudAgni menjalankan Worker semacam itu dan membuatkan D1 dan R2 dari konfigurasinya.
              </p>
            </div>
          </div>
          <ol className="mt-8 grid gap-6 md:grid-cols-2">
            {[
              [
                "Ambil kodenya",
                <>
                  Klon <Code>github.com/dzulfikar08/joyofit</Code> dan masuk ke folder{" "}
                  <Code>server/</Code>. Konfigurasinya ada di <Code>wrangler.jsonc</Code>: Worker{" "}
                  <Code>joyofit-api</Code>, D1 <Code>DB</Code> (<Code>joyofit</Code>), R2{" "}
                  <Code>IMPORTS</Code> (<Code>joyofit-imports</Code>).
                </>,
              ],
              [
                "Siapkan database",
                <>
                  Skema D1 ada di <Code>migrations/</Code> dan ikut dipasang saat deploy. Ganti{" "}
                  <Code>database_id</Code> dengan milikmu bila deploy memakai Wrangler.
                </>,
              ],
              [
                "Kirim ke CloudAgni",
                <>
                  Login ke <a className="font-semibold text-primary hover:underline" href={CLOUDAGNI_URL}>CloudAgni</a>, lalu
                  jalankan <Code>agni publish ./</Code> dari <Code>server/</Code>. Pack CloudAgni
                  memakai skrip <Code>build</Code> di <Code>package.json</Code>, jadi tambahkan satu
                  yang sederhana bila belum ada.
                </>,
              ],
              [
                "Isi variabel, lalu arahkan aplikasi",
                <>
                  Biarkan <Code>JOYOROGO_AUTH_URL</Code> di <Code>https://api.joyorogo.com</Code>
                  (login tetap lewat akun JoyoRogo). Bangun aplikasinya dengan{" "}
                  <Code>EXPO_PUBLIC_JOYOFIT_CLOUD_URL=https://alamat-workermu</Code>.
                </>,
              ],
            ].map(([title, body], i) => (
              <li key={title as string} className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground tabular-nums">
                  {i + 1}
                </span>
                <div>
                  <p className="font-bold">{title as string}</p>
                  <p className="mt-0.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function JamPage() {
  return (
    <section data-section="jam" className="py-12 md:py-16">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <a
          href="/"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Kembali ke beranda
        </a>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
          Jam Huawei dan Honor yang didukung JoyoFit
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Empat model sudah kami uji: Huawei Watch Fit 4 Pro, Band 8, Band 11 Pro, dan Watch Fit 2. Jam dan band lain di daftar Gadgetbridge masih
          eksperimen: jalur sambungannya ada, tapi belum pernah dicoba dengan JoyoFit.{" "}
          <a
            href={DUKUNG_JAM_PATH}
            className="font-semibold text-foreground underline underline-offset-4"
            {...goal("dukung_jam_click", "jam")}
          >
            Punya jam yang belum diuji? Bantu kami mendukungnya.
          </a>
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-[1.75rem] bg-makan-soft p-6">
            <h3 className="text-xl font-extrabold tracking-tight">Sudah diuji</h3>
            <p className="mt-2 text-sm text-muted-foreground">Dicek langsung di jam asli.</p>
            <Chips items={JAM_SUDAH_DIUJI} />
          </div>
          <div className="rounded-[1.75rem] bg-card p-6">
            <h3 className="text-xl font-extrabold tracking-tight">Eksperimen: jam</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Bluetooth Classic, belum pernah dicoba. Sebagian fitur mungkin tidak jalan.
            </p>
            <Chips items={JAM_EKSPERIMEN_CLASSIC} />
          </div>
          <div className="rounded-[1.75rem] bg-card p-6">
            <h3 className="text-xl font-extrabold tracking-tight">Eksperimen: band dan jam lama</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Bluetooth LE, dibawa dari Gadgetbridge tanpa band untuk mencobanya. Menyambung, pairing, atau sinkron
              bisa gagal. Band harus sudah terpasang (paired) di pengaturan Bluetooth Android.
            </p>
            <Chips items={JAM_EKSPERIMEN_LE} />
            <h3 className="mt-8 text-xl font-extrabold tracking-tight">Belum bisa</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Pairing baru Honor belum diimplementasi:
            </p>
            <Chips items={JAM_BELUM_PAKE} />
            <p className="mt-5 text-sm text-muted-foreground">
              Earphone (FreeBuds dan sejenisnya) bukan jam.
            </p>
          </div>
        </div>
        <p className="mt-6 max-w-3xl text-[0.9375rem] leading-relaxed text-muted-foreground">
          Jam Huawei atau Honor yang tidak ada di daftar tetap dicoba, tapi mungkin tidak jalan.
          Punya jam eksperimen? Sambungkan sekali, lalu di aplikasi buka tab Watch, pilih Bantu
          dukung jam-mu, dan ketuk Kirim laporan. Pesan dan email boleh kamu isi, boleh dikosongkan. Laporan
          langsung sampai ke tim JoyoFit dan mendapat nomor laporan; tanpa internet, laporan menunggu di HP
          sampai bisa terkirim. Isinya teks biasa tanpa alamat Bluetooth dan nomor seri. Kamu juga bisa
          memilih laporan lewat GitHub atau membagikannya. Daftar issue ada di{" "}
          <a
            href={`${GITHUB_URL}/issues`}
            target="_blank"
            rel="noopener"
            className="font-semibold text-foreground underline underline-offset-4"
          >
            GitHub
          </a>
          .
        </p>
        <h2 className="mt-12 text-2xl font-extrabold tracking-tight md:text-3xl">Dari Gadgetbridge ke JoyoFit</h2>
        <p className="mt-3 max-w-3xl text-[0.9375rem] leading-relaxed text-muted-foreground">
          Protokol jam Huawei di JoyoFit adalah port dari{" "}
          <a
            href="https://codeberg.org/Freeyourgadget/Gadgetbridge"
            target="_blank"
            rel="noopener"
            className="font-semibold text-foreground underline underline-offset-4"
          >
            Gadgetbridge
          </a>
          , proyek open source yang punya dukungan jam Huawei dan Honor. Daftar di atas mengikuti daftar jam
          Gadgetbridge, jadi ada di daftar Gadgetbridge belum berarti sudah diuji di JoyoFit: baru Watch Fit 4 Pro,
          Band 8, Band 11 Pro, dan Watch Fit 2 yang diuji. JoyoFit adalah turunannya, bukan Gadgetbridge itu sendiri. Aplikasinya menambahkan layar
          harian, olahraga langsung, ekspor ke Health Connect dan Strava, cloud opsional, dan versi iPhone.
          Mau mencoba tanpa Huawei Health? Ikuti{" "}
          <a href={PANDUAN_PATH} className="font-semibold text-foreground underline underline-offset-4">
            panduan pasang dan pakai
          </a>
          .
        </p>
      </div>
    </section>
  );
}

const DUKUNG_SUBJECT = "Pinjam jam untuk uji JoyoFit";

function DukungJamPage() {
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(DUKUNG_SUBJECT)}&body=${encodeURIComponent(
    "Model jam:\nKondisi (baik / ada cacat):\nKota:\nLama yang bisa dipinjamkan:\n",
  )}`;

  return (
    <section data-section="dukung-jam" className="py-12 md:py-16">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <a
          href="/jam"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Daftar jam yang didukung
        </a>
        <h1 className="mt-4 max-w-3xl text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
          Bantu kami mendukung jam-mu
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          JoyoFit sejauh ini diuji dengan empat jam: Huawei Watch Fit 4 Pro, Band 8, Band 11 Pro, dan Watch Fit 2. Jam lain masuk daftar karena
          Gadgetbridge sudah punya modelnya, tapi tanpa jam asli kami tidak bisa memastikan apa yang jalan dan
          apa yang tidak. Ada tiga cara membantu, dari yang paling murah.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <div className="flex flex-col rounded-[1.75rem] bg-makan-soft p-6">
            <span className="flex size-10 items-center justify-center rounded-full bg-card text-makan-ink">
              <Watch className="size-5" aria-hidden />
            </span>
            <h2 className="mt-4 text-xl font-extrabold tracking-tight">Laporkan dari aplikasi</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Kalau kamu punya jamnya, ini yang paling berguna dan tidak memakan biaya. Sambungkan jam sekali, lalu
              buka tab Watch, pilih Bantu dukung jam-mu, dan ketuk Kirim laporan. Pesan dan email boleh diisi, boleh
              dikosongkan. Laporan langsung sampai ke tim JoyoFit dan mendapat nomor laporan. Teksnya biasa, tanpa
              alamat Bluetooth dan nomor seri. Tulis juga apa yang jalan dan apa yang tidak.
            </p>
            <div className="mt-auto flex flex-col gap-2 pt-6">
              <ButtonLink
                href={WATCH_REPORT_FORM_URL}
                target="_blank"
                rel="noopener"
                {...goal("watch_report_click", "dukung-jam")}
              >
                Atau laporkan lewat GitHub
              </ButtonLink>
              <p className="text-xs text-muted-foreground">
                Jalur GitHub membuat issue publik. Tombol Kirim laporan di aplikasi lebih mudah karena ringkasan
                dan log terisi otomatis.
              </p>
            </div>
          </div>

          <div className="flex flex-col rounded-[1.75rem] bg-card p-6">
            <span className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground">
              <Package className="size-5" aria-hidden />
            </span>
            <h2 className="mt-4 text-xl font-extrabold tracking-tight">Pinjamkan atau kirim jam</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Kalau jam-mu belum ada di daftar uji dan kamu rela meminjamkannya, kirim email dulu. Kami meminjam
              hanya untuk menguji dan mengembalikannya. Lama pinjam dan siapa yang menanggung ongkos kirim pulang
              kita sepakati tertulis lewat email sebelum kamu mengirim apa pun, jadi jangan kirim paket tanpa
              balasan dari kami.
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              {[
                "Reset pabrik jam dan keluarkan dari akun Huawei dan Huawei Health sebelum dikirim.",
                "Paket bisa hilang atau rusak di jalan. Pertimbangkan itu sebelum mengirim.",
                "Kami tidak menjanjikan jam-mu akan berfungsi penuh setelah dicoba.",
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <Dot />
                  {line}
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-6">
              <ButtonLink variant="secondary" className="w-full" href={mailto} {...goal("lend_watch_click", "dukung-jam")}>
                <Mail aria-hidden />
                Email {CONTACT_EMAIL}
              </ButtonLink>
            </div>
          </div>

          <div className="flex flex-col rounded-[1.75rem] bg-card p-6">
            <span className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground">
              <Heart className="size-5" aria-hidden />
            </span>
            <h2 className="mt-4 text-xl font-extrabold tracking-tight">Patungan lewat Trakteer</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Dana patungan dipakai untuk membeli atau meminjam jam uji dan ongkos kirimnya, dimulai dari model yang
              paling banyak diminta. Tulis nama model jam-mu di pesan Trakteer supaya kami tahu. Belum ada target
              atau jumlah terkumpul yang kami tampilkan di sini, dan dukungan tidak menjamin model tertentu akan
              didukung.
            </p>
            <div className="mt-auto pt-6">
              <ButtonLink className="w-full" href={TRAKTEER_URL} target="_blank" rel="noopener" {...goal("trakteer_click", "dukung-jam")}>
                <Heart aria-hidden />
                Dukung di Trakteer
              </ButtonLink>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-[1.75rem] bg-card p-6 md:p-8">
          <h2 className="text-xl font-extrabold tracking-tight md:text-2xl">Jam yang paling diminta</h2>
          <p className="mt-2 max-w-3xl text-[0.9375rem] leading-relaxed text-muted-foreground">
            Kami mendahulukan model yang paling sering muncul di laporan dan permintaan. Angkanya tidak kami salin
            ke sini; daftar yang hidup ada di GitHub, dengan label <Code>watch-report</Code>. Jam yang kamu
            butuhkan belum ada? Ajukan permintaan, dan beri jempol di permintaan yang sama.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink
              variant="secondary"
              href={WATCH_REPORTS_URL}
              target="_blank"
              rel="noopener"
              {...goal("watch_requests_click", "dukung-jam")}
            >
              <GithubMark className="size-4" />
              Lihat laporan dan permintaan
            </ButtonLink>
            <ButtonLink
              variant="outline"
              href={WATCH_REQUEST_URL}
              target="_blank"
              rel="noopener"
              {...goal("watch_request_new_click", "dukung-jam")}
            >
              Ajukan jam baru
            </ButtonLink>
          </div>
        </div>

        <div className="mt-4 rounded-[1.75rem] bg-card p-6 md:p-8">
          <h2 className="text-xl font-extrabold tracking-tight md:text-2xl">Status jam saat ini</h2>
          <div className="mt-4 grid gap-6 md:grid-cols-3">
            <div>
              <h3 className="font-bold">Sudah diuji ({JAM_SUDAH_DIUJI.length})</h3>
              <p className="mt-1 text-sm text-muted-foreground">Dicek langsung di jam asli.</p>
              <Chips items={JAM_SUDAH_DIUJI} />
            </div>
            <div>
              <h3 className="font-bold">Eksperimen ({JAM_EKSPERIMEN_CLASSIC.length + JAM_EKSPERIMEN_LE.length})</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Ada di daftar Gadgetbridge dan jalurnya sudah ada, tapi belum pernah dicoba dengan JoyoFit.
              </p>
              <details className="mt-3 text-sm">
                <summary className="min-h-11 cursor-pointer py-2.5 font-semibold underline underline-offset-4">
                  Tampilkan daftar
                </summary>
                <Chips items={[...JAM_EKSPERIMEN_CLASSIC, ...JAM_EKSPERIMEN_LE]} />
              </details>
            </div>
            <div>
              <h3 className="font-bold">Belum bisa ({JAM_BELUM_PAKE.length})</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Pairing baru Honor (HiChain PAKE) belum diimplementasi.
              </p>
              <Chips items={JAM_BELUM_PAKE} />
            </div>
          </div>
          <p className="mt-5 text-sm text-muted-foreground">
            Penjelasan tiap kelompok ada di halaman{" "}
            <a href={JAM_PATH} className="font-semibold text-foreground underline underline-offset-4">
              Jam yang didukung
            </a>
            . Daftar ini dibuat dari katalog di kode aplikasi, jadi selalu sama dengan yang dipakai aplikasi.
          </p>
        </div>
      </div>
    </section>
  );
}

const SWITCH_STEPS = [
  {
    title: "Lepas jam dari Huawei Health",
    body: "Jam hanya bisa terpasang ke satu aplikasi dalam satu waktu, jadi putuskan dulu di Huawei Health (Unbind). Kamu tidak perlu akun Huawei di JoyoFit.",
  },
  {
    title: "Pasangkan di JoyoFit",
    body: "Dekatkan jam ke HP, buka tab Watch, cari jam, lalu setujui permintaan pairing di layar jam. Semuanya lewat Bluetooth. Panduan awal di aplikasi menuntun urutannya.",
  },
  {
    title: "Sinkron, data tetap di HP",
    body: "Sinkron pertama menarik 7 hari terakhir. Riwayat lama dari Huawei Health bisa diimpor dari ekspor datanya, dan olahraga bisa dikirim ke Strava.",
  },
] as const;

function Switch() {
  return (
    <section data-section="pengganti" className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6 md:py-24">
      <div className="max-w-2xl">
        <SectionTitle>Pakai Huawei Watch tanpa Huawei Health</SectionTitle>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          JoyoFit mengambil data langsung dari jam, jadi Huawei Health tidak perlu terpasang. Baru Huawei Watch Fit 4
          Pro yang sudah diuji; jam lain masih eksperimen.
        </p>
      </div>
      <ol className="mt-8 grid gap-4 md:grid-cols-3">
        {SWITCH_STEPS.map((step, i) => (
          <li key={step.title} className="rounded-[1.75rem] bg-card p-6">
            <span className="flex size-9 items-center justify-center rounded-full bg-muted text-sm font-extrabold tabular-nums">
              {i + 1}
            </span>
            <h3 className="mt-4 font-bold">{step.title}</h3>
            <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-[0.9375rem] text-muted-foreground">
        Langkah lengkap, izin, dan jalan keluar kalau macet ada di{" "}
        <a href={PANDUAN_PATH} className="font-semibold text-foreground underline underline-offset-4">
          panduan pasang dan pakai
        </a>
        . Pakai iPhone? Lihat{" "}
        <a href={IPHONE_PATH} className="font-semibold text-foreground underline underline-offset-4">
          JoyoFit di iPhone
        </a>
        .
      </p>
    </section>
  );
}

function HomePage() {
  useScrollReveal();
  return (
    <>
      <Hero />
      <Facts />
      <Basics />
      <SleepSection />
      <Workouts />
      <Scores />
      <Features />
      <StrengthSection />
      <CoachSection />
      <SocialSection />
      <WebSection />
      <RideSection />
      <SendSection />
      <WatchSection />
      <NewInAppSection />
      <ComingSoonSection />
      <RoadmapSection />
      <Testimonials items={TESTIMONIALS} />
      <JamTeaser />
      <TimbanganTeaser />
      <Promises />
      <Switch />
      <Options />
      <Faq />
      <OpenSource />
      <Closing />
    </>
  );
}

function NotFoundPage() {
  return (
    <section data-section="not-found" className="mx-auto w-full max-w-3xl px-4 py-24 md:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
        Halaman tidak ditemukan
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
        Alamat ini tidak ada di JoyoFit. Mungkin tautannya sudah berubah.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/">Ke beranda</ButtonLink>
        <ButtonLink variant="secondary" href={PANDUAN_PATH}>
          Panduan
        </ButtonLink>
      </div>
    </section>
  );
}

const PAGE_BODIES: Record<string, () => React.JSX.Element> = {
  [BLOG_PATH]: BlogIndexPage,
  "/": HomePage,
  [PANDUAN_PATH]: PanduanPage,
  [STRAVA_PATH]: StravaPage,
  [IPHONE_PATH]: IphonePage,
  [JAM_PATH]: JamPage,
  [TIMBANGAN_PATH]: TimbanganPage,
  [DUKUNG_JAM_PATH]: DukungJamPage,
  [SELF_HOST_PATH]: SelfHostPage,
  [PRIVASI_PATH]: PrivasiPage,
  [KELUARGA_PATH]: KeluargaPage,
};

/** [path] is normalizePath(location.pathname); anything outside PAGES gets the 404 page. */
export function App({ path }: { path: string }) {
  const Body = isPublicPath(path) ? PAGE_BODIES[path] : NotFoundPage;
  return (
    <div className="min-h-svh">
      <Header />
      <main>
        {Body ? <Body /> : <BlogPostPage path={path} />}
      </main>
      <Footer />
    </div>
  );
}
