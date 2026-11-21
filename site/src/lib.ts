import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const GITHUB_URL = "https://github.com/dzulfikar08/joyofit";
/** Pricing link from this site; from=joyofit and the UTM tags let JoyoRogo's sign-in and purchase goals say where the visit began. */
export const HARGA_URL =
  "https://joyorogo.com/harga?from=joyofit&utm_source=joyofit&utm_medium=referral&utm_campaign=evergreen-site-cloud";
/** JoyoFit Web (Pro), its free watch face designer and the Ride game, all on one host. */
export const WEB_URL = "https://app.fit.joyorogo.com";
export const STUDIO_URL = `${WEB_URL}/studio/`;
export const RIDE_PATH = "/ride";
export const RIDE_WEB_URL = `${WEB_URL}/ride`;
export const CLOUDAGNI_URL = "https://cloudagni.my.id";
export const JOYOROGO_URL = "https://joyorogo.com";
export const TRAKTEER_URL = "https://trakteer.id/dzulfikar_ats_tsauri";
/**
 * JoyoFit on Google Play, with the place on this site in the install referrer (joyorogo docs/utm.md: Play drops UTM on
 * the listing URL, so it travels URL-encoded in `referrer`). Play Console's acquisition report then shows which button
 * brought the install: `utm_campaign=evergreen-site-hero`, `-cara`, `-panduan`, ...
 */
export function playStoreUrl(place?: string): string {
  const slug = place ? place.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) : "";
  const referrer = `utm_source=joyofit&utm_medium=referral&utm_campaign=${slug ? `evergreen-site-${slug}` : "evergreen-site"}`;
  return `https://play.google.com/store/apps/details?id=com.joyodigitama.joyofit&referrer=${encodeURIComponent(referrer)}`;
}

export const PLAY_STORE_URL = playStoreUrl();
export const CONTACT_EMAIL = "dzulfikar.at@gmail.com";
/** JoyoDigitama Discord (permanent invite): bug report and feedback forums for JoyoFit, JoyoRogo and JoyoArto, plus release announcements. */
export const DISCORD_URL = "https://discord.gg/vtud8UYekp";
export const DUKUNG_JAM_PATH = "/dukung-jam";
export const SELF_HOST_PATH = "/self-host";
export const JAM_PATH = "/jam";
export const TIMBANGAN_PATH = "/timbangan";
export const PANDUAN_PATH = "/panduan";
export const PRIVASI_PATH = "/privasi";
export const KELUARGA_PATH = "/keluarga";
export const BLOG_PATH = "/blog";
export const WATCH_REPORTS_URL = `${GITHUB_URL}/issues?q=is%3Aissue+label%3Awatch-report`;
export const WATCH_REPORT_FORM_URL = `${GITHUB_URL}/issues/new?template=watch-report.yml`;
export const WATCH_REQUEST_URL = `${GITHUB_URL}/issues/new?title=${encodeURIComponent("[Permintaan jam] ")}&body=${encodeURIComponent("Model jam:\nNama Bluetooth di HP (kalau tahu):\nSaya bisa: bantu uji / pinjamkan jam / hanya meminta\n")}`;

/** RevKlik click goal for a link or button (same attributes as JoyoRogo's data-revklik-goal convention). */
export function goal(name: string, location: string) {
  return { "data-revklik-goal": name, "data-revklik-goal-location": location } as const;
}

/**
 * JoyoFit on the App Store (live since 2026-11-19). The storefront-less URL lets Apple open the visitor's own store.
 * App Store campaign links need a provider token, so the button's place is only in the RevKlik goal.
 */
export const APP_STORE_URL = "https://apps.apple.com/app/id6823324343";
/** Public TestFlight beta: early builds before they reach the App Store. */
export const IOS_TESTFLIGHT_URL = "https://testflight.apple.com/join/GXzrQ8GJ";

export const STRAVA_PATH = "/strava";
export const IPHONE_PATH = "/iphone";
/** JoyoFit Worker; `POST /v1/waitlist` takes the /strava and /iphone forms. */
export const WAITLIST_API = "https://api.fit.joyorogo.com/v1/waitlist";

/** Trademark notice: the footer and /jam, /panduan, /privasi show it. */
export const NON_AFFILIATION =
  "JoyoFit tidak dibuat, didukung, atau disponsori oleh Huawei maupun Honor. Huawei dan Honor adalah merek dagang pemiliknya masing-masing.";
export const NON_AFFILIATION_EN =
  "JoyoFit is not made, endorsed or sponsored by Huawei or Honor. Huawei and Honor are trademarks of their respective owners.";
