# Feedback: Atur widget signed with the JoyoFit account

Ideas, bug reports and help requests go to the FIT project's Atur feedback board (workspace `joyofit`, board token
`pk_fb_3d56898896b544949f03abc0f28256cb`). Two doors:

- **https://fit.joyorogo.com/issues** (and `/feedback`): a redirect to the portal, `https://app.diatur.com/portal/joyofit`
  (`site/public/_redirects`). Browsing works without signing in; voting and "my requests" ask for a one-time email code.
- **JoyoFit web** (app.fit.joyorogo.com, JoyoRogo repo `apps/fit`): account menu, *Kirim masukan*. It opens Atur's widget
  (`app.diatur.com/widget.js`, no floating button, Indonesian or English from `<html lang>`) as the signed-in account:
  no Atur account, no code. A bug report or help request becomes a support ticket under the account's email.

## How the account is trusted

`GET /v1/feedback/identity` (`server/src/feedback.ts`, behind `requireUser`) returns `{ id, email, name, signature }`
with `signature = hex(HMAC-SHA256(ATUR_IDENTIFY_SECRET, id + ":" + lowercased email))`. The web app reaches it through
the JoyoRogo API's proxy (`GET /api/fit/feedback/identity`) and passes it to `Atur.identify()`. Atur checks the same HMAC
with the board's identify secret, so the email cannot be typed in by someone else.

`ATUR_IDENTIFY_SECRET` is a Worker secret (`bunx wrangler secret put ATUR_IDENTIFY_SECRET` in `server/`), copied from
Atur: FIT, Project settings, Feedback board, Identify secret. Unset, the route answers 503 and the widget asks for an
email instead (the report still arrives, marked unverified). Rotating it in Atur breaks signatures until the Worker has
the new value.
