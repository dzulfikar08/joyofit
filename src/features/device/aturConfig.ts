/**
 * Where "Kirim laporan" files watch reports: the public feedback board of a project in Atur (`docs/atur-reports.md`).
 *
 * The board token is a write-only key by design: it can create reports and upload report files for that one board,
 * nothing else, and it is meant to ship inside apps. It lives in this file, not in `app.json` `extra`, because any
 * change to `app.json` changes the runtime version and strands installed apps (`docs/ota.md`); a JS-only edit here
 * reaches them over the air. Empty = no board yet: the button is hidden and only the GitHub and share options show.
 *
 * `EXPO_PUBLIC_ATUR_FEEDBACK_URL` / `EXPO_PUBLIC_ATUR_FEEDBACK_TOKEN` override both for a local Atur.
 */
const PUBLISHED_ATUR_FEEDBACK_TOKEN = 'pk_fb_2983d56c815b44b39f5197c87a356dfd';

export const ATUR_FEEDBACK_URL = (process.env.EXPO_PUBLIC_ATUR_FEEDBACK_URL || 'https://app.diatur.com').trim().replace(/\/+$/, '');
export const ATUR_FEEDBACK_TOKEN = (process.env.EXPO_PUBLIC_ATUR_FEEDBACK_TOKEN || PUBLISHED_ATUR_FEEDBACK_TOKEN).trim();
export const ATUR_REPORTS_ENABLED = ATUR_FEEDBACK_TOKEN !== '';
