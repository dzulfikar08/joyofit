/**
 * Client of the Pro cloud project library. The browser talks to JoyoRogo's proxy (`/api/fit/studio/projects`), which forwards
 * to joyofit-api; the session cookie travels with every call (`credentials: "include"`, the Studio origin is CORS-allowed).
 * Every failure is mapped to a `CloudError` whose `kind` the UI can act on; nothing here touches the editor.
 */

/** JoyoRogo API origin; `VITE_API_URL` points a local build at another one. */
const DEFAULT_ORIGIN = "https://api.joyorogo.com";

export function envOrigin(): string {
  const value: unknown = import.meta.env?.VITE_API_URL;
  return typeof value === "string" && value ? value.replace(/\/+$/, "") : DEFAULT_ORIGIN;
}

/** The server refuses a request body above this many bytes (`413 too_large`), and says so in the list answer. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** Longest cloud project name the server accepts. */
export const NAME_MAX = 80;

export interface CloudMeta {
  id: string;
  name: string;
  rev: number;
  size: number;
  createdAt: number;
  updatedAt: number;
  /** `data:image/(png|jpeg|webp);base64,...`, or null when the project has no thumbnail. */
  thumb: string | null;
}

export interface CloudList {
  projects: CloudMeta[];
  max: number;
  maxBytes: number;
}

export interface CloudProject extends CloudMeta {
  /** The `.project.json` document (`serializeProject` as an object). */
  document: unknown;
}

export type CloudAccess = { state: "signed-out" } | { state: "signed-in"; unlocked: boolean; tier: string };

export type CloudErrorKind =
  /** 401: no session. */
  | "unauthorized"
  /** 402: writing is a Pro feature. */
  | "paywall"
  /** 409 `library_full`. */
  | "library_full"
  /** 413, or the body was measured above the limit before it was sent. */
  | "too_large"
  /** 409 `rev_conflict`: the cloud copy moved on. */
  | "rev_conflict"
  | "not_found"
  /** 502 / 503: the account service is down. */
  | "unavailable"
  /** Any other HTTP failure, or an answer that is not what the contract says. */
  | "server"
  /** The request never got an answer (offline, blocked, DNS). */
  | "network";

export class CloudError extends Error {
  readonly kind: CloudErrorKind;
  readonly status: number;
  /** `library_full`: the project limit. */
  readonly max?: number;
  /** `too_large`: the body limit in bytes. */
  readonly maxBytes?: number;
  /** `too_large`: the measured body size, when known. */
  readonly size?: number;
  /** `rev_conflict`: the revision and time the cloud copy has now. */
  readonly rev?: number;
  readonly updatedAt?: number;

  constructor(kind: CloudErrorKind, status = 0, extra: { max?: number; maxBytes?: number; size?: number; rev?: number; updatedAt?: number } = {}) {
    super(`cloud: ${kind}`);
    this.name = "CloudError";
    this.kind = kind;
    this.status = status;
    Object.assign(this, extra);
  }
}

export function isCloudError(value: unknown): value is CloudError {
  return value instanceof CloudError;
}

