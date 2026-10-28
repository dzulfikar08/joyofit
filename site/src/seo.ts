// Per-page SEO data and the <head> tags built from it. Page components read
// their titles from here, vite.config.ts uses headTags() in dev, and
// scripts/prerender.ts uses it to write one static HTML file per route.
import { POSTS, postPath } from "./blog/index.ts";
import { FAQ } from "./faq.ts";
import {
  BLOG_PATH,
  DUKUNG_JAM_PATH,
  GITHUB_URL,
  IOS_TESTFLIGHT_URL,
  IPHONE_PATH,
  JAM_PATH,
  KELUARGA_PATH,
  PANDUAN_PATH,
  PRIVASI_PATH,
  SELF_HOST_PATH,
  STRAVA_PATH,
  TIMBANGAN_PATH,
} from "./lib.ts";

export const SITE_URL = "https://fit.joyorogo.com";
export const SITE_NAME = "JoyoFit";
export const NOT_FOUND_PATH = "/404";

const OG_IMAGE = {
  path: "/og.png",
  width: 1200,
  height: 630,
  alt: "JoyoFit: aplikasi independen yang menyinkronkan jam pintar ke HP lewat Bluetooth, open source.",
};

export type Page = {
  /** The whole <title>, brand included. */
  title: string;
  description: string;
  /** Share-card title when it should differ from [title]. */
  ogTitle?: string;
  /** Breadcrumb label. */
  name: string;
  noindex?: true;
  /** A blog post: head tags become an article and the JSON-LD a BlogPosting (ISO dates). */
  article?: { published: string };
};

const STATIC_PAGES = {
  "/": {
    title: "JoyoFit: Sinkron Jam Pintar ke HP lewat Bluetooth, Open Source",
    ogTitle: "JoyoFit: Jam-mu. Data-mu. HP-mu.",
    name: "Beranda",
    description:
      "Aplikasi independen open source yang menyinkronkan jam pintar yang kompatibel lewat Bluetooth ke HP Android dan iPhone, tanpa akun tambahan: langkah, tidur, detak jantung, SpO2, dan olahraga. Ada pencatat latihan beban yang jalan tanpa jam, Coach, dan roadmap terbuka.",
  },
  [PANDUAN_PATH]: {
    title: "Panduan Pasang dan Pakai JoyoFit: Pairing, Sinkron, Strava",
    name: "Panduan",
    description:
      "Langkah memakai jam pintar dengan JoyoFit: pasang JoyoFit, panduan awal, pairing, sinkron, Strava, impor riwayat, Social, dan masalah umum. English guide below.",
  },
  [STRAVA_PATH]: {
    title: "Kirim Olahraga dari Jam ke Strava dengan JoyoFit (Daftar Tunggu)",
    name: "Strava",
    description:
      "Kirim olahraga dari jam ke Strava lewat JoyoFit, gratis selama slot masih ada: jarak, waktu aktif, kalori, langkah, detak jantung, dan rute dari jam. Slot Strava terbatas, ada daftar tunggu.",
  },
  [IPHONE_PATH]: {
    title: "JoyoFit untuk iPhone: Beta Publik TestFlight",
    name: "iPhone",
    description:
      "JoyoFit untuk iPhone sudah bisa dicoba lewat beta publik TestFlight, baru diuji dengan satu model jam. Versi App Store belum rilis.",
  },
  [JAM_PATH]: {
    title: "Jam yang Didukung JoyoFit, Turunan Gadgetbridge",
    name: "Jam yang didukung",
    description:
      "Daftar jam pintar yang bisa dipakai dengan JoyoFit, mengikuti katalog Gadgetbridge: empat model sudah diuji, sisanya eksperimen. Cara mengirim laporan dukungan.",
  },
  [TIMBANGAN_PATH]: {
    title: "Timbangan Bluetooth yang Didukung JoyoFit: Xiaomi, Renpho, Yunmai, dan Lainnya",
    name: "Timbangan",
    description:
      "Daftar timbangan badan Bluetooth yang dibaca JoyoFit lewat protokol openScale, dikelompokkan menurut merek, dengan data yang didapat dari tiap timbangan. Baru satu jenis yang diuji di timbangan asli. Berat masuk ke catatan JoyoRogo.",
  },
  [DUKUNG_JAM_PATH]: {
    title: "Dukung Jam Barumu di JoyoFit",
    name: "Dukung jam",
    description:
      "Jam-mu belum diuji di JoyoFit? Laporkan dari aplikasi, pinjamkan jam untuk diuji, atau patungan lewat Trakteer. Daftar jam yang diuji dan eksperimen.",
  },
  [SELF_HOST_PATH]: {
    title: "Pasang Cloud JoyoFit di CloudAgni Sendiri",
    name: "Pasang cloud sendiri",
    description:
      "Panduan memasang server cloud JoyoFit (Cloudflare Worker, D1, R2) di CloudAgni. Datamu tetap di akunmu sendiri.",
  },
  [PRIVASI_PATH]: {
    title: "Kebijakan Privasi JoyoFit",
    name: "Privasi",
    description:
      "Data apa yang JoyoFit simpan di HP-mu, apa yang keluar dari HP (cloud opsional, Strava, cuaca, Health Connect, Apple Health, Masuk dengan Apple), dan cara menghapusnya. Privacy policy in English below.",
  },
  [KELUARGA_PATH]: {
    title: "Undangan Berbagi Kabar | JoyoFit",
    name: "Keluarga",
    noindex: true,
    description:
      "Seseorang mengundangmu berbagi kabar lewat JoyoFit: beberapa angka harian dari jam-mu. Kamu yang menentukan apa yang dibagikan.",
  },
  [BLOG_PATH]: {
    title: "Blog JoyoFit: kabar fitur dan cara pakai",
    name: "Blog",
    description:
      "Tulisan tentang fitur JoyoFit yang sudah bisa dipakai: JoyoFit Web, Ride, Coach, tab Social, bagikan latihan ke JoyoRogo, panduan awal, Strava, kartu bagikan, dan pembaruan.",
  },
} as const satisfies Record<string, Page>;

