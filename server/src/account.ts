import { Hono } from "hono";

import type { AppContext, AppEnv } from "./env";
import { deleteFamilyData } from "./family/store";
import { deleteLiveStatements } from "./live";
import { dropHuaweiHealthConnection } from "./huaweiHealth";
import { dropStravaConnection } from "./strava";

/** Every table with a `user_id` column. `user_state` goes last so a half-finished deletion can still be repeated. */
const USER_TABLES = ["workout_points", "workouts", "step_samples", "sleep_segments", "device", "imports", "web_watchfaces", "studio_projects", "gear_doc", "user_state"] as const;

/** Deletes every R2 object under `<root>/<user id>/` in pages; R2 lists at most 1000 keys per call. */
async function deleteUserFiles(env: AppEnv, root: "imports" | "watchfaces" | "studio", userId: string): Promise<void> {
  const prefix = `${root}/${userId}/`;
  for (let cursor: string | undefined; ; ) {
    const page = await env.IMPORTS.list({ prefix, cursor });
    if (page.objects.length > 0) await env.IMPORTS.delete(page.objects.map((o) => o.key));
    if (!page.truncated) return;
    cursor = page.cursor;
  }
}

/** The rows and files the app uploaded (steps, sleep, workouts, devices, imports, the watch face library, Studio cloud projects, live tracking sessions); not Strava or family. Repeatable. */
export async function deleteSyncedData(env: AppEnv, userId: string): Promise<void> {
  await deleteUserFiles(env, "imports", userId);
  await deleteUserFiles(env, "watchfaces", userId);
  await deleteUserFiles(env, "studio", userId);
  // Live tracking rows go first: the points are found through the sessions. `user_state` stays last (see USER_TABLES).
  await env.DB.batch([...deleteLiveStatements(env.DB, userId), ...USER_TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?1`).bind(userId))]);
}

/** Everything JoyoFit holds for one JoyoRogo user: synced rows, imported files, the Strava and HUAWEI ID (Health Kit) connections, family links (both roles). Repeatable. */
export async function deleteUserData(env: AppEnv, userId: string): Promise<void> {
  await dropStravaConnection(env, userId);
  await dropHuaweiHealthConnection(env, userId);
  await deleteFamilyData(env, userId);
  await deleteSyncedData(env, userId);
}

/**
 * `DELETE /v1/data` (Settings, Cloud sync, Delete cloud data): wipes what the app uploaded and keeps the account's
 * Strava connection and family links. Repeatable.
 */
export const syncedData = new Hono<AppContext>();

syncedData.delete("/", async (c) => {
  await deleteSyncedData(c.env, c.get("user").id);
  return c.json({ deleted: true });
});

/**
 * `DELETE /v1/account` — wipes this user's JoyoFit cloud data (the app calls it before it deletes the JoyoRogo
 * account itself, App Store 5.1.1(v)). Mounted under `/v1`, behind `requireUser`.
 */
export const account = new Hono<AppContext>();

account.delete("/", async (c) => {
  await deleteUserData(c.env, c.get("user").id);
  return c.json({ deleted: true });
});
