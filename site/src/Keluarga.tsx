import { useState, useSyncExternalStore } from "react";
import { ArrowLeft, Check, Copy, HeartHandshake } from "lucide-react";

import { IOS_TESTFLIGHT_LIVE, IOS_TESTFLIGHT_URL, KELUARGA_PATH, PRIVASI_PATH, TESTER_GROUP_URL } from "./lib";
import { usePlatform } from "./platform";
import { AndroidMark, AppleMark, ButtonLink } from "./ui";

/** index.html moves the code out of the address bar into this key before the analytics script reads the URL. */
const INVITE_STORAGE_KEY = "joyofit-invite";

const CODE_SHAPE = /^[A-Z0-9]{8}$/;
const APP_OPEN_TIMEOUT_MS = 1800;

const SHARED = [
  "Terakhir jam tersambung dan baterai jam",
  "Langkah harian",
  "Tidur semalam",
  "Detak jantung saat istirahat",
  "Kadar oksigen (SpO2) menurut jam, kalau kamu mengizinkan",
] as const;

const NEVER_SHARED = "lokasi, rute olahraga, detak jantung per menit, makanan, dan foto";

const DISCLAIMER =
  "Ini bukan pantauan langsung. Data baru masuk setelah jam tersinkron ke ponsel dan ponselnya terhubung internet, jadi bisa telat dari beberapa menit sampai berjam-jam. JoyoFit bukan alat darurat dan tidak mendeteksi jatuh, serangan jantung, atau kondisi gawat. Kalau kamu khawatir, telepon langsung atau hubungi layanan darurat (112).";

const subscribe = () => () => {};

/** The invite code as typed in the link, or null (also on the server and during hydration). */
function readInvite(): string | null {
  try {
    const stored = sessionStorage.getItem(INVITE_STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // Storage blocked: the address bar still has the code.
  }
  return /^\/keluarga\/([^/]+)\/?$/.exec(window.location.pathname)?.[1] ?? null;
}

function openInApp(code: string, storeUrl: string) {
  const timer = window.setTimeout(() => window.location.assign(storeUrl), APP_OPEN_TIMEOUT_MS);
  document.addEventListener("visibilitychange", () => document.hidden && window.clearTimeout(timer), { once: true });
  window.location.assign(`joyofit://family/accept?code=${code}`);
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-input bg-background px-5 text-sm font-bold transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? "Kode tersalin" : "Salin kode"}
    </button>
  );
}

function InviteCard({ code }: { code: string }) {
  const platform = usePlatform();
  const storeUrl = platform === "ios" ? IOS_TESTFLIGHT_URL : TESTER_GROUP_URL;
  return (
    <div className="mt-8 rounded-[1.75rem] bg-makan-soft p-6 text-center md:p-8">
      <p className="text-sm font-bold text-makan-ink">Kode undangan</p>
      <p
        aria-label={code.split("").join(" ")}
        className="mt-2 font-mono text-4xl font-extrabold tracking-[0.2em] text-makan-ink tabular-nums md:text-5xl"
      >
        {code}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {platform === "other" ? (
          <>
            <ButtonLink href={TESTER_GROUP_URL} target="_blank" rel="noopener">
              <AndroidMark />
              JoyoFit untuk Android
            </ButtonLink>
            {IOS_TESTFLIGHT_LIVE && (
              <ButtonLink href={IOS_TESTFLIGHT_URL} target="_blank" rel="noopener">
                <AppleMark />
                JoyoFit untuk iPhone
              </ButtonLink>
            )}
          </>
        ) : (
          <ButtonLink
            href={`joyofit://family/accept?code=${code}`}
            onClick={(event) => {
              event.preventDefault();
              openInApp(code, storeUrl);
            }}
          >
            Buka di JoyoFit
          </ButtonLink>
        )}
        <CopyButton code={code} />
      </div>
      <p className="mt-4 text-sm leading-relaxed text-makan-ink">
        {platform === "other"
          ? "Buka halaman ini di HP-mu, atau pasang JoyoFit di HP lalu masukkan kode di atas."
          : "Belum punya JoyoFit? Tombol di atas membawamu ke halaman pasangnya. Setelah terpasang, buka lagi tautan undangan ini atau masukkan kodenya di aplikasi."}
      </p>
    </div>
  );
}

function InvalidCard() {
  return (
    <div role="alert" className="mt-8 rounded-[1.75rem] bg-card p-6 md:p-8">
      <p className="text-xl font-extrabold tracking-tight">Kode tidak valid</p>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
        Kode undangan terdiri dari 8 huruf dan angka. Cek lagi tautan yang kamu terima, atau minta undangan baru dari
        orang yang mengundangmu. Undangan berlaku 48 jam.
      </p>
    </div>
  );
}

export function KeluargaPage() {
  const raw = useSyncExternalStore(subscribe, readInvite, () => null);
  const code = raw?.toUpperCase() ?? null;
  return (
    <section data-section="keluarga" className="py-12 md:py-16">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
        <a
          href="/"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Kembali ke beranda
        </a>
        <div className="mt-4 flex gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-makan-soft text-makan-ink">
            <HeartHandshake className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
              Ada yang mengajakmu berbagi kabar
            </h1>
            <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Seseorang mengundangmu membagikan kabar lewat JoyoFit: beberapa angka harian dari jam-mu, supaya
              mereka tahu kamu baik-baik saja.
            </p>
          </div>
        </div>

        {code !== null && (CODE_SHAPE.test(code) ? <InviteCard code={code} /> : <InvalidCard />)}

        <div className="mt-6 rounded-[1.75rem] bg-card p-6 md:p-8">
          <h2 className="text-xl font-extrabold tracking-tight">Apa yang dibagikan</h2>
          <ul className="mt-4 space-y-2.5">
            {SHARED.map((item) => (
              <li key={item} className="flex gap-2.5 text-[0.9375rem] leading-relaxed">
                <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
            Tidak pernah dibagikan: {NEVER_SHARED}.
          </p>
          <p className="mt-4 text-[0.9375rem] font-semibold leading-relaxed">
            Kamu yang menentukan, bisa jeda atau berhenti kapan saja. Kalau berhenti, mereka langsung tidak bisa melihat
            apa pun dan riwayatnya dihapus.
          </p>
        </div>

        <p className="mt-4 rounded-[1.75rem] border border-border/70 p-6 text-[0.9375rem] leading-relaxed md:p-8">
          {DISCLAIMER}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          Detail lengkapnya ada di{" "}
          <a href={PRIVASI_PATH} className="font-semibold text-foreground underline underline-offset-4">
            kebijakan privasi
          </a>
          .
        </p>
      </div>
    </section>
  );
}
