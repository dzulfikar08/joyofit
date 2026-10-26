import { ArrowLeft, Activity, BadgeCheck, Calculator, Info, KeyRound, Scale, Weight, Users, type LucideIcon } from "lucide-react";

import { CONTACT_EMAIL, GITHUB_URL, JOYOROGO_URL, goal } from "./lib";
import { TIMBANGAN_FAMILIES, TIMBANGAN_PROTOKOL, type TimbanganData, type TimbanganFamily } from "./timbangan";
import { ButtonLink } from "./ui";

const DATA: Record<TimbanganData, { Icon: LucideIcon; label: string; body: string }> = {
  berat: {
    Icon: Weight,
    label: "Berat",
    body: "Berat badan saja.",
  },
  timbangan: {
    Icon: Activity,
    label: "Berat dan komposisi tubuh dari timbangan",
    body: "Timbangannya sendiri yang menghitung lemak, otot, air, dan sebagainya, lalu mengirimnya. JoyoFit menampilkannya apa adanya, di bawah label Dari timbangan.",
  },
  estimasi: {
    Icon: Calculator,
    label: "Berat dan perkiraan komposisi tubuh",
    body: "Timbangan mengirim impedansi (hasil mengalirkan arus listrik sangat kecil lewat telapak kaki). JoyoFit memperkirakan komposisinya dengan rumus umum dari openScale, memakai tinggi, usia, dan jenis kelamin di Profil. Angkanya bisa beda dari aplikasi bawaan timbangan, jadi pakai untuk melihat tren.",
  },
  tergantung: {
    Icon: Scale,
    label: "Tergantung model",
    body: "Berat selalu terbaca. Komposisi tubuhnya bergantung pada model yang kamu punya, lihat catatan di barisnya.",
  },
};

const DATA_ORDER: TimbanganData[] = ["berat", "timbangan", "estimasi", "tergantung"];

const CHECK_STEPS = [
  "Buka JoyoFit, lalu Pengaturan dan Timbangan. Kalau menu itu belum ada, perbarui aplikasinya dulu.",
  "Ketuk Lanjut, izinkan Bluetooth, naik ke timbangan sampai layarnya menyala, lalu ketuk Cari timbangan. Banyak timbangan baru terlihat saat sedang menyala.",
  "Kalau timbanganmu muncul di bawah Timbangan dikenali, ketuk Pakai ini, lalu Coba timbang.",
  "Kalau tidak muncul, pakai Rekam data timbangan di halaman yang sama: pilih perangkatnya, mulai merekam, naik ke timbangan, lalu bagikan rekamannya supaya dukungannya bisa ditambahkan.",
] as const;

const TESTED_NAMES = TIMBANGAN_FAMILIES.flatMap((family) => family.items.filter((item) => item.teruji).map((item) => item.nama));

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Brands and apps from the registry that are not already the family or model name shown beside them. */
function otherNames(family: TimbanganFamily): string[] {
  const shown = new Set([family.nama, ...family.items.map((item) => item.nama)].map(norm));
  const out: string[] = [];
  for (const brand of family.items.flatMap((item) => item.merek)) {
    if (shown.has(norm(brand)) || out.some((b) => norm(b) === norm(brand))) continue;
    out.push(brand);
  }
  return out;
}

