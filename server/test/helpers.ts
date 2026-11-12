import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { afterEach, beforeEach, vi } from "vitest";

import app from "../src";
import { clearAccessCache } from "../src/access";
import { clearAuthCache } from "../src/auth";
import { clearRogoCache } from "../src/family/joyorogo";
import type { AppEnv } from "../src/env";
import { guardD1 } from "./d1Guard";

/** The test environment: the worker's bindings with `DB` refusing what production D1 refuses (see d1Guard.ts). */
export const env: typeof workerEnv = { ...workerEnv, DB: guardD1(workerEnv.DB) };

export interface FakeUser {
  id: string;
  email: string;
  name: string;
}

/** The sessions the fake JoyoRogo knows: token -> user. */
const sessions = new Map<string, FakeUser>();
/** The `locale` JoyoRogo's profile holds per user id; a user not listed is `id`. */
export const locales = new Map<string, string>();
/** Users whose JoyoRogo account counts as Founder (`fitness.cloudAccess` says `unlocked`). */
export const founders = new Set<string>();
export const upstream = {
  calls: [] as { url: string; cookie: string | null }[],
  failWith: null as number | null,
  /** Status the fake `fitness/cloudAccess` answers instead of the real answer; null = normal. */
  accessFailWith: null as number | null,
};

/**
 * What JoyoRogo's Strava grant API (`/internal/joyofit/strava/<action>`) saw, and how it answers: set `handler` per
 * test; it receives the action and the parsed JSON body. The real logic is tested in the joyorogo repo.
 */
export const grantApi = {
  calls: [] as { action: string; headers: Headers; body: Record<string, unknown> }[],
  handler: null as ((action: string, body: Record<string, unknown>) => Response) | null,
};

/** Atur's signed-in feedback API (`<origin>/api/feedback/<token>/me/*`): what it saw, and how it answers (per test). */
export const aturApi = {
  calls: [] as { url: string; method: string; headers: Headers; body: string | null }[],
  handler: null as ((url: URL, method: string) => Response | Promise<Response>) | null,
};

/** Expo Push messages the Worker sent, and how Expo answers (per message `ok`, or a details error such as DeviceNotRegistered). */
export const expo = {
  sent: [] as { to: string; title: string; body: string; data: Record<string, string> }[],
  failWith: null as string | null,
};

/** Emails the Worker sent through the EMAIL binding. */
export const outbox: { to: string; subject: string; text: string; html: string }[] = [];
export const fakeEmail = {
  send: async (message: { to: string; subject: string; text: string; html: string }) => {
    outbox.push({ to: message.to, subject: message.subject, text: message.text, html: message.html });
  },
} as unknown as SendEmail;

let counter = 0;
/** Registers a user and returns the Cookie header the app would send for them. Founder unless `founder` is false. */
export function signUp(name: string, { founder = true, locale = "id" }: { founder?: boolean; locale?: string } = {}): { user: FakeUser; cookie: string } {
  counter += 1;
  const user = { id: `user-${name}-${counter}`, email: `${name}-${counter}@example.com`, name };
  const token = `token-${name}-${counter}`;
  sessions.set(token, user);
  if (founder) founders.add(user.id);
  locales.set(user.id, locale);
  return { user, cookie: `__Secure-better-auth.session_token=${token}.sig` };
}

