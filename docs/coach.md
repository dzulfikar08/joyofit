# Coach (Pro)

Written 2026-10-18. A daily suggestion, running and strength plans, an exercise library and the "Joyo AI" chat (named "Tanya coach" before 2026-10-22; the own-key engine is described in "Joyo AI (own key)" below). All of it is JS (ships over the air, `docs/ota.md`), none of it is medical advice, and the daily suggestion, the plans and the feedback are **rules, not a model**: every number below is a constant in the code and is covered by `src/features/coach/coach.test.ts`.

| Part | Code |
| --- | --- |
| Synced document and storage | `doc.ts`, `store.ts` (`coach_doc`), `merge.ts`, `syncDoc.ts`, `sync.ts`; JoyoRogo `coach.getDoc` / `coach.putDoc` |
| Body signals | `signals.ts` (reads `FitnessData`: the same functions Readiness, Kebugaran and Energi Tubuh use) |
| Daily suggestion | `suggest.ts`, `format.ts`, `ui/CoachTodayCard.tsx`, `ui/SuggestionBlock.tsx` |
| Plans | `plans/run.ts`, `plans/runWalk.ts`, `plans/generate.ts`, `plans/adapt.ts`, `progress.ts`, `actions.ts`, `src/app/coach/` |
| Lari-jalan guide, cues and re-test | `runwalk/`, `ui/RunGuideSection.tsx`, `ui/RetestSection.tsx` |
| Matching to watch workouts | `match.ts`, `useCoach.ts` (runs after each sync) |
| Post-workout feedback | `feedback.ts`, `pace.ts`, `ui/CoachFeedbackSection.tsx` (workout detail) |
| Access | `useCoachAccess.ts`: JoyoRogo Pro (`watchWorkout.status.unlocked`), the last answer is kept for offline |
| Joyo AI with your own key | `src/features/ai/` (see "Joyo AI (own key)"): free for everyone 18 or older, not behind Pro |

## Daily suggestion

Fatigue points from the signals that exist; a signal that is missing adds nothing.

| Signal | Points |
| --- | --- |
| Readiness Run down / Strained / Primed | +3 / +2 / -1 |
| "How does your body feel today?" (only while the watch gives no readiness): worn out / tired / fresh | +4 / +2 / -1 |
| HRV status low | +2 |
| Training status overreaching (acute:chronic load over 1.5) | +3 |
| Last night under 6 h / under 7 h | +2 / +1 |
| Sleep debt over 7 nights, 3 h or more / 90 min or more | +2 / +1 |
| Yesterday's strain 15 or more / 12 or more | +2 / +1 |
| Yesterday and the day before both 12 or more | +1 |
| Watch recovery time left over 24 h / over 12 h | +2 / +1 |
| Active (strain 8 or more) on each of the last 5 days | +3 |

Bands: **6 or more** exhausted, **4 to 5** tired, **2 to 3** fair, **0 to 1** fresh.

