import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { account, syncedData } from "./account";
import { readJson } from "./body";
import { cloudUnlocked, requireFounder } from "./access";
import { AuthUnavailableError, requireUser } from "./auth";
import type { AppContext, AppEnv } from "./env";
import { family, familyDevice } from "./family/routes";
import { runScheduled } from "./family/cron";
import { gear } from "./gear";
import { imports } from "./imports";
import { livePage, livePublic, liveSession } from "./live";
import { MAX_SYNC_BODY_BYTES, PULL_DEFAULT_LIMIT, PULL_MAX_LIMIT, RESTORE_DEFAULT_LIMIT, RESTORE_MAX_AGE_DAYS, RESTORE_MAX_LIMIT } from "./limits";
import { syncBodySchema } from "./schemas";
import { sleep } from "./sleep";
import { ride } from "./ride/routes";
import { strava, stravaPublic } from "./strava";
import { studio } from "./studio";
import { applySync, pullSync, restoreSleep, restoreSteps } from "./sync";
import { watchfaces } from "./watchfaces";
import { waitlist } from "./waitlist";
import { appConfig } from "./appConfig";
import { agps } from "./agps";
import { agpsPgnss } from "./agpsPgnss";
import { maps } from "./maps";

const app = new Hono<AppContext>();

app.get("/", (c) => c.json({ service: "joyofit-api", ok: true }));

// Public (no session): registered before `v1` so its session check never runs for these routes.
app.route("/v1/waitlist", waitlist);
// Public: the launch-time update gate reads it before any sign-in (docs/force-update.md).
app.route("/v1/app-config", appConfig);
// Public: satellite data for the watch (HW_AGNSS), built from open data; the request carries nothing about the user (docs/agps.md).
app.route("/v1/agps", agps);
// Public, lab only: the HW_PGNSS_PRED bundle built from open orbit predictions (docs/agps.md "PGNSS lab path"); no user data either.
app.route("/v1/agps", agpsPgnss);
// Public, lab only: OSM-built offline watch maps from the R2 bucket MAPS (docs/offline-maps.md "Lab"); no user data either.
app.route("/v1/maps", maps);
// Device-token auth, not a session: the monitored phone uploads from native background code.
app.route("/v1/family", familyDevice);
// Live tracking link: the phone posts with its write key (Bearer) and anyone with the link reads; neither uses a session.
// Only `POST /v1/live` (start) needs the session, so it is mounted under `v1` below.
app.route("/v1/live", livePublic);
app.route("/live", livePage);

// "Ride on the web" relay (docs/ride.md): public room creation, phone join with a session, WebSocket by token.
app.route("/ride", ride);

const v1 = new Hono<AppContext>();
v1.use("*", requireUser);

v1.get("/me", async (c) => {
  const user = c.get("user");
  const state = await c.env.DB.prepare("SELECT rev, last_sync_at FROM user_state WHERE user_id = ?1")
    .bind(user.id)
    .first<{ rev: number; last_sync_at: number | null }>();
  let unlocked: boolean | null;
  try {
    unlocked = await cloudUnlocked(c.env, c.req.header("cookie") ?? null);
  } catch (error) {
    if (error instanceof AuthUnavailableError) {
      console.error(JSON.stringify({ event: "access_unavailable", message: error.message }));
      return c.json({ error: "auth_unavailable" }, 503);
    }
    throw error;
  }
  if (unlocked === null) return c.json({ error: "unauthorized" }, 401);
  // `unlocked` is JoyoRogo Founder (or a server without a paywall): only then are uploads accepted. Reads stay open.
  return c.json({ user, rev: state?.rev ?? 0, lastSyncAt: state?.last_sync_at ?? null, cloud: { unlocked } });
});

v1.post("/sync", requireFounder, async (c) => {
  const body = syncBodySchema.parse(await readJson(c.req.raw, MAX_SYNC_BODY_BYTES));
  const result = await applySync(c.env.DB, c.get("user").id, body, Date.now());
  return c.json(result);
});

v1.get("/sync", async (c) => {
  const since = Number(c.req.query("since") ?? "0");
  const limit = Number(c.req.query("limit") ?? PULL_DEFAULT_LIMIT);
  if (!Number.isInteger(since) || since < 0) return c.json({ error: "invalid_since" }, 400);
  if (!Number.isInteger(limit) || limit < 1 || limit > PULL_MAX_LIMIT) {
    return c.json({ error: "invalid_limit", max: PULL_MAX_LIMIT }, 400);
  }
  return c.json(await pullSync(c.env.DB, c.get("user").id, since, limit));
});

/** A new phone's windowed history: `from` bounds the window, `after` is the keyset cursor of the previous page. */
v1.get("/restore", async (c) => {
  const table = c.req.query("table");
  const from = Number(c.req.query("from") ?? "");
  const afterRaw = c.req.query("after");
  const limit = Number(c.req.query("limit") ?? RESTORE_DEFAULT_LIMIT);
  if (table !== "steps" && table !== "sleep") return c.json({ error: "invalid_table" }, 400);
  if (!Number.isInteger(from) || from < 0) return c.json({ error: "invalid_from" }, 400);
  if (from < Date.now() / 1000 - RESTORE_MAX_AGE_DAYS * 86_400) {
    return c.json({ error: "from_too_old", maxDays: RESTORE_MAX_AGE_DAYS }, 400);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > RESTORE_MAX_LIMIT) {
    return c.json({ error: "invalid_limit", max: RESTORE_MAX_LIMIT }, 400);
  }
  const userId = c.get("user").id;
  if (table === "steps") {
    const after = afterRaw === undefined ? null : Number(afterRaw);
    if (after !== null && (!Number.isInteger(after) || after < 0)) return c.json({ error: "invalid_after" }, 400);
    return c.json(await restoreSteps(c.env.DB, userId, from, after, limit));
  }
  const match = afterRaw === undefined ? null : /^(\d+):(\d+)$/.exec(afterRaw);
  if (afterRaw !== undefined && !match) return c.json({ error: "invalid_after" }, 400);
  const after = match ? { start: Number(match[1]), type: Number(match[2]) } : null;
  return c.json(await restoreSleep(c.env.DB, userId, from, after, limit));
});

v1.route("/account", account);
v1.route("/data", syncedData);
v1.route("/imports", imports);
v1.route("/strava", strava);
v1.route("/gear", gear);
v1.route("/sleep", sleep);
v1.route("/watchfaces", watchfaces);
v1.route("/studio/projects", studio);
v1.route("/live", liveSession);
v1.route("/family", family);
app.route("/v1", v1);
app.route("/strava", stravaPublic);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((error, c) => {
  if (error instanceof ZodError) {
    return c.json({ error: "invalid_body", issues: error.issues.slice(0, 20) }, 400);
  }
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }
  console.error(JSON.stringify({ event: "unhandled", path: c.req.path, message: error.message }));
  return c.json({ error: "internal_error" }, 500);
});

// Durable Object classes of the ride relay; wrangler.jsonc binds them (RIDE_ROOM, RIDE_INDEX).
export { RideIndex } from "./ride/lookup";
export { RideRoom } from "./ride/room";

export default {
  fetch: app.fetch,
  /** Cron triggers (wrangler.jsonc): family alert checks every 15 minutes, the 19:00 WIB digest, the nightly purge. */
  async scheduled(controller: ScheduledController, env: AppEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env, controller.cron));
  },
} satisfies ExportedHandler<AppEnv>;
