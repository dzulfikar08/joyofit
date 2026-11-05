import { describe, expect, it } from "vitest";
import { CloudError } from "./api";
import { publishWatchface } from "./watchfaces";

interface Call {
  url: string;
  init: RequestInit;
}

function fake(...answers: Array<Response | Error>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (!next) throw new Error("unexpected call");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bytes = new Uint8Array([1, 2, 3, 4]);
const run = (f: ReturnType<typeof fake>, name = "My Face.hwt") => publishWatchface(bytes, name, { fetch: f.impl, origin: "https://api.test" });

async function kind(promise: Promise<unknown>): Promise<CloudError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CloudError);
    return error as CloudError;
  }
  throw new Error("expected a CloudError");
}

describe("publishWatchface", () => {
  it("POSTs the bytes to the proxy with the filename and the session cookie, and returns the record", async () => {
    const f = fake(json({ id: "abc", name: "My Face", filename: "My Face.hwt", size: 4 }, 201));
    expect(await run(f)).toEqual({ id: "abc", name: "My Face" });
    expect(f.calls[0]?.url).toBe("https://api.test/api/fit/watchfaces?filename=My%20Face.hwt");
    expect(f.calls[0]?.init.method).toBe("POST");
    expect(f.calls[0]?.init.credentials).toBe("include");
  });

  it("falls back to the filename when the server omits the name", async () => {
    const f = fake(json({ id: "abc" }, 201));
    expect(await run(f, "x.hwt")).toEqual({ id: "abc", name: "x.hwt" });
  });

  it("maps the Pro gate (402 and 403) to paywall", async () => {
    expect((await kind(run(fake(json({ error: "founder_required" }, 402))))).kind).toBe("paywall");
    expect((await kind(run(fake(json({}, 403))))).kind).toBe("paywall");
  });

  it("maps 401 to unauthorized", async () => {
    expect((await kind(run(fake(json({}, 401))))).kind).toBe("unauthorized");
  });

  it("maps a full library, with the max", async () => {
    const e = await kind(run(fake(json({ error: "library_full", max: 20 }, 409))));
    expect(e.kind).toBe("library_full");
    expect(e.max).toBe(20);
  });

  it("maps 413 to too_large", async () => {
    expect((await kind(run(fake(json({ error: "too_large", maxBytes: 100 }, 413))))).kind).toBe("too_large");
  });

  it("maps a down account service to unavailable, and a thrown fetch to network", async () => {
    expect((await kind(run(fake(json({}, 503))))).kind).toBe("unavailable");
    expect((await kind(run(fake(new Error("offline"))))).kind).toBe("network");
  });

  it("treats a 2xx without an id as a server error", async () => {
    expect((await kind(run(fake(json({ ok: true }, 201))))).kind).toBe("server");
  });
});