/** One page per published post (src/blog/index.ts); drafts are not in POSTS, so they get no page. */
const POST_PAGES: Record<string, Page> = Object.fromEntries(
  POSTS.map((post) => [
    postPath(post),
    {
      title: `${post.title} | JoyoFit`,
      ogTitle: post.title,
      name: post.title,
      description: post.description,
      article: { published: post.date },
    } satisfies Page,
  ]),
);

export const PAGES: Record<string, Page> = { ...STATIC_PAGES, ...POST_PAGES };

export type PublicPath = string;

export const PUBLIC_PATHS: PublicPath[] = Object.keys(PAGES);

export const NOT_FOUND: Page = {
  title: "Halaman tidak ditemukan | JoyoFit",
  description: "Halaman yang kamu cari tidak ada di fit.joyorogo.com.",
  name: "Tidak ditemukan",
  noindex: true,
};

/** A request path as a PAGES key: no trailing slash, "/" kept, and /keluarga/<code> is the /keluarga page. */
export function normalizePath(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path.startsWith(`${KELUARGA_PATH}/`) ? KELUARGA_PATH : path;
}

export function isPublicPath(path: string): path is PublicPath {
  return Object.hasOwn(PAGES, path);
}

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const ORG_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

function homeJsonLd(): object[] {
  return [
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": ORG_ID,
          name: SITE_NAME,
          url: `${SITE_URL}/`,
          logo: { "@type": "ImageObject", url: `${SITE_URL}/brand/logo-512.png`, width: 512, height: 512 },
          founder: { "@type": "Person", name: "Dzulfikar" },
          sameAs: [GITHUB_URL],
        },
        {
          "@type": "WebSite",
          "@id": WEBSITE_ID,
          name: SITE_NAME,
          url: `${SITE_URL}/`,
          inLanguage: "id",
          publisher: { "@id": ORG_ID },
        },
        {
          "@type": "SoftwareApplication",
          "@id": `${SITE_URL}/#app`,
          name: SITE_NAME,
          url: `${SITE_URL}/`,
          description: PAGES["/"].description,
          applicationCategory: "HealthApplication",
          operatingSystem: "Android, iOS",
          softwareRequirements: "Android 10 atau lebih baru; iOS 16.4 atau lebih baru",
          inLanguage: "id",
          isAccessibleForFree: true,
          offers: { "@type": "Offer", price: "0", priceCurrency: "IDR" },
          license: "https://www.gnu.org/licenses/agpl-3.0.html",
          installUrl: IOS_TESTFLIGHT_URL,
          image: `${SITE_URL}${OG_IMAGE.path}`,
          screenshot: ["today", "sleep", "watch"].map((name) => `${SITE_URL}/shots/${name}.webp`),
          sameAs: [GITHUB_URL],
          publisher: { "@id": ORG_ID },
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      // Entries that name a watch brand (the model-compatibility answers) stay on the page but out of the markup.
      mainEntity: FAQ.filter((item) => !/huawei|honor/i.test(`${item.q} ${item.a} ${item.link?.label ?? ""}`)).map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: {
          "@type": "Answer",
          // The visible answer ends with its link text, so the markup does too.
          text: item.link ? `${item.a} ${item.link.label}.` : item.a,
        },
      })),
    },
  ];
}

function breadcrumbJsonLd(path: PublicPath): object {
  const crumbs = [{ name: PAGES["/"].name, item: `${SITE_URL}/` }];
  if (PAGES[path].article) crumbs.push({ name: PAGES[BLOG_PATH].name, item: `${SITE_URL}${BLOG_PATH}` });
  crumbs.push({ name: PAGES[path].name, item: `${SITE_URL}${path}` });
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, i) => ({ "@type": "ListItem", position: i + 1, ...crumb })),
  };
}

function articleJsonLd(path: PublicPath, page: Page): object {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: page.name,
    description: page.description,
    datePublished: page.article!.published,
    dateModified: page.article!.published,
    inLanguage: "id",
    mainEntityOfPage: `${SITE_URL}${path}`,
    image: `${SITE_URL}${OG_IMAGE.path}`,
    author: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
  };
}

/** Everything SEO-related in <head> for [path] (a PUBLIC_PATHS entry or NOT_FOUND_PATH), one tag per line. */
export function headTags(path: string): string {
  const notFound = !isPublicPath(path);
  const page: Page = notFound ? NOT_FOUND : PAGES[path];
  const url = `${SITE_URL}${path}`;
  const image = `${SITE_URL}${OG_IMAGE.path}`;
  const title = page.ogTitle ?? page.title;
  const tags = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    page.noindex ? `<meta name="robots" content="noindex" />` : `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="${page.article ? "article" : "website"}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="id_ID" />`,
    notFound ? "" : `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}" />`,
    `<meta property="og:image:alt" content="${esc(OG_IMAGE.alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(page.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<meta name="twitter:image:alt" content="${esc(OG_IMAGE.alt)}" />`,
    // "<" is escaped so no string in the data can close the script element.
    ...(notFound
      ? []
      : path === "/"
        ? homeJsonLd()
        : page.article
          ? [breadcrumbJsonLd(path), articleJsonLd(path, page)]
          : [breadcrumbJsonLd(path)]
    ).map(
      (data) => `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`,
    ),
  ];
  return tags.filter(Boolean).join("\n    ");
}
