# Third-party brand marks

Where JoyoFit draws another company's mark, the rules it follows, and where it deliberately draws none. One component,
`src/components/BrandMark.tsx`, draws every mark (rows of the Settings hub, section headers of the Strava, Health Connect
and Apple Health screens); `src/components/brandRules.ts` holds the per-platform rule and is unit tested.

| Brand | What the app shows | Where | Rules followed |
|---|---|---|---|
| Strava | Official **Connect with Strava** button (`assets/strava/connect-with-strava*.png`) and **Compatible with Strava** logo (`compatible-with-strava.png`), unmodified. `powered-by-strava.png` is in the repo for a "reads Strava data" feature; JoyoFit only uploads, so it uses "Compatible". | Settings → Strava | <https://developers.strava.com/guidelines/>: use unmodified, the button links to Strava's authorize page, button 48 dp high, never animate or alter, the logo is smaller than our own name and does not suggest sponsorship, the app name does not contain "Strava". |
| Strava (row tile) | The Strava symbol, white on #FC5200 in a rounded square, drawn with `react-native-svg` from the public path of the symbol. | Hub row, Strava section header | **Judgement call.** Strava's API kit ships only wordmark lockups, no stand-alone symbol. The tile is a factual reference to the feature next to the word "Strava", never an app icon. If Strava objects, replace the tile with the plain word. |
| Google Health Connect | Official icon (`assets/brand-marks/health-connect.png`), unmodified, with the name next to it. | **Android only** (`brandAllowed`) | Health Connect UI guidelines on developer.android.com: icon unmodified, product name beside it. |
| Apple Health | Apple-provided icon (`assets/brand-marks/apple-health.png`, from Apple Design Resources), unmasked, square, not inside a chip, with the words "Apple Health" next to it. | **iOS builds only** (`brandAllowed`); never Android or web | Apple HIG for HealthKit and the HealthKit developer artwork licence: only in the UI of an app running on iOS, only to show that the app uses HealthKit, no circle mask, border, shadow or overlay, not used as a button, the words "Apple Health" beside it, clear space of one tenth of its height, **no redistribution**. |
| Claude, ChatGPT | None. Text only ("Claude, ChatGPT and other AI apps"). | Settings → AI connections | The marks belong to Anthropic and OpenAI and are for their own services and partners. The screen is a generic MCP connector, so it keeps a neutral sparkles icon. |
| Huawei, Honor | None. Android: names only, nominatively. iOS: not even the names (App Store guideline 4.1(b), two rejections; `docs/app-store.md`): the iOS string overlay and `shownName()` (`docs/i18n.md`, "iOS overlay"). | Android app; nowhere on iOS | See `LEGAL.md` and `NOTICE`: JoyoFit is unofficial and has no Huawei or Honor logo. |

Share stickers (`src/features/stickers/`) draw only JoyoFit's own mark and name. No sticker carries a Strava, Apple Health or Health Connect mark: JoyoFit shows no Strava data, and the Apple and Google artwork is allowed only in the app UI (see `docs/sticker-studio.md`).

## Apple Health icon in a public repository: owner decision

JoyoFit is AGPL-3.0-or-later and its repository is public or may become so. The Apple artwork licence allows the icon in
the UI of an app running on iOS and forbids redistributing it otherwise, which a public Git repository arguably does. The
AGPL does **not** cover this file; it stays under Apple's terms.

`assets/brand-marks/apple-health.png` is kept in the repo for now because the iOS build bundles it. Whether to keep it in
a public repository (for example by fetching it from Apple Design Resources at build time and git-ignoring it, or by
dropping the iOS row mark) is the owner's call; nothing here decides it.

## Adding a mark

1. Take the artwork from the brand's own kit, never a redraw or an icon-font look-alike.
2. Add its platform rule to `brandAllowed` and a test.
3. Always show the brand name next to it (row title or section title).
4. Add a row to the table above.