| State | Suggestion |
| --- | --- |
| Already trained today (a workout of 20 minutes or more) | "Sudah latihan hari ini" |
| Plan finished | "Rencanamu sudah selesai" |
| Exhausted | Rest |
| Today has a plan session, tired | A run: the same time at 70 % (at most 40 min) as an easy run in zone 2. A Lari-jalan session becomes a walk instead. Strength: active rest, 20 min |
| Today has a plan session, fair | The session at 85 % |
| Today has a plan session after a hard day (yesterday's strain 14 or more) and it is a hard run | An easy run at 70 % |
| Today has a plan session, fresh | The session as written |
| Plan session of today already done | "Sesi hari ini sudah selesai" |
| Plan rest day, a session of this week was missed, fresh, yesterday not hard | Catch up the missed session |
| Plan rest day otherwise | "Hari ini jadwal istirahat" |
| Plan rest day of a Lari-jalan plan, not exhausted | The same, with a brisk walk or an easy ride in zone 2 (about 30 minutes) suggested as an option |
| No plan, tired | Active rest: a 30 minute walk in zone 1 |
| No plan, fair or fresh | An easy run in zone 2 (30 or 40 minutes; a walk when walking, riding or strength is what you do most; a strength session of 30 or 40 minutes for strength people) |

The reasons shown are the signals that raised the total, biggest first. With no data at all the card says it is a general suggestion (a strength session for someone who lifts, an easy run otherwise).

### Without a watch

Nothing in Coach needs a watch. With no readiness (no watch, or no night of data yet) the Coach card and screen ask "How does your body feel today?" (fresh, normal, tired, worn out; `feel.ts`, `ui/FeelPicker.tsx`). The answer is kept on the phone for the calendar day (`useFeel.ts`, never synced) and counts as the watch's readiness word in the table above; the watch's own readiness always wins. The chat snapshot sends it as `readiness`. Training-load signals (strain, active streak, recovery time) stay empty without heart-rate data, so the weekly adaptation only reacts to done-against-planned counts.

## Plans

The plan document stores the person's choices (`goal`, `level`, `daysPerWeek`, `weekdays`, `startDay`, `weeks`), the weekly adaptations and what was done. **Sessions are never stored**: `generatePlan` rebuilds them, so two phones with the same document show the same plan. The first week starts on the Monday of the week the plan was made; sessions before the day it was made are greyed and never counted as missed.

Running (`plans/run.ts`, constants at the top, one recipe per goal and level):

- Goals: 5K (8 weeks), 10K (10 weeks, 12 for a beginner), half marathon (12 weeks, 14 for a beginner), regular running 3x a week (8 weeks), and Lari-jalan, the run/walk restart (8 weeks, below). 3 to 5 sessions a week, 3 for regular running and Lari-jalan.
- Slots in order: easy, quality, (recovery), (easy), long; the long run is on the last chosen weekday.
- Volume grows linearly from the first week's minutes to the peak, rounded to 5 minutes. Every fourth week is a cut-back at 80 %. Race goals end with a taper week at 60 % whose last session is the distance itself.
- Beginners start with walk/run (a 5 minute brisk walk, then alternating run and walk, 1 min run / 2 min walk x 8 up to 3 x 8 min run) and move to continuous running after 6 weeks (5K, regular running 4); a beginner 10K or half starts further into the table, 4 weeks.
- Quality alternates tempo (steady, zone 3 to 4) and intervals (3 min hard in zone 4, 2 min easy jog, 3 to 8 reps) from the intermediate level; beginners and intermediate regular runners have an easy run in that slot.
- Easy and long runs: zone 2 (60 to 70 % of the maximum heart rate, the app's zones). Recovery runs: zone 1 to 2, at most 30 minutes.
- Pace targets (shown on the session and used in the feedback) are shares of your threshold pace (`analysis/zones.ts`, from your GPS runs of the last 90 days): easy and long 1.14 to 1.29, recovery 1.29 to 1.6, tempo 1.06 to 1.14, intervals 0.94 to 1.0. No threshold, no pace target: only the zone.

### Lari-jalan (run/walk restart)

Written 2026-10-23. Goal `runWalk` (`plans/runWalk.ts`, constants at the top, tests in `runWalk.test.ts`): an 8-week restart for someone heavier or long off running whose heart rate climbs fast (the owner: 106 kg, 26 y, 1 km at 10:00/km already reaches zone 4). One beginner plan, 3 sessions a week, no level to choose. JoyoFit's own progression, not a published programme, and not medical advice.

| Weeks | Sessions |
| --- | --- |
| 1 to 6 | 5 min brisk walk, then jog and walk in turns, then 5 min walk. Jog / walk x reps: 1 min / 2 min x 8, 1:30 / 2 x 7, 2 / 2 x 6, 3 / 2 x 5, 5 / 2 x 4, 8 / 2 x 3. The walk never shrinks |
| 7 | One continuous jog of 15, 20 and 20 min (the first is a bridge from 8-minute blocks), same warm-up and cool-down |
| 8 | Continuous jog of 25 and 30 min |
| 1, 5, 8 | The last session of the week is the **1 km re-test** instead |

- **Heart rate leads, not pace.** Every jog session is in zones 2 to 3 (`zone` 3 is the ceiling) and carries `walkAtZone` 4: walk when the heart rate reaches zone 4, jog again when it is back in zone 2. The bpm are the person's own zones (`hrzones`). No pace target is shown or judged for these sessions.
- Every fourth week (week 4) is a cut-back at 80 % and the weekly adaptation applies as for every plan (jog reps never below 3, a continuous jog never below 15 min). The re-test is never scaled.
- **Re-test** (`type: 'retest'`, `RunSpec.retest`): 10 min brisk-walk warm-up, 1 km held at the heart rate of zone 3, 5 min walk, 27 minutes planned. The heart rate is the fixed part and the pace the result. The first test (week 1) is the baseline, the others are shown against it, **only when the average heart rates are within 5 bpm** (otherwise the screen says the effort was not the same and shows no verdict). Results are timed by the phone: the km ends when the watch's live distance has grown by 1 km (the pace is time over the measured distance) or at the tap on "1 km done" (the km is then taken as exactly 1 km, and the result says so). The average heart rate is the mean of the live readings and is left empty under 10 readings. Saved on the phone only (`joyofit.coach.retests`, not in the synced document), listed on the Coach screen and the session (`runwalk/retest.ts`).
- **Session guide** (`runwalk/timeline.ts`, `hrCue.ts`, `store.ts`, `ui/RunGuideSection.tsx`, `ui/RetestSection.tsx`). Coach sessions did not have live cues or a watch push: JoyoFit sends no structured workout to the watch, so the cues are phone-side. The person starts a Run workout on the watch and taps "Start guide"; the phone follows the session's timeline by wall clock (so a restart does not lose the place), buzzes at every jog/walk change (distinct patterns), keeps the screen on while it runs, and schedules one local notification per change (17 for the longest session) so it still calls with the screen off. While the watch's live workout sends a heart rate (`useLiveWorkout`, no older than 10 s), a reading in zone 4 or above for 8 s in a row during a jog cues "walk now" (once), and a reading back in zone 2 or below for 10 s cues "jog again". The plan's timeline keeps running underneath; the cue is advice. Without a live heart rate the screen says so and points to the talk test.
- **Rest days** (`Suggestion.restIdeas`): the rest-day suggestion adds a brisk walk or an easy ride in zone 2 of about 30 minutes as an option. They are never planned sessions and never counted in the plan.
- **Daily suggestion**: a tired day turns a Lari-jalan session into a walk (70 % of the time, at most 40 min), never a run; a fair day scales jogging sessions to 85 % but leaves the re-test as written.
- Safety copy is calm and general (`session.hrGuide.calm`, `setup.runWalk.note`): slow is the point, walking is the plan working, stop if something hurts or you feel dizzy or unwell, ask a doctor first with a health condition or a long inactivity. Not medical advice.
- **Cloud**: `goal: 'runWalk'` is a new value of the synced plan document. JoyoRogo's `coachPlanSchema` (`packages/api/src/lib/coach-doc.ts`) must accept it before a Pro account can sync such a plan, or `coach.putDoc` rejects it. A JoyoFit build from before this goal cannot generate the plan: an older app that downloads such a document would fail to build its sessions, so ship the server first and the app update after it.

Not verified on a device: the buzz and the heart-rate cue with the screen off (JavaScript timers may be throttled by the OS; the scheduled notifications are what works with the screen off), the Android notification channel for the immediate cue, and the live distance arriving from the watch during the re-test.

### Weekly adaptation

On the first look at a new week the plan decides what share of that week's volume to keep (`WeekAdjust.scalePct`). The first matching rule wins:

1. Overreaching (load ratio over 1.5): 75 %.
2. Fewer than half of last week's sessions done: 80 %.
3. Low recovery now (HRV low, readiness Run down, or Strained with 3 h or more sleep debt): 85 %.
4. Every session done and the load productive or maintaining: 10 points back toward 100 %.
5. Otherwise not lower than 90 %, not higher than 100 %.

Weeks that passed while the app was closed are decided from completion only (rules 2, 4, 5). The decision is stored in the plan, so every phone shows the same volume.

### Matching to watch workouts

After each sync (`useCoach`), a workout belongs to the open plan session that is of the same kind (a run for running sessions, a walk or a run for walk/run, recovery and Lari-jalan sessions, a strength-type workout for strength), lasted at least 50 % of the planned minutes (60 % walk/run and Lari-jalan; a race 90 % of its distance; strength 15 minutes) and falls from one day before to two days after the session's day. Oldest workout first, the nearest free session by day. Done by hand or skipped sessions are left alone; taking a mark back keeps a tombstone (`cleared`) so the undo wins over the cloud copy and the workout is not matched again.

### Feedback on the workout detail

For a workout matched to a running session (`feedback.ts`): duration within 15 % of the plan; heart-rate zones by session type (easy and long: under 15 % above the session's zone, 2 for a regular run and 3 for a Lari-jalan jog, is fine, 35 % or more is too hard; tempo: 45 % or more in zones 3 to 4, 20 % or more in zone 5 is too hard; intervals: at least 60 % of the planned hard time in zones 4 to 5; walk/run: flags 40 % or more above zone 3; the Lari-jalan re-test: duration only); average pace against the target band (more than 3 % faster or 5 % slower than the band's edges; never for a Lari-jalan session, which is judged by its zones); distance for a race (95 %). The overall line picks, in order: too hard, short, long, too easy (hard sessions only), on target.

## Cloud

The document is one JSON per account in JoyoRogo (`coach_doc`, optimistic `rev`, same pattern as the gear document): `coach.getDoc` is open to every signed-in account, `coach.putDoc` needs Pro and answers `locked` otherwise (the app then keeps changes on the phone). A merge keeps the newer plan (`planUpdatedAt`; ending a plan is `plan: null` with a new time) and merges finished sessions and strength logs per key, the later mark winning. Progress of a plan that is no longer the active one is dropped. Synced from the cloud sync loop (`CloudProvider`), and after every change the person makes. Server side: the joyorogo repo, `docs/coach.md`.

## Joyo AI (own key)

Written 2026-10-22. Code: `src/features/ai/`. The Coach chat has two engines, and the person picks one. The **hosted** engine is the earlier one (JoyoRogo `coach.chat`, Pro, its own daily message limit, `src/features/coach/chat/api.ts`, unchanged). The **own-key** engine (BYOK) lets anyone 18 or older talk to a provider they pay for themselves, with their own API key. Everything in this section is JS (OTA, `docs/ota.md`) and none of it is medical advice. The daily suggestion, the plans and the feedback above stay **rules, not a model**; the model only writes chat answers and the optional insight texts, and the numbers it may use come from the phone.

| | Hosted | Own key |
| --- | --- | --- |
| Who | JoyoRogo Pro | Everyone 18 or older, free. No JoyoRogo account needed; food and weight (JoyoRogo data) are only read when signed in |
| Request goes | phone to JoyoRogo's server to Cloudflare Workers AI, only after the person agreed (see "Hosted consent") | phone straight to the provider the person chose; JoyoRogo is not in the path |
| Limit | JoyoRogo's daily message limit (set on the server, 20 a day for Pro per the owner brief) | `dailyCeiling` provider calls a day counted on the phone (default 40, allowed 5 to 200); provider costs are the person's own |
| Safety pass | JoyoRogo `coach-chat.ts` | the same pass ported to `safety.ts` |
| What JoyoRogo's servers see | the message and the snapshot while answering (nothing stored but counts, see the privacy page) | nothing: no key, no message, no digest |
| Setting | `engine = 'rogo'` (default) | `engine = 'byok'`, set by `connectProvider` |

Removing the provider in use sets the engine back to `rogo` (see "Consent and withdrawing").

### Hosted consent

Added 2026-11-03 after App Review (5.1.1(i), 5.1.2(i): personal data went to a third-party AI without a clear explanation, the recipient and a yes). Nothing reaches the hosted engine (`coach/chat`) before the person agreed on this phone.

- **Record.** `AiSettings.hostedConsent: { version, at } | null` in the Joyo AI settings (kv-store on the phone, never synced). `HOSTED_CONSENT_VERSION` and `HOSTED_CONSENT_CATEGORIES` live in `src/features/ai/hostedConsent.ts`; `hostedConsent.test.ts` pins the list to the version, and `SNAPSHOT_FIELD_CATEGORY` is a `Record<keyof CoachSnapshot, ...>`, so a new snapshot field does not compile until it is placed in a listed category. Change what is sent: reword `ai:hosted.data.*` (both locales), the privacy page (`site/src/Privasi.tsx`, ids `joyo-ai-hosted`, `joyo-ai-hosted-en`), bump the version, add its pin.
- **Gate in code.** `coachChat` (`features/coach/chat/api.ts`) is `guardHosted(aiSettings, sendChat)` (`hostedChat.ts`): it reads the settings at call time and throws `HostedConsentError` before anything is sent. It is the only function that posts `coach/chat`. `coach/status` (the daily counter, no personal data) is not gated.
- **Screen.** `JoyoAiChat` shows `HostedConsentCard` (recipients, the data list, what is never sent, purpose and retention, the privacy-policy link, **Agree and continue** and **Not now**) instead of the composer while engine is `rogo`, the account is Pro and there is no valid yes; Not now leaves the chat. Review and withdraw: Settings, Joyo AI, "Data sent to JoyoRogo's AI" (a switch: on opens `/settings/ai-consent`, off withdraws at once) and `/settings/ai-consent` (`HostedConsentScreen`). Delete all Joyo AI data resets it.
- **Recipient wording** (`ai:hosted.to`): JoyoRogo's server (PT Joyo Digitama Solusi) and Cloudflare Workers AI (Cloudflare, Inc.), which runs the AI model (JoyoRogo: `@cf/google/gemma-4-26b-a4b-it`, `AI_COACH_MODEL`). What the server adds to the phone's snapshot: the account profile (age, sex, height, weight, goal, pregnancy or breastfeeding mode, eating target, TDEE) and food totals (JoyoRogo `coach-chat.ts`, `readCoachServerContext`). JoyoRogo stores no message text, only counts and token usage; Cloudflare's Workers AI data-usage page states no retention of inputs and outputs and no training.
- JoyoRogo does not check consent for `coach/chat` (older Android builds would break), so the phone's gate is the enforcement.

### Providers and adapters

Two request formats cover every provider (`adapters/`), picked by the preset (`providers.ts`, `PROVIDERS`, `PROVIDER_ORDER`):

| Provider | Adapter | Endpoint | Notes |
| --- | --- | --- | --- |
| OpenRouter | OpenAI chat completions | `https://openrouter.ai/api/v1` | listed first in setup: prepaid credits cap what a mistake costs |
| OpenAI | OpenAI chat completions | `https://api.openai.com/v1` | sends `max_completion_tokens` (the others `max_tokens`) |
| Anthropic | Messages (`/v1/messages`) | `https://api.anthropic.com` | headers `x-api-key` and `anthropic-version: 2023-06-01`; `max_tokens` gets 1,200 extra for thinking; Claude 5 models get `output_config.effort = low`; tool results ride in a user turn and same-role neighbours are merged |
| Gemini | OpenAI chat completions | `https://generativelanguage.googleapis.com/v1beta/openai` | `reasoning_effort = low`; the model list returns `models/<id>`, the prefix is dropped; `freeTierTrainsOnData` is true (see consent) |
| Custom | OpenAI chat completions | typed by the person (LiteLLM, Ollama on the LAN, a company gateway) | plain `http://` is accepted only for `localhost`, `127.*`, `10.*`, `192.168.*`, `172.16-31.*` and `*.local`; any other `http://` host is `badUrl` (`isInsecureRemote`) |

OpenAI-style requests use `Authorization: Bearer <key>`; every request is `credentials: 'omit'`. The key test (`testProvider`) lists the provider's models (15 s limit), picks the model with `resolveModel` (the person's choice, else the preset default, else the first suggested one the list contains, so a retired default never blocks setup), then sends **one** message ("ping", 16 output tokens) with no health data. A server without a model list (some custom gateways) may still pass the chat call. A model that answers "no tool calling" (`noTools`) is remembered per `provider:model` in the settings and from then on answers from the digest alone; the answer carries `toolsUnsupported` so the screen can say so.

The default model ids and the suggested ones in `PROVIDERS` were written on 2026-10-22 and are **[NOT VERIFIED]** against each provider's live catalogue at release; the provider's own list replaces a default it does not contain.

### Key handling

- The key lives in `expo-secure-store` only, one entry per provider (`joyofit.ai.key.<provider>`), written with `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` (`stores.ts`, `keyVault.ts`): on iOS that keeps it out of iCloud Keychain and device backups. The kv-store holds only a `keySaved` flag per provider, never the key. **[NOT VERIFIED]** what Android does with a SecureStore value in a cloud backup or on a new phone; Expo's documentation for the installed SDK has not been checked for that case.
- It is never sent to JoyoRogo or the JoyoFit Worker, never synced (`syncInventory.ts`), and not registered with any sync code. The only request that carries it goes to the provider's own host, as a header.
- It is not logged: nothing in `src/features/ai/` writes to a log or to the cloud log. The text kept from a provider error (`AiError.detail`, at most 240 characters, control characters removed) has the key replaced with `[key]`, `sk-...` tokens cut to six characters and `AIza...` tokens cut to four, because a provider may echo a key back.
- A pasted key is cleaned (`cleanPastedKey`: spaces, line breaks, a leading `Bearer`, quotes) and shown masked (`maskKey`, "sk-...Ab3f"). Setup saves nothing until the test passed and the consent box is ticked (`connectProvider`).
- Under 18 and unknown-age rules are in "Who may use it".

### The digest

Every question sends the digest (`digest.ts`, `joyofit.digest` v1, `DIGEST_VERSION = 1`) in the system prompt as JSON. It is built from the same numbers Readiness and Coach show, gathered fresh for each question (`data/assemble.ts`). `buildDigest` copies named fields only, so an extra property in a data source is dropped there, not sent. Missing is `null`, never 0; free text is flattened (`flat`: control characters and line breaks removed, length capped) so a note or an imported name cannot add its own instruction line. Size cap: **8,500 characters** (about 2,000 to 2,500 tokens); when over, in this order: workouts cut to 5, then none, days cut to 7, plan dropped, days cut to 3, goals dropped. Notes, state and coverage always stay.

| In the digest | Detail |
| --- | --- |
| Person | age (this year minus the birth year, the lower of the phone's profile and the JoyoRogo profile), sex, height, goal. **Not** pregnancy or breastfeeding mode: the owner's rule is that it is never read for the AI or sent to a provider |
| Goals | daily step goal and whether it is the default, sleep need, eat target, weight goal and date |
| State | readiness word (or calibrating), training load and ratio, HRV state and values, sleep debt, 7-day strain average, VO2max, recovery hours left |
| 14 days | per day: sleep minutes and score, resting heart rate, overnight HRV, strain, steps, active kcal, exercise minutes; weight, eaten kcal and protein only when signed in to JoyoRogo |
| Workouts | up to 10 of the last 14 days: id, date, sport, minutes, km, average heart rate, the plan session it matched |
| Plan | goal, level, week, weeks, done and planned this week, scale % |
| Notes | the person's coach notes (below) |
| Coverage | counts of watch days, food days, weigh-ins, and what is missing and why |

Not in it, on purpose: **pregnancy and breastfeeding mode** (a JoyoRogo profile field; never read for the AI, `person.ts` has no field for it, and a test checks a source carrying it cannot reach the digest; consent version 2 removed it from the list, so everyone who agreed under version 1 is asked again), and **menstrual cycle data** (the owner's rule: no AI path reads it. The daily rows read no cycle table, the digest has no cycle field, the hosted chat snapshot has none either, and a test builds a digest from a source that carries cycle fields and checks they cannot appear), **Strava data**, **GPS** (also not in the workout tool), **per-minute heart rate**, sleep stages (only the one-night tool reads them, on request), name, email, photos and device ids. `DIGEST_FIELDS` lists every field; it is tied to the consent version (see "Consent and withdrawing").

The person can see what would be sent (`previewDigest`, "Lihat data yang dikirim"). The conversation (last 12 turns, 2,000 characters each) and, for the answer, the tool results are sent as well.

### Tools

Eight tools, defined once in a neutral schema (`tools.ts`, `TOOL_SPECS`) and translated per provider by the adapters. All run on the phone and are read-only; the model decides when to call one, and the prompt tells it to call only when the digest does not answer.

| Tool | Returns |
| --- | --- |
| `get_daily` | the daily values above for `from` to `to` (at most 90 days; a longer range is cut to the newest 90 and says so), the fields asked for; food and weight need JoyoRogo, food only for the last 14 days |
| `get_trend` | mean, min, max, last, the previous period's mean and the change, over the last 7 to 90 days (food metrics 7 days), computed in code so the model does no arithmetic |
| `get_sleep_night` | one night (the one that ended on the date): onset, wake, asleep and awake minutes, stage minutes or `none`, awakenings, overnight HRV, resting heart rate, score |
| `list_workouts` | workouts between two dates (range at most 90 days), newest first, at most 30, optional sport filter |
| `get_workout` | one workout by id: average and maximum heart rate, calories, pace, elevation gain, training effect and load, recovery hours, minutes per heart-rate zone, strain, up to 25 km splits, lap count. No GPS, no per-second series |
| `get_nutrition` | JoyoRogo food totals per day (kcal, protein, carbs, fat, meals), at most 14 days; `not_connected` when signed out |
| `get_plan` | goal, level, week, this week's progress, the next four sessions |
| `propose_note` | nothing is saved: it returns text for a confirm chip |

Limits (`TOOL_LIMITS`, `ANSWER_LIMITS`, `adapters/http.ts`):

| Limit | Value |
| --- | --- |
| Tool rounds per answer | 6 (then the model is asked to answer without tools) |
| Tool calls per round | 4 |
| Days per range | 90 (food 14) |
| Rows per result | 200 daily rows, 30 workouts |
| Result size | 6,000 characters: list rows are dropped from the old end, anything that still does not fit becomes `{"error":"result too large, ask for a shorter range"}` |
| One provider call | Streamed: 60 s to the first byte, then 25 s of silence, 180 s in total. Not streamed: 90 s. Listing models 15 s. No answer in time is `timeout`. The tools themselves have no timeout of their own |
| Answer length | 800 output tokens, and 1,800 characters after cleaning |
| Daily call ceiling | 40 by default (5 to 200), counted on the phone for chat and insights; every round counts, and a provider that answered with an error counts too |

A bad argument or a data source that fails never throws: the model gets `{"error": "..."}` and can adjust, and the round limit bounds the loop. The screen shows what an answer read as collapsible steps (see "The chat"): the tool name and plain arguments, never values (`ToolTrace`), and how each step went (`ToolSummary`: rows found, nothing, failed, not signed in).

### Memory notes

"Catatan coach" (`memory.ts`): short facts the person wants the model to remember (an injury, a goal, a preference). At most **20 notes of 200 characters**, flattened, duplicates ignored, kept on the phone (`joyofit.ai.notes`) and sent with every request as `notes` in the digest. A note is saved **only when the person taps**: `propose_note` returns a suggestion, the screen shows it as a chip, and nothing is stored before the tap. A note that reads as an injury or a symptom switches the stricter prompt block on for every question (below). Notes are data for the model, never instructions.

### Safety pass

Ported from JoyoRogo's `packages/api/src/lib/coach-chat.ts` so both engines treat a worrying message the same way (`safety.ts`). Order in `answer()` is fixed:

1. The gate (under 18, no provider, bad URL, no key, no consent): nothing is sent.
2. The keyword pass over the last user message. A message about injury, a symptom, medication or an eating disorder gets a **fixed, localized answer and no provider call**: no tokens, no cost, the disclaimer line included (`ai:safe.*`, `ai:disclaimerLine`).
3. The local daily ceiling.
4. The digest and system prompt, then at most 6 rounds of provider call and tool runs.
5. The reply is cleaned (reasoning tags, code fences, headings and bold removed, capped), a reply that repeats the rules (the canary `JFC-RULES-7Q4` or the rules' first line) is replaced with `ai:refuseLeak`, and the disclaimer line is added **in code** when the exchange is medical-ish, whatever the model wrote.

The shared test messages and expected answers are in `src/features/ai/safety.fixtures.json`; JoyoRogo's `coach-chat.test.ts` does not read that file today, so the two copies are kept equal by copying, **[NOT VERIFIED]** that they still match after the next change on either side. Earlier user messages and notes that mention a problem switch on a stricter prompt block; pregnancy or breastfeeding **said in the chat** switches on the conservative block (the JoyoRogo profile mode is deliberately not read, so it cannot reach the prompt); an unknown age switches on the no-dieting block. The keyword pass is Indonesian and English only and a paraphrase can slip past it, so the prompt rules and the disclaimer stay as the second line. The `minorDiet` answer exists for parity with the hosted engine; a known under-18 never reaches it because the gate comes first.

### Who may use it

`byokAccess` (`access.ts`) is the one gate in front of every chat and insight call, in this order: `minor`, `noProvider`, `badUrl`, `noKey`, `noConsent`. A known age under 18 turns the own-key engine off whatever else is set (`MIN_ADULT_AGE = 18`). Age is the lowest the phone's profile and the cached JoyoRogo profile give, so one source saying under 18 is enough, and it is checked on every call, so adding a birth year later switches it off. Age is this year minus the birth year, as JoyoRogo counts it, so someone in the year they turn 18 counts as 18 from 1 January. **Unknown age is allowed**: the consent includes "I am 18 or older" (`adult: true`), and the prompt then uses the conservative no-dieting block. The key test (`testProvider`) does not go through the gate because it sends no health data.

### The chat

Code: `src/features/ai/ui/` (screen `JoyoAiChat.tsx`, route `/joyo/chat`; history `ChatsScreen.tsx`, route `/joyo/chats`, both in their own `src/app/joyo` stack with the history at the bottom so Back from the chat shows the history first), logic in `conversations.ts`, `answer.ts` and `ui/chatState.ts` (pure, tested). Both engines use the same screens: the own-key engine streams, the hosted engine (`coachChat`) answers in one piece behind a "writing" line.

- **Streaming.** `adapters/http.ts` `postStream` sends `stream: true` and reads server-sent events (`adapters/sse.ts`, an incremental parser: split chunks, CRLF, comments, several `data:` lines) with the global `fetch`. In Expo SDK 57 that is `expo/fetch` (the winter runtime installs it), whose `response.body` is a `ReadableStream`: no native module is added, so this ships over the air. [NOT VERIFIED on a device.] The idle limit is 25 s per chunk (restarts with every chunk), 180 s in total. If the runtime has no readable body or `TextDecoder`, or the server refuses `stream` with 400 or 422, the adapter answers without streaming and hands the whole text over in one piece. OpenAI-style requests add `stream_options.include_usage` only for OpenAI, OpenRouter and Gemini (a custom server may reject it), so a custom server's token count can read 0. Anthropic streams `message_start`, `content_block_*`, `message_delta`; `ping` is ignored and an `error` event becomes a typed error.
- **Speed (measured on the owner's phone, GLM flash through a custom endpoint, 2026-10-22).** Timing marks (`timing.ts`, logcat tag ReactNativeJS, lines `[joyoai] ask +<ms> <mark>`, numbers only, never content or the key) show where a question spends its time: reading the diary and database for the digest (`gather-*`: was 2.7 s, now about 1 s because the days are read in parallel and the diary is cached for the session, and warmed when the chat opens), the wait for the provider's first byte (`r1-headers`, 6 to 7 s: the model reads about 3,000 tokens and starts thinking), thinking and writing (10 to 16 s), and tool rounds (`tools-done`, about 0.1 s: they run in parallel on the phone). A question that needs tools makes two provider calls and takes about twice as long. The provider is the bottleneck; the app's levers are fewer input tokens (older answers in the history are cut to 500 characters), at most 4 tool rounds, and **Fast answers** (Settings, Joyo AI; on by default, the person can switch it off): it sends `reasoning_effort: low` to a custom endpoint and `reasoning.effort: low` to OpenRouter (OpenAI, Anthropic and Gemini are left alone). On the owner's GLM endpoint this cut the model's thinking from about 3,400 to 170 characters and a one-call answer from 23 to 38 s down to 15 s; `thinking: {type: disabled}` was accepted there and ignored, so it is not the default. A server that wants other fields can be given them as JSON in the same screen (`fastFields`, replaces the built-in ones; `model`, `messages`, `stream`, `tools` and the token limits are refused). A server that answers 400 is asked again without it (`refused` mark, remembered until restart). A 400 cannot say which field it disliked, so the extras are dropped in order and learned only from a call that succeeded afterwards.
- **Thinking models.** Reasoning arrives as `reasoning_content` (GLM, DeepSeek, Qwen, Kimi), `reasoning` or `reasoning_details` (OpenRouter, LM Studio), content parts of type `thinking`, inline `<think>` tags (split even when a tag is cut between chunks) or Anthropic thinking blocks. It is kept apart from the answer (`ModelReply.thinking`), shown collapsed as "Berpikir" and never sent back, except that the reasoning of a tool round goes back with that assistant turn, as DeepSeek and GLM thinking modes ask. Reasoning counts against the output limit, so OpenAI-style calls send the 800-token answer budget plus 2,400 (`OPENAI_HEADROOM`; Anthropic plus 1,200). A model that still spends everything thinking ends with `finish_reason=length` and no text: that is the `truncated` error, retried once with a 2,400 budget (counts as a call); a second failure shows "Lihat detail teknis" with the stop word, HTTP status and character counts (never the key). The first owner report of "The model did not send a usable answer" was exactly this (GLM, 3,801 tokens used, empty content).
- **Steps.** `answer()` emits `AnswerEvent`s (`round`, `text`, `reasoning`, `toolStart`, `toolDone`). The text of a round that ended in tool calls is a preamble and is cleared on the next `round`. Steps are saved with the message (`StepRecord`).
- **Conversations.** Several chats with titles (`ChatStore`: index plus one entry per chat, at most 30 chats of 80 messages, 8,000 characters a message). The title is the first question. The chat the person had open last opens again; "Baru" starts an empty one that is created on the first send. Edit-and-resend and regenerate use `truncateFrom`. The single chat of the earlier version is moved into the first conversation on first read. Stored on the phone only, never synced; removed by "Hapus catatan dan percakapan", by delete-all and by "Hapus dari HP ini". The stored text also holds the model's reasoning (capped at 2,000 characters).
- **Rendering.** Assistant text is rendered as markdown (`markdown/parse.ts` is a total, linear parser tolerant of half-written input; `ui/Markdown.tsx` renders it): headings, lists, bold, italic, inline and fenced code, quotes, compact tables, links (http, https and mailto only; images are not rendered). The user's own text stays plain.
- **Controls.** Stop (a stopped answer keeps what arrived, cleaned and with the disclaimer rule, marked "Dihentikan"; the hosted request cannot be cancelled on the wire, so Stop only stops waiting), Copy, Regenerate (last answer), Edit (last question), "Ke terbaru" when scrolled up, a composer that stays above the keyboard and the gesture bar (the safe-area padding is in `Screen`'s footer).
- **Shortcuts.** The Today and Workouts headers have a "Tanya Joyo AI" button; the workout detail and the sleep screen have "Tanya soal latihan ini" / "Tanya soal tidur ini", which open a new chat whose composer is filled with a question that names the workout (`w:<start>`) or the night's date, so the model reads it with `get_workout` / `get_sleep_night`. Nothing is sent until the person taps send. Without a ready engine the shortcuts open the setup (`open.ts`, `joyoAiDestination`, tested). More has a "Coach & AI" group (Coach, and Joyo AI, which opens the chat); the AI settings are one tap from the chat's engine chip.

### Consent and withdrawing

- Consent is per provider **and endpoint host** (`ConsentRecord`: version, time, host, `adult`). A custom URL on another host is a different recipient and asks again.
- The consent screen lists the data categories (`CONSENT_CATEGORIES`, `ai:consent.data.<id>`): body, sleep, recovery, heart, workouts, plan, food, notes, chat. `CONSENT_VERSION` (2; version 2 dropped pregnancy and breastfeeding mode from the data, so version-1 consents are asked again) is pinned to `DIGEST_FIELDS` by a hash (`CONSENT_FIELDS_HASH`, `consentMatchesFields`): changing a digest field without a new version fails the test in `digest.test.ts`, and a new version asks everyone again (`noConsent`). Add the hash of the new list when raising the version.
- Gemini: the setup screen warns that Google's free tier uses what it receives to improve its products (`freeTierTrainsOnData`). That line comes from the owner brief and is **[NOT VERIFIED]** by us against Google's current terms.
- Withdrawing (`removeProvider`, "Hapus kunci"): deletes the key, removes the consent, clears the cached insights, and when it was the provider in use sets `provider` to none, the engine back to hosted and both insight switches off. Notes and the saved conversation stay (they have their own delete, `deleteMemory`).
- `deleteMemory` ("Hapus catatan dan percakapan"): notes, every saved conversation (`joyofit.ai.chats`, `joyofit.ai.chat.<id>`, and the earlier single chat `joyofit.coach.chat` if it was never moved) and cached insights; it leaves the key and the cached JoyoRogo profile (`joyofit.ai.person`: birth year, sex, height, goal, targets), because the age gate needs the profile. `deleteEverything` (`aiDeleteEverything`): every key, consent and setting, the memory, the usage counters and the cached profile. "Hapus dari HP ini" (`deleteAllLocalData`, `src/db/localData.ts`) calls `aiDeleteEverything` first, so it removes all of that too. Signing out alone deletes none of it; it only drops the cached profile at the next read while signed out.
- What the person is told: `site/src/Privasi.tsx` section `#joyo-ai`, and JoyoRogo's `/privasi` (`#coach-joyofit`).

### Insights (optional)

A short text on Today (`insight.ts`, `todaysInsight`): one **daily** summary and one **Monday weekly** review. **Both are off by default** (`insightDaily`, `insightWeekly`). With both on, Monday shows the weekly one. Withdrawing the provider in use switches both off.

- The app computes a facts list (`dailyFacts`, `weeklyFacts`: readiness, last night's sleep, sleep debt, HRV, resting heart rate, strain, load, recovery; the week against the week before). **Only that list goes to the model**, not the digest, notes or conversation. A missing value is left out, never zero.
- The model is told to use only numbers in the facts, copied exactly, no diagnosis, no markdown, no emoji. The reply is checked before it is shown (`validateInsight`): no number that is not in the facts (or the date), no emoji or markdown, no medical wording (the same keyword pass as the chat), at most 420 characters (daily) or 760 (weekly). A reply that fails gets one retry with a stricter prompt; failing twice, or a provider error, shows **nothing** and the card keeps the rules-based suggestion, and no new attempt is made for 30 minutes (`RETRY_AFTER_SEC`).
- A text is cached per day (daily) or per Monday (weekly) and per language, so at most one of each is generated. It goes through the same gate, consent and call ceiling as the chat. For an unknown age the prompt says to only describe, no advice about intensity or weight.

### Errors

Provider failures become an `AiError` (`types.ts`) and the screen words each one with a cause and a next step (`ai:errors.<kind>`). The HTTP status decides first, then the provider's own words (`kindForStatus`):

| Kind | Cause |
| --- | --- |
| `badKey` | 401, or 400 or 422 that talks about the API key |
| `quota` | 402, or 403, 429, 400 or 422 with words like insufficient quota, credit balance, billing |
| `forbidden` | 403 otherwise |
| `rateLimit` | 429 otherwise |
| `modelNotFound` | 404, or 400 or 422 saying the model does not exist |
| `noTools` | 404, 400 or 422 saying the model does not support tools: the app retries once from the digest alone and remembers the model |
| `timeout` | 408, 504, or no answer in time (see the limits above) |
| `server` | 500 and above (including 529), or an answer that is not JSON |
| `network` | the connection failed |
| `badRequest` | any other 4xx |
| `empty` | the reply is empty after cleaning |
| `aborted` | the person left or cancelled |
| `blocked` | not allowed to call, nothing was sent; `detail` is the gate reason (`minor`, `noProvider`, `badUrl`, `noKey`, `noConsent`), `noKey` or `ceiling` |

### Adding a provider or a tool

- **Provider** that speaks OpenAI chat completions: add an entry to `PROVIDERS` and `PROVIDER_ORDER`, add its id to `PROVIDER_IDS` (`types.ts`), set its token field and reasoning quirks, `freeTierTrainsOnData` if its free tier trains, then the `ai:` strings, a consent line if its host needs wording, and a request-mapping test in `adapters.test.ts`. Another wire format needs a third adapter and an `AdapterKind`. Check the provider's terms and age limit before listing it, and put its key page in `keyUrl`.
- **Tool**: add the name to `TOOL_NAMES`, its schema to `TOOL_SPECS`, a `case` in `dispatch` (range via `rangeArgs`, output through `cap`, free text through `flat`), and a data method on `ToolData` bound in `data/assemble.ts`. A tool stays read-only and on the phone. If it can return a new kind of data, that data must be in a consent category and `CONSENT_VERSION` must go up. Add its limit to the table above.
- **Digest field**: add it to `DigestSource`, `buildDigest` and `DIGEST_FIELDS`, raise `CONSENT_VERSION` and add the new hash. Never add cycle data, Strava data, GPS or anything that names the person.

### Not in this version

- OpenRouter sign-in with PKCE (no key to paste): needs an HTTPS callback page we do not run yet. OpenRouter works with a pasted key like the others.
- Writes of any kind from the model (it cannot log food, edit a plan or save a note by itself), push notifications from the AI, voice, images.
- The hosted engine running on the same core (it still uses JoyoRogo's `coach.chat`).
- Syncing notes, conversation or settings between phones: they are per phone on purpose (`docs/multi-device.md`).

### Not verified

- What each provider keeps or trains on, and their age limits. Our texts do not say any provider "does not store" data; the provider's own terms apply once the data reaches it.
- The Gemini free-tier wording (above) and the default model ids (above).
- Android handling of SecureStore in backups (above).
- Apple and Google Play review of the consent wording (Apple 5.1.2(i), Play's AI user-data rules): not submitted yet, outcome unknown.
- That JoyoRogo's `coach-chat.ts` and `safety.fixtures.json` still agree (above).
- Behaviour with a real key on a real device: the adapters and the loop are tested against fakes only.

### Tests

Run `bun test src/features/ai` (the repo's test runner; the wipe in `src/db/localData.ts` is not covered by a Joyo AI test). Files: `adapters.test.ts` (request and response mapping for both adapters, error kinds, the key is not kept from an echoing provider, timeout, network and abort), `digest.test.ts` (size cap and trimming order, no cycle fields, every output key is a declared field, missing is null, flattening, no name, email or GPS, and the consent version pinned to the field list), `tools.test.ts` (eight read-only tools, range, food and result limits, trend arithmetic, `propose_note`, error objects), `safety.test.ts` (the shared fixtures, prompt blocks, reply cleaning, disclaimer), `access.test.ts` (the gate: consent per provider, version and host, under 18 closed, unknown age allowed, URL rules, settings defaults), `answer.test.ts` (no provider call when blocked or flagged, tool loop and its limits, `noTools` fallback, ceiling, conversation cut, the key never in the prompt), `keys.test.ts` (key only in the secure store, `joyofit.ai.` namespace, masking, "Hapus kunci", "Hapus catatan dan percakapan", delete everything, notes limits, usage counters), `insight.test.ts` (slots, facts, number validator, one stricter retry, cool-down, cache per language), `models.test.ts` (model choice and search). Added with the chat: `streaming.test.ts` (SSE parser, OpenAI-style and Anthropic streams with odd chunk splits, tool calls from deltas, fallbacks, timeout and abort), `variants.test.ts` (recorded answer shapes: GLM, DeepSeek, Qwen, Ollama, OpenRouter, Gemini), `conversations.test.ts`, `open.test.ts`, `markdown/parse.test.ts`, `ui/chatState.test.ts`.

## Not medical advice

The suggestion, the plans and the chat are general training guidance. Every Coach screen shows the disclaimer line (`coach:disclaimer`). Both chat engines send injury, symptom, medication and eating-disorder messages to the "see a professional" answer without calling the model, and are conservative in Hamil mode (hosted engine only); the own-key engine's version of this is described under "Joyo AI (own key)", "Safety pass".

## Native / next store build

Everything above is JS. Tables (`coach_doc`) are created from JS like the gear tables; fold them into `joyofit-db-migrations.json` at the next native build.
