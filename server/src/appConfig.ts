import { Hono } from "hono";

import type { AppContext } from "./env";

/** Where each platform sends people to update when no `<platform>_store_url` row says otherwise (docs/force-update.md). */
export const DEFAULT_STORE_URLS = {
  // JoyoFit is in Play production (checked 2026-11-02): the store listing.
  android: "https://play.google.com/store/apps/details?id=com.joyodigitama.joyofit",
  ios: "https://testflight.apple.com/join/GXzrQ8GJ",
} as const;

export interface PlatformUpdateConfig {
  /** Native builds below this are blocked. 0 = gate off. */
  minBuild: number;
  /** Native builds below this (and at or above `minBuild`) get a dismissible banner. */
  latestBuild: number;
  storeUrl: string;
}

export interface AppConfigResponse {
  android: PlatformUpdateConfig;
  ios: PlatformUpdateConfig;
  /** Owner text for the blocking screen; null = the app's own copy. */
  message: string | null;
}

/** A stored build number: a non-negative integer, anything else counts as 0 (off). */
function parseBuild(raw: string | undefined): number {
  if (raw === undefined || !/^\d{1,10}$/.test(raw.trim())) return 0;
  return Number(raw.trim());
}

function parseUrl(raw: string | undefined, fallback: string): string {
  const value = raw?.trim();
  if (!value) return fallback;
  try {
    return new URL(value).protocol === "https:" ? value : fallback;
  } catch {
    return fallback;
  }
}

/** Pure: the key/value rows of `app_config` to the response. Unknown keys are ignored. */
export function buildAppConfig(rows: Record<string, string>): AppConfigResponse {
  const platform = (name: "android" | "ios"): PlatformUpdateConfig => {
    const minBuild = parseBuild(rows[`${name}_min_build`]);
    return {
      minBuild,
      // A latest below the minimum would make the banner rule meaningless.
      latestBuild: Math.max(minBuild, parseBuild(rows[`${name}_latest_build`])),
      storeUrl: parseUrl(rows[`${name}_store_url`], DEFAULT_STORE_URLS[name]),
    };
  };
  return { android: platform("android"), ios: platform("ios"), message: rows.message?.trim() || null };
}

export const appConfig = new Hono<AppContext>();

/**
 * Public (no session): a logged-out phone is gated too. Cached for a minute by the edge and the app; the cache is short on
 * purpose so raising `min_build` takes effect quickly.
 */
appConfig.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT key, value FROM app_config").all<{ key: string; value: string }>();
  const rows: Record<string, string> = {};
  for (const row of results) rows[row.key] = row.value;
  c.header("cache-control", "public, max-age=60");
  return c.json(buildAppConfig(rows));
});
