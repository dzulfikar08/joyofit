# Change JoyoRogo needs for JoyoFit sign-in

JoyoFit signs in through JoyoRogo's better-auth server (`https://api.joyorogo.com/api/auth`) with
`@better-auth/expo`, exactly like JoyoRogo's own app. The JoyoFit Worker (`server/`) then verifies the
session by calling `GET /api/auth/get-session` with the session cookies, so **no JWT/bearer plugin and no
shared secret is needed**. One change is required in JoyoRogo; nothing was edited there from this repo.

## 1. Trust the `joyofit://` scheme (required)

`packages/auth/src/index.ts`, `trustedOrigins`: the expo client sends `expo-origin: joyofit://` and a
`callbackURL` of `joyofit:///`, and better-auth refuses both unless the scheme is trusted (JoyoRogo's
own `joyorogo://` is listed the same way).

```diff
     trustedOrigins: [
       // CORS_ORIGIN accepts a comma-separated list: local + deployed web app
       ...env.CORS_ORIGIN.split(",")
         .map((origin) => origin.trim())
         .filter(Boolean),
       ...desktopOrigins,
       "joyorogo://",
+      "joyofit://",
       "exp://",
       "http://localhost:8081",
     ],
```

Redeploy JoyoRogo's server after the change. Without it, tapping **Sign in with JoyoRogo** in JoyoFit
ends with an "Invalid callbackURL" / "Invalid origin" error from JoyoRogo.

Google OAuth needs no change: the redirect URI stays JoyoRogo's own `/api/auth/callback/google`, and the
`expo()` plugin already forwards the finished session to whatever trusted deep link the app asked for.

## 2. Nothing else (how verification works)

- The app keeps the better-auth cookies in `expo-secure-store` and sends them as a plain `Cookie` header
  to the JoyoFit Worker (`authClient.getCookie()`).
- The Worker keeps only the `*.session_token` / `*.session_data` cookies and calls
  `${JOYOROGO_AUTH_URL}/api/auth/get-session` with them. A JSON `null` or 401 means "not signed in"; a user
  object gives the user id that owns every row.
- It reuses a verified session for 60 s per isolate (JoyoRogo already caches sessions in a signed cookie
  for 5 minutes), so a sync burst is one call to JoyoRogo.
- `get-session` is a GET, so better-auth's origin check does not apply to it, and the cookies are not
  browser cookies, so JoyoRogo's CORS/`sameSite` settings are irrelevant to this call.

## 3. Optional: service binding instead of HTTPS

If both Workers are in the same Cloudflare account, bind JoyoRogo's server Worker so the verification
call never leaves Cloudflare. JoyoRogo needs no change for this. In `server/wrangler.jsonc` uncomment
`services` and put JoyoRogo's deployed Worker name in `service` (alchemy names it from the `server`
resource; check `wrangler deployments`/the dashboard). The code uses `AUTH_SERVICE` automatically when it
is bound; `JOYOROGO_AUTH_URL` is still used to build the request URL.

## 4. Optional: proxy `/api/fit/watchfaces` for Studio "Publish to my watch app"

The web Studio publishes a built `.hwt` to the account's library so it shows up in the JoyoFit app with no file transfer. The browser
calls `POST /api/fit/watchfaces?filename=...` (same origin as the existing `/api/fit/studio/projects`), which JoyoRogo forwards to the
JoyoFit Worker's `POST /v1/watchfaces`. If JoyoRogo's proxy already rewrites `/api/fit/*` to the Worker's `/v1/*` generically, nothing is
needed. If it is path-specific, add `/api/fit/watchfaces` (and `/api/fit/watchfaces/:id`, `/api/fit/watchfaces/:id/file`) the same way
`/api/fit/studio/projects` is routed. The Worker already gates the upload with `requireFounder` (Pro only); reads stay open to any
signed-in account.