function TimbanganList() {
  return (
    <ul className="mt-6 divide-y divide-border/70 rounded-[1.75rem] bg-card px-5 md:px-8">
      {TIMBANGAN_FAMILIES.map((family) => {
        const others = otherNames(family);
        return (
          <li key={family.nama} className="grid gap-4 py-6 md:grid-cols-[minmax(0,15rem)_1fr] md:gap-10">
            <div>
              <h3 className="text-lg font-extrabold tracking-tight">{family.nama}</h3>
              {others.length > 0 && (
                <>
                  <p className="mt-2 text-xs text-muted-foreground">Merek dan aplikasi yang memakainya</p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {others.map((name) => (
                      <li key={name} className="rounded-lg bg-muted px-2 py-1 text-[0.8125rem] leading-snug break-words">
                        {name}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <ul className="flex flex-col gap-5">
              {family.items.map((item) => {
                const { Icon, label } = DATA[item.data];
                return (
                  <li key={item.nama}>
                    <p className="font-semibold break-words">{item.nama}</p>
                    <p
                      className={`mt-1 flex items-start gap-1.5 text-sm font-medium ${item.data === "berat" ? "text-muted-foreground" : "text-makan-ink"}`}
                    >
                      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                      {label}
                    </p>
                    {item.teruji && (
                      <p className="mt-1 flex items-start gap-1.5 text-sm font-medium text-makan-ink">
                        <BadgeCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                        Sudah diuji di timbangan asli
                      </p>
                    )}
                    {item.butuhKunci && (
                      <p className="mt-1 flex items-start gap-1.5 text-sm font-medium text-muted-foreground">
                        <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
                        Perlu kunci timbangan
                      </p>
                    )}
                    {item.catatan && (
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.catatan}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

export function TimbanganPage() {
  const link = "font-semibold text-foreground underline underline-offset-4";
  return (
    <section data-section="timbangan" className="py-12 md:py-16">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <a
          href="/"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Kembali ke beranda
        </a>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
          Timbangan Bluetooth yang didukung JoyoFit
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Naik ke timbangan, beratmu langsung masuk ke riwayat di JoyoFit dan ke catatan berat badan JoyoRogo. Ini
          timbangan yang dikenali aplikasinya, dikelompokkan menurut merek.
        </p>

        <div className="mt-8 flex max-w-3xl items-start gap-3.5 rounded-[1.75rem] bg-makan-soft p-5 md:p-6">
          <Info className="mt-0.5 size-5 shrink-0 text-makan-ink" aria-hidden />
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">
              {TESTED_NAMES.length === 0
                ? "Belum diuji di timbangan asli"
                : `Baru ${TESTED_NAMES.length} jenis yang diuji di timbangan asli`}
            </h2>
            <p className="mt-1.5 leading-relaxed">
              Hampir semua yang ada di daftar ini didukung lewat protokol{" "}
              <a href="https://github.com/oliexdev/openScale" target="_blank" rel="noopener" className={link}>
                openScale
              </a>
              , proyek open source untuk timbangan Bluetooth. Pembacaannya kami uji dengan data contoh dari openScale.
              Satu-satunya yang sudah kami coba di timbangan sungguhan di tangan kami: {TESTED_NAMES.join(", ")}, dan
              itu ditandai Sudah diuji di timbangan asli di daftar. Jadi didukung di sini berarti kodenya ada, bukan
              sudah terbukti jalan di modelmu. Kalau timbanganmu salah baca atau tidak terbaca, kabari kami.
            </p>
          </div>
        </div>

        <h2 className="mt-14 text-2xl font-extrabold tracking-tight md:text-3xl">Yang kamu dapat dari timbangan</h2>
        <dl className="mt-5 grid max-w-4xl gap-x-10 gap-y-5 md:grid-cols-2">
          {DATA_ORDER.map((key) => {
            const { Icon, label, body } = DATA[key];
            return (
              <div key={key}>
                <dt className="flex items-start gap-2 font-bold">
                  <Icon className="mt-0.5 size-5 shrink-0 text-makan-ink" aria-hidden />
                  {label}
                </dt>
                <dd className="mt-1 pl-7 text-[0.9375rem] leading-relaxed text-muted-foreground">{body}</dd>
              </div>
            );
          })}
        </dl>

        <h2 className="mt-14 text-2xl font-extrabold tracking-tight md:text-3xl">Timbangan yang dikenali</h2>
        <p className="mt-3 max-w-3xl text-[0.9375rem] leading-relaxed text-muted-foreground">
          {TIMBANGAN_PROTOKOL} jenis timbangan dari {TIMBANGAN_FAMILIES.length} kelompok, dibaca langsung oleh aplikasi.
          Nama merek di sini hanya untuk menyebut timbangan yang cocok. JoyoFit tidak berafiliasi dengan merek mana
          pun.
        </p>
        <TimbanganList />

        <div className="mt-14 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">Cara cek timbanganmu</h2>
            <ol className="mt-5 flex list-decimal flex-col gap-3 pl-5 marker:font-bold marker:text-makan-ink">
              {CHECK_STEPS.map((step) => (
                <li key={step} className="pl-1 text-[0.9375rem] leading-relaxed text-muted-foreground">
                  {step}
                </li>
              ))}
            </ol>
            <p className="mt-5 text-[0.9375rem] leading-relaxed text-muted-foreground">
              Rekamannya tersimpan di HP-mu dan baru terkirim kalau kamu sendiri membagikannya. Kirim ke{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className={link} {...goal("timbangan_report_click", "timbangan")}>
                {CONTACT_EMAIL}
              </a>{" "}
              atau buka laporan di{" "}
              <a
                href={`${GITHUB_URL}/issues`}
                target="_blank"
                rel="noopener"
                className={link}
                {...goal("timbangan_report_click", "timbangan")}
              >
                GitHub
              </a>
              . Dengan rekaman itu kami bisa menambahkan timbanganmu.
            </p>
          </div>

          <div className="flex flex-col gap-8">
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">Setelah kamu menimbang</h2>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
                Kalau kamu masuk dengan akun JoyoRogo, beratmu (dan komposisi tubuh, kalau ada) masuk sendiri ke
                catatan berat badan{" "}
                <a href={JOYOROGO_URL} className={link}>
                  JoyoRogo
                </a>
                . JoyoRogo menyimpan satu angka per hari: timbangan terakhir hari itu yang dipakai. Pengirimannya bisa
                dimatikan di Pengaturan, Timbangan.
              </p>
            </div>
            <div>
              <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
                <Users className="size-5 shrink-0 text-makan-ink" aria-hidden />
                Satu timbangan untuk serumah
              </h2>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
                Kalau beratnya beda lebih dari 6% dari timbangan terakhirmu, JoyoFit bertanya dulu: Ini kamu? Pilih Bukan
                aku dan angka itu tidak disimpan. Batasnya bisa dilonggarkan atau dimatikan. Kalau berat kalian selisihnya
                lebih kecil dari batas itu, JoyoFit tidak bisa membedakan siapa yang naik.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap gap-3">
          <ButtonLink href="/#cara" {...goal("timbangan_install_click", "timbangan")}>
            Pasang JoyoFit
          </ButtonLink>
          <ButtonLink variant="secondary" href="/jam">
            Lihat jam yang didukung
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
