// Serves CI build tools that may not be published (Huawei's Command Line Tools for HarmonyOS) from the private
// R2 bucket joyofit-ci-tools to GitHub Actions. README.md in this folder has the setup.
//
//   GET /<object key>   Authorization: Bearer <CI_TOOLS_KEY>   -> the object, or 401 / 404

interface Env {
  TOOLS: R2Bucket;
  CI_TOOLS_KEY: string;
}

async function keyMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") return new Response("method not allowed\n", { status: 405 });
    const auth = request.headers.get("authorization") ?? "";
    const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!env.CI_TOOLS_KEY || !given || !(await keyMatches(given, env.CI_TOOLS_KEY))) {
      return new Response("unauthorized\n", { status: 401 });
    }
    const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    const object = key ? await env.TOOLS.get(key) : null;
    if (!object) return new Response("not found\n", { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-length", String(object.size));
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "private, no-store");
    return new Response(object.body, { headers });
  },
} satisfies ExportedHandler<Env>;
