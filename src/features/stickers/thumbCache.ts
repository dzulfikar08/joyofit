/**
 * Picker thumbnails are cheap by construction: a Scene is built once per template + data + photo + look and kept here, so a
 * thumbnail that scrolls out and back, or a re-render of the sheet, never rebuilds it. Pure, so it is unit tested.
 */

/** A small stable hash (djb2) of a string: cache keys must not hold a route's thousand points. */
export function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export interface ThumbKeyParts {
  templateId: string;
  /** `hashText` of the subject's data: computed once per subject, not per thumbnail. */
  dataHash: string;
  date: string | number | undefined;
  photoUri: string | null;
  locale: string;
  mode: string;
  options: unknown;
}

export function thumbKey(p: ThumbKeyParts): string {
  return [p.templateId, p.dataHash, p.date ?? '', p.photoUri ?? '', p.locale, p.mode, JSON.stringify(p.options)].join('|');
}

/** Least-recently-used map with a size cap. */
export class LruCache<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  /** The cached value, built with `make` on a miss. */
  getOrCreate(key: string, make: () => V): V {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const made = make();
    this.set(key, made);
    return made;
  }

  get size(): number {
    return this.map.size;
  }
}
