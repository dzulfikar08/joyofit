# Feedback: Atur widget signed with the JoyoFit account

Ideas, bug reports and help requests go to the FIT project's Atur feedback board (workspace `joyofit`, board token
`pk_fb_3d56898896b544949f03abc0f28256cb`). Two doors:

- **https://fit.joyorogo.com/issues** (and `/feedback`): a redirect to the portal, `https://app.diatur.com/portal/joyofit`
  (`site/public/_redirects`). Browsing works without signing in; voting and "my requests" ask for a one-time email code.
- **JoyoFit web** (app.fit.joyorogo.com, JoyoRogo repo `apps/fit`): **`/issues`** (account menu, *Masukan*), a page of
  its own as the signed-in account (no Atur account, no code): ideas to vote on and comment, *Laporanku* (the account's
  tickets with the team's replies, and replying), and what shipped. Its buttons open Atur's widget
  (`app.diatur.com/widget.js`, no floating button, Indonesian or English from `<html lang>`) to file a report or an idea;
  a bug report or help request becomes a support ticket under the account's email.

## How the account is trusted

`GET /v1/feedback/identity` (`server/src/feedback.ts`, behind `requireUser`) returns `{ id, email, name, signature }`
with `signature = hex(HMAC-SHA256(ATUR_IDENTIFY_SECRET, id + ":" + lowercased email))`. The web app reaches it through
the JoyoRogo API's proxy (`GET /api/fit/feedback/identity`) and passes it to `Atur.identify()`. Atur checks the same HMAC
with the board's identify secret, so the email cannot be typed in by someone else.

`ATUR_IDENTIFY_SECRET` is a Worker secret (`bunx wrangler secret put ATUR_IDENTIFY_SECRET` in `server/`), copied from
Atur: FIT, Project settings, Feedback board, Identify secret. Unset, the route answers 503 and the widget asks for an
email instead (the report still arrives, marked unverified). Rotating it in Atur breaks signatures until the Worker has
the new value.

## The `/issues` page's data

`/v1/feedback/<path>` (`server/src/feedback.ts`, `requireUser`, any account, not only Pro) relays to Atur's signed-in API,
`${ATUR_ORIGIN}/api/feedback/${ATUR_BOARD_TOKEN}/me/<path>` (Atur repo `docs/feedback-portal.md`, "Signed-in API"), with a
fresh 2-minute signature `hex(HMAC-SHA256(ATUR_IDENTIFY_SECRET, "me:" + id + ":" + lowercased email + ":" + expires))` in
`X-Atur-*` headers. Only these are relayed: `GET board`, `GET items/<uuid>`, `POST items/<uuid>/votes`,
`POST items/<uuid>/comments` (`{ body }`), `GET reports`, `GET tickets/<seq>[?project=]`, `POST tickets/<seq>/comments`
(`{ body }`), `GET changelog`. Atur's 4xx comes back as is; its 5xx or a network error is `502 feedback_unavailable`. The
web app reaches these through the JoyoRogo proxy (`/api/fit/feedback/*`).
