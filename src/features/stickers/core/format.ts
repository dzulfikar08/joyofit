/**
 * Locale formatting without Intl (Hermes ships a partial Intl, and Node/web/native
 * must print the same string). Two locales: id and en.
 */

export type Locale = "id" | "en";

const SEP: Record<Locale, { group: string; decimal: string }> = {
  id: { group: ".", decimal: "," },
  en: { group: ",", decimal: "." },
};

const MONTHS: Record<Locale, readonly string[]> = {
  id: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

const MONTHS_LONG: Record<Locale, readonly string[]> = {
  id: [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ],
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
};

const WEEKDAYS: Record<Locale, readonly string[]> = {
  id: ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

const WEEKDAYS_SHORT: Record<Locale, readonly string[]> = {
  id: ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

/** Round half away from zero to `digits` decimals, immune to 1.005-style float noise. */
export function roundTo(value: number, digits: number): number {
  const f = 10 ** digits;
  const r = Math.round((Math.abs(value) + Number.EPSILON * Math.abs(value)) * f) / f;
  return value < 0 ? -r : r;
}

function group(intPart: string, sep: string): string {
  let out = "";
  for (let i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 === 0) out += sep;
    out += intPart[i];
  }
  return out;
}

/** `digits` fixed decimals with locale separators; `-0` prints as `0`. */
export function formatNumber(value: number, locale: Locale, digits = 0): string {
  if (!Number.isFinite(value)) return "";
  const r = roundTo(value, digits);
  const [int = "0", frac = ""] = Math.abs(r).toFixed(digits).split(".");
  const sep = SEP[locale];
  const body = group(int, sep.group) + (digits > 0 ? sep.decimal + frac : "");
  return r < 0 ? `-${body}` : body;
}

export function formatSigned(value: number, locale: Locale, digits = 0): string {
  if (!Number.isFinite(value)) return "";
  const body = formatNumber(value, locale, digits);
  return body.startsWith("-") || roundTo(value, digits) === 0 ? body : `+${body}`;
}

export function formatPercent(fraction: number, locale: Locale, digits = 0): string {
  if (!Number.isFinite(fraction)) return "";
  return `${formatNumber(fraction * 100, locale, digits)}%`;
}

/** 12500 -> "12,5 rb" (id) / "12.5K" (en); below 1000 stays plain. */
export function formatCompact(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  const steps: [number, string, string][] =
    locale === "id"
      ? [
          [1e12, " T", "t"],
          [1e9, " M", "m"],
          [1e6, " jt", "jt"],
          [1e3, " rb", "rb"],
        ]
      : [
          [1e12, "T", "t"],
          [1e9, "B", "b"],
          [1e6, "M", "m"],
          [1e3, "K", "k"],
        ];
  for (const [div, suffix] of steps) {
    if (abs >= div) {
      const scaled = value / div;
      const digits = Math.abs(scaled) < 100 ? 1 : 0;
      const text = formatNumber(scaled, locale, digits);
      const trimmed = digits ? text.replace(new RegExp(`\\${SEP[locale].decimal}0$`), "") : text;
      return trimmed + suffix;
    }
  }
  return formatNumber(value, locale, 0);
}

/** Seconds -> `m:ss` or `h:mm:ss`. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "";
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Seconds -> `1j 05m` (id) / `1h 05m` (en); under an hour `42m`. */
export function formatDurationHM(totalSeconds: number, locale: Locale): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "";
  const minutes = Math.round(totalSeconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}${locale === "id" ? "j" : "h"} ${String(m).padStart(2, "0")}m`;
}

/** Seconds per km -> `5:42`. */
export function formatPace(secPerKm: number): string {
  return formatDuration(secPerKm);
}

export function formatKm(meters: number, locale: Locale, digits = 2): string {
  return formatNumber(meters / 1000, locale, digits);
}

export type DateStyle = "short" | "medium" | "long" | "weekday" | "weekdayShort" | "day" | "month";

/** ISO `YYYY-MM-DD[...]` (calendar date, no timezone shift) or epoch ms (local fields). */
export function parseDate(value: unknown): { y: number; m: number; d: number; wd: number } | null {
  let y: number;
  let m: number;
  let d: number;
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) return null;
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) >= 1e11) {
    // Epoch milliseconds only; small numbers are never dates.
    const date = new Date(value);
    y = date.getFullYear();
    m = date.getMonth() + 1;
    d = date.getDate();
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, wd };
}

export function formatDate(value: unknown, style: DateStyle, locale: Locale): string {
  const p = parseDate(value);
  if (!p) return "";
  const month = MONTHS[locale][p.m - 1] ?? "";
  switch (style) {
    case "short":
      return `${p.d} ${month}`;
    case "medium":
      return `${p.d} ${month} ${p.y}`;
    case "long":
      return `${p.d} ${MONTHS_LONG[locale][p.m - 1] ?? ""} ${p.y}`;
    case "weekday":
      return WEEKDAYS[locale][p.wd] ?? "";
    case "weekdayShort":
      return WEEKDAYS_SHORT[locale][p.wd] ?? "";
    case "day":
      return String(p.d);
    case "month":
      return MONTHS_LONG[locale][p.m - 1] ?? "";
  }
}

/**
 * Clock time of an ISO timestamp with a time part or of epoch milliseconds, in the
 * device's local timezone. id: 24 h with a dot (`22.30`); en: 12 h (`10:30 PM`).
 */
export function formatTime(value: unknown, locale: Locale): string {
  let date: Date;
  if (typeof value === "string") {
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) return "";
    date = new Date(value);
  } else if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) >= 1e11) {
    date = new Date(value);
  } else {
    return "";
  }
  if (Number.isNaN(date.getTime())) return "";
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, "0");
  if (locale === "id") return `${String(h).padStart(2, "0")}.${m}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}
