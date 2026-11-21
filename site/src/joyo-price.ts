/**
 * Joyo Pro price shown on fit.joyorogo.com. It follows the buyer ladder on joyorogo.com/harga, so the build reads
 * api.joyorogo.com/api/config (vite.config.ts) instead of a number typed into the page, and the page asks again in the
 * browser (useJoyoPrice in App.tsx) so a ladder step shows without a rebuild. Until the API allows this origin, or when
 * the request fails, the page keeps the price from the build.
 */
export type JoyoPrice = {
  /** "Rp29.000": monthly price for the next buyer. */
  monthly: string;
  /** "Rp199.000": yearly price for the next buyer. */
  yearly: string;
  /** "Rp16.583": yearly price divided by 12. */
  yearlyPerMonth: string;
  /** Monthly price after this ladder step, or null on the last step. */
  next: string | null;
  /** Buyers covered by the current introductory step, or null on the last step. */
  slots: number | null;
};

type ConfigLike = {
  founderPriceIdr?: unknown;
  founderYearlyPriceIdr?: unknown;
  promo?: { slots?: unknown; nextPriceIdr?: unknown } | null;
};

const rupiah = (n: number): string => `Rp${Math.round(n).toLocaleString("id-ID")}`;

const isPrice = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Values of 17 Nov 2026 (ladder step 2), used when the build cannot reach the API. */
export const FALLBACK_PRICE: JoyoPrice = {
  monthly: "Rp29.000",
  yearly: "Rp199.000",
  yearlyPerMonth: "Rp16.583",
  next: "Rp49.000",
  slots: 60,
};

/** Price from /api/config, or null when the response is not usable. */
export function priceFromConfig(config: ConfigLike): JoyoPrice | null {
  const { founderPriceIdr: monthly, founderYearlyPriceIdr: yearly, promo } = config;
  if (!isPrice(monthly) || !isPrice(yearly)) return null;
  const next = isPrice(promo?.nextPriceIdr) ? promo.nextPriceIdr : null;
  const slots = typeof promo?.slots === "number" && promo.slots > 0 ? promo.slots : null;
  return {
    monthly: rupiah(monthly),
    yearly: rupiah(yearly),
    yearlyPerMonth: rupiah(yearly / 12),
    next: next === null ? null : rupiah(next),
    slots: next === null ? null : slots,
  };
}

export const CONFIG_URL = "https://api.joyorogo.com/api/config";

/** The live price, or null on any failure (offline, API down, CORS refused, unusable answer). */
export async function fetchLivePrice(url = CONFIG_URL, fetcher: typeof fetch = fetch): Promise<JoyoPrice | null> {
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    return priceFromConfig((await res.json()) as ConfigLike);
  } catch {
    return null;
  }
}

/** Reads the live price at build time; any failure (offline build, API down) falls back to FALLBACK_PRICE. */
export async function fetchJoyoPrice(url = CONFIG_URL, fetcher: typeof fetch = fetch): Promise<JoyoPrice> {
  return (await fetchLivePrice(url, fetcher)) ?? FALLBACK_PRICE;
}
