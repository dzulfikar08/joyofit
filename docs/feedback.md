# Feedback: Atur widget signed with the JoyoFit account

Ideas, bug reports and help requests go to the FIT project's Atur feedback board (workspace `joyofit`, board token
`pk_fb_3d56898896b544949f03abc0f28256cb`). Two doors:

- **https://fit.joyorogo.com/issues** (and `/feedback`): a redirect to the portal, `https://app.diatur.com/portal/joyofit`
  (`site/public/_redirects`). Browsing works without signing in; voting and "my requests" ask for a one-time email code.
- **JoyoFit web** (app.fit.joyorogo.com, JoyoRogo repo `apps/fit`): **`/issues`** (account menu, *Masukan*), a page of
  its own as the signed-in account (no Atur account, no code, no widget): a form to report a problem, ask a question or
  suggest an idea (with screenshots), ideas to vote on and comment, *Laporanku* (the account's tickets with the team's
  replies, and replying), and what shipped. A bug report or question becomes a support ticket under the account's email.

## How the account is trusted

The page never talks to Atur with anything a browser could reuse. `/v1/feedback/*` (`server/src/feedback.ts`) relays
each call to Atur's signed-in API with a fresh 2-minute signature made with `ATUR_IDENTIFY_SECRET`, a Worker secret
(`bunx wrangler secret put ATUR_IDENTIFY_SECRET` in `server/`), copied from Atur: FIT, Project settings, Feedback board,
Identify secret. Unset, the routes answer 503. Rotating it in Atur breaks the page until the Worker has the new value.
Screenshots go straight from the browser to the board's public upload (`/api/feedback/<token>/attachments`, images and
text, 10 MB, unclaimed files deleted after 2 h); only their ids travel with the report.

## The `/issues` page's data

`/v1/feedback/<path>` (`server/src/feedback.ts`, `requireUser`, any account, not only Pro) relays to Atur's signed-in API,
`${ATUR_ORIGIN}/api/feedback/${ATUR_BOARD_TOKEN}/me/<path>` (Atur repo `docs/feedback-portal.md`, "Signed-in API"), with a
fresh 2-minute signature `hex(HMAC-SHA256(ATUR_IDENTIFY_SECRET, "me:" + id + ":" + lowercased email + ":" + expires))` in
`X-Atur-*` headers. Only these are relayed: `GET board`, `POST items` (the form: `{ title, description?, kind, attachment_ids?, context? }`),
`GET items/<uuid>`, `POST items/<uuid>/votes`,
`POST items/<uuid>/comments` (`{ body }`), `GET reports`, `GET tickets/<seq>[?project=]`, `POST tickets/<seq>/comments`
(`{ body }`), `GET changelog`. Atur's 4xx comes back as is; its 5xx or a network error is `502 feedback_unavailable`. The
web app reaches these through the JoyoRogo proxy (`/api/fit/feedback/*`).
