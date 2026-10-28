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
export const TESTER_GROUP_URL = "https://groups.google.com/g/joyofit-testers";
export const TESTER_OPTIN_URL = "https://play.google.com/apps/testing/com.joyodigitama.joyofit";
export const CONTACT_EMAIL = "dzulfikar.at@gmail.com";
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
 * The JoyoFit iPhone public TestFlight beta is live. While false, the site
 * shows no iPhone beta section and no iPhone sentence in the FAQ.
 */
export const IOS_TESTFLIGHT_LIVE = true;
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