/** Bytes of the request body as the server counts them. */
export function bodyBytes(body: string): number {
  return new Blob([body]).size;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

function parseMeta(value: unknown): CloudMeta {
  if (!isRecord(value)) throw new CloudError("server");
  const { id, name, rev, size, createdAt, updatedAt, thumb } = value;
  if (typeof id !== "string" || typeof name !== "string" || num(rev) === undefined || num(size) === undefined || num(createdAt) === undefined || num(updatedAt) === undefined) {
    throw new CloudError("server");
  }
  return { id, name, rev: rev as number, size: size as number, createdAt: createdAt as number, updatedAt: updatedAt as number, thumb: typeof thumb === "string" ? thumb : null };
}

export interface CloudApiOptions {
  fetch?: typeof fetch;
  origin?: string;
  /** Language code for the `x-locale` header, read per call. */
  locale?: () => string;
}

export interface WriteInput {
  name?: string;
  thumb?: string | null;
  document?: unknown;
}

export interface CloudApi {
  /** Who is signed in and whether Pro features are unlocked. */
  access(): Promise<CloudAccess>;
  list(): Promise<CloudList>;
  get(id: string): Promise<CloudProject>;
  create(input: { name: string; thumb?: string | null; document: unknown }, limit?: number): Promise<CloudMeta>;
  update(id: string, input: WriteInput & { rev: number }, limit?: number): Promise<CloudMeta>;
  remove(id: string): Promise<void>;
}

export function createCloudApi(options: CloudApiOptions = {}): CloudApi {
  const origin = (options.origin ?? envOrigin()).replace(/\/+$/, "");
  const base = `${origin}/api/fit/studio/projects`;
  const accessUrl = `${origin}/rpc/fitness/cloudAccess`;
  const doFetch = (input: string, init: RequestInit): Promise<Response> => (options.fetch ?? fetch)(input, init);

  async function request(url: string, init: { method: string; body?: string }): Promise<Response> {
    const headers: Record<string, string> = { accept: "application/json" };
    const locale = options.locale?.();
    if (locale) headers["x-locale"] = locale;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    try {
      return await doFetch(url, { method: init.method, body: init.body, headers, credentials: "include" });
    } catch {
      throw new CloudError("network");
    }
  }

  async function json(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  /** The contract's answer for a non-2xx status. */
  async function fail(res: Response): Promise<never> {
    const body = await json(res);
    const record = isRecord(body) ? body : {};
    const code = typeof record.error === "string" ? record.error : "";
    const extra = { max: num(record.max), maxBytes: num(record.maxBytes), rev: num(record.rev), updatedAt: num(record.updatedAt) };
    switch (res.status) {
      case 401:
      case 403:
        throw new CloudError("unauthorized", res.status);
      case 402:
        throw new CloudError("paywall", res.status);
      case 404:
        throw new CloudError("not_found", res.status);
      case 409:
        if (code === "rev_conflict") throw new CloudError("rev_conflict", 409, extra);
        if (code === "library_full") throw new CloudError("library_full", 409, extra);
        throw new CloudError("server", 409);
      case 413:
        throw new CloudError("too_large", 413, { maxBytes: extra.maxBytes ?? MAX_BODY_BYTES });
      case 502:
      case 503:
        throw new CloudError("unavailable", res.status);
      default:
        throw new CloudError("server", res.status);
    }
  }

  async function ok(url: string, init: { method: string; body?: string }): Promise<unknown> {
    const res = await request(url, init);
    if (!res.ok) return fail(res);
    return json(res);
  }

  /** Serialises a write and refuses to send what the server would refuse anyway. */
  function writeBody(payload: object, limit: number): string {
    const body = JSON.stringify(payload);
    const size = bodyBytes(body);
    if (size > limit) throw new CloudError("too_large", 0, { maxBytes: limit, size });
    return body;
  }

  const projectUrl = (id: string) => `${base}/${encodeURIComponent(id)}`;

  return {
    async access() {
      const res = await request(accessUrl, { method: "POST", body: JSON.stringify({ json: {} }) });
      if (res.status >= 500) throw new CloudError(res.status === 502 || res.status === 503 ? "unavailable" : "server", res.status);
      // Any other refusal means there is no usable session.
      if (!res.ok) return { state: "signed-out" };
      const body = await json(res);
      const data = isRecord(body) && isRecord(body.json) ? body.json : null;
      if (!data || typeof data.unlocked !== "boolean") throw new CloudError("server", res.status);
      return { state: "signed-in", unlocked: data.unlocked, tier: typeof data.tier === "string" ? data.tier : "" };
    },

    async list() {
      const body = await ok(base, { method: "GET" });
      if (!isRecord(body) || !Array.isArray(body.projects)) throw new CloudError("server");
      return {
        projects: body.projects.map(parseMeta),
        max: num(body.max) ?? 100,
        maxBytes: num(body.maxBytes) ?? MAX_BODY_BYTES,
      };
    },

    async get(id) {
      const body = await ok(projectUrl(id), { method: "GET" });
      if (!isRecord(body) || !("document" in body)) throw new CloudError("server");
      return { ...parseMeta(body), document: body.document };
    },

    async create(input, limit = MAX_BODY_BYTES) {
      const payload: Record<string, unknown> = { name: input.name, document: input.document };
      if (input.thumb !== undefined) payload.thumb = input.thumb;
      return parseMeta(await ok(base, { method: "POST", body: writeBody(payload, limit) }));
    },

    async update(id, input, limit = MAX_BODY_BYTES) {
      const payload: Record<string, unknown> = { rev: input.rev };
      if (input.name !== undefined) payload.name = input.name;
      if (input.thumb !== undefined) payload.thumb = input.thumb;
      if (input.document !== undefined) payload.document = input.document;
      return parseMeta(await ok(projectUrl(id), { method: "PUT", body: writeBody(payload, limit) }));
    },

    async remove(id) {
      await ok(projectUrl(id), { method: "DELETE" });
    },
  };
}