/** What JoyoRogo's `/api/auth/get-session` answers for a Cookie header. */
export function fakeGetSession(cookie: string | null): Response {
  if (upstream.failWith) return new Response("boom", { status: upstream.failWith });
  const match = /session_token=(token-[^.;]+)/.exec(cookie ?? "");
  const user = match?.[1] ? sessions.get(match[1]) : undefined;
  if (!user) return Response.json(null);
  return Response.json({
    user,
    session: { id: "s", userId: user.id, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
}

/** What JoyoRogo's oRPC `fitness/cloudAccess` answers for a Cookie header. */
export function fakeCloudAccess(cookie: string | null): Response {
  if (upstream.accessFailWith) return new Response("boom", { status: upstream.accessFailWith });
  const match = /session_token=(token-[^.;]+)/.exec(cookie ?? "");
  const user = match?.[1] ? sessions.get(match[1]) : undefined;
  if (!user) return Response.json({ json: { defined: false, code: "UNAUTHORIZED", status: 401 } }, { status: 401 });
  const unlocked = founders.has(user.id);
  return Response.json({ json: { unlocked, tier: unlocked ? "founder" : "free" } });
}

/** What JoyoRogo's `/internal/joyofit/family/users` answers. */
export function fakeFamilyUsers(userIds: string[]): Response {
  const users = [...sessions.values()]
    .filter((u) => userIds.includes(u.id))
    .map((u) => ({ id: u.id, name: u.name, email: u.email, locale: locales.get(u.id) ?? "id", tier: founders.has(u.id) ? "founder" : "free", pro: founders.has(u.id) }));
  return Response.json({ users });
}

/** The fake JoyoRogo as a whole: routes by URL like the real server. */
export function fakeJoyorogo(url: string, cookie: string | null): Response {
  return url.endsWith("/rpc/fitness/cloudAccess") ? fakeCloudAccess(cookie) : fakeGetSession(cookie);
}

beforeEach(() => {
  clearAuthCache();
  clearAccessCache();
  clearRogoCache();
  upstream.calls = [];
  upstream.failWith = null;
  upstream.accessFailWith = null;
  grantApi.calls = [];
  grantApi.handler = null;
  aturApi.calls = [];
  aturApi.handler = null;
  expo.sent = [];
  expo.failWith = null;
  outbox.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const grantCall = /\/internal\/joyofit\/strava\/(\w+)$/.exec(String(input));
    if (grantCall?.[1]) {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      grantApi.calls.push({ action: grantCall[1], headers: new Headers(init?.headers), body });
      if (!grantApi.handler) throw new Error(`unexpected grant API call: ${String(input)}`);
      return grantApi.handler(grantCall[1], body);
    }
    if (String(input).startsWith("https://atur.test/")) {
      const method = init?.method ?? "GET";
      aturApi.calls.push({ url: String(input), method, headers: new Headers(init?.headers), body: init?.body ? String(init.body) : null });
      if (!aturApi.handler) throw new Error(`unexpected Atur call: ${String(input)}`);
      return aturApi.handler(new URL(String(input)), method);
    }
    if (String(input).endsWith("/internal/joyofit/family/users")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { userIds: string[] };
      return fakeFamilyUsers(body.userIds);
    }
    if (String(input) === "https://exp.host/--/api/v2/push/send") {
      const messages = JSON.parse(String(init?.body ?? "[]")) as { to: string; title: string; body: string; data: Record<string, string> }[];
      expo.sent.push(...messages);
      return Response.json({ data: messages.map(() => (expo.failWith ? { status: "error", details: { error: expo.failWith } } : { status: "ok", id: "x" })) });
    }
    if (String(input).startsWith("https://www.strava.com/")) throw new Error(`JoyoFit's Worker must not call Strava itself: ${String(input)}`);
    const headers = new Headers(init?.headers);
    upstream.calls.push({ url: String(input), cookie: headers.get("cookie") });
    return fakeJoyorogo(String(input), headers.get("cookie"));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

export async function call(
  path: string,
  init: RequestInit & { cookie?: string; env?: Partial<AppEnv> } = {},
): Promise<Response> {
  const { cookie, env: overrides, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookie) headers.set("cookie", cookie);
  const ctx = createExecutionContext();
  const response = await app.fetch(new Request(`https://api.test${path}`, { ...rest, headers }), { ...workerEnv, DB: env.DB, ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

export function postJson(path: string, body: unknown, cookie?: string): Promise<Response> {
  return call(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    ...(cookie ? { cookie } : {}),
  });
}
