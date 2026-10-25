/**
 * What a screen hands the sticker sheet: the numbers of one workout, night, day or week as plain JSON, and which template
 * families can draw them. Builders live in `./data`; they never format numbers (the templates do, with the locale of the
 * moment) but they do resolve text that comes from i18n or from the user (sport names, exercise names, PR labels).
 */

/**
 * Template families (`Template.kind`). A subject may offer several, e.g. a run that set a record also offers `badge`. `threads` is the
 * Threads carousel: its slides are never offered by the sticker sheet (no regular subject lists the kind), only by `ThreadsSheet`.
 * `walk` ... `court` are the sport families of a watch workout (`data/sportMetrics.ts`): they read the same `run.*` data as the
 * `run` cards, laid out around the numbers that sport has.
 */
export const STICKER_KINDS = ['run', 'walk', 'ride', 'swim', 'gym', 'cardio', 'flow', 'court', 'strength', 'sleep', 'ready', 'load', 'week', 'plan', 'watch', 'badge', 'threads'] as const;
export type StickerKind = (typeof STICKER_KINDS)[number];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface StickerSubject {
  /** Stable per subject (`run:1700000000`), used to key per-subject UI state. */
  id: string;
  /** Template families offered for this subject, most relevant first. */
  kinds: readonly StickerKind[];
  /** The template group (`<kind>.<name>`) the sheet opens on; without one, or when it is not offered, the first group. */
  defaultGroup?: string;
  /** Header of the sheet ("Bagikan latihan"). */
  heading: string;
  /** Text that travels with the image in the system share sheet. */
  caption: string;
  /** Epoch ms of the subject: the sticker's `date`. */
  date: number;
  /**
   * The binding root (`StickerData.data`): one object per namespace, `{ run: {...}, milestone: {...} }`. A key that is
   * absent, `null` or `NaN` makes the layers bound to it disappear, so builders leave out what the subject does not have.
   */
  data: JsonObject;
}
