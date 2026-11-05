/**
 * Publishing a built `.hwt` to the account's watch-face library (`POST /api/fit/watchfaces`, proxied by JoyoRogo to the JoyoFit
 * Worker's `POST /v1/watchfaces`). Uploads are a Pro benefit: the Worker gates the route with `requireFounder`, so a free or signed-out
 * caller gets `paywall` / `unauthorized`. Once published, the face shows up in the JoyoFit app's watch-face Library and installs over
 * Bluetooth with no file transfer.
 *
 * The browser sets `Content-Length` from the body itself; it is a forbidden header to set by hand, so it is left off here.
 */
import { CloudError, envOrigin, isRecord } from "./api";

export interface PublishedWatchface {
  id: string;
  name: string;
}

export interface PublishOptions {
  fetch?: typeof fetch;
  origin?: string;
}

/** The JoyoRogo proxy must forward `/api/fit/watchfaces` to the Worker's `/v1/watchfaces` (as it already does for `/studio/projects`). */
export async function publishWatchface(
  bytes: Uint8Array,
  filename: string,
  options: PublishOptions = {},
): Promise<PublishedWatchface> {
  const origin = (options.origin ?? envOrigin()).replace(/\/+$/, "");
  const url = `${origin}/api/fit/watchfaces?filename=${encodeURIComponent(filename)}`;
  const doFetch = options.fetch ?? fetch;

  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/octet-stream" },
      // A fresh ArrayBuffer-backed copy, so a Uint8Array view with an offset is sent whole.
      body: bytes.slice(),
      credentials: "include",
    });
  } catch {
    throw new CloudError("network");
  }

  if (res.ok) {
    const body: unknown = await res.json().catch(() => null);
    if (!isRecord(body) || typeof body.id !== "string") throw new CloudError("server", res.status);
    const name = typeof body.name === "string" ? body.name : filename;
    return { id: body.id, name };
  }

  const body: unknown = await res.json().catch(() => null);
  const record = isRecord(body) ? body : {};
  const code = typeof record.error === "string" ? record.error : "";
  const maxBytes = typeof record.maxBytes === "number" ? record.maxBytes : undefined;
  const max = typeof record.max === "number" ? record.max : undefined;
  switch (res.status) {
    case 401:
      throw new CloudError("unauthorized", 401);
    case 402:
    case 403:
      throw new CloudError("paywall", res.status);
    case 413:
      throw new CloudError("too_large", 413, { maxBytes });
    case 409:
      if (code === "library_full") throw new CloudError("library_full", 409, { max });
      throw new CloudError("server", 409);
    case 502:
    case 503:
      throw new CloudError("unavailable", res.status);
    default:
      throw new CloudError("server", res.status);
  }
}
