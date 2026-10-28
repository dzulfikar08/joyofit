import type { Locale } from './locale';
import type { Namespace, Resources } from './resources';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> };

/**
 * Strings one platform shows instead of the base ones: per locale and namespace, only the leaves that differ, nested like the
 * base JSON. The iOS overlay keeps third-party watch brands out of the iOS app (App Store guideline 4.1(b), docs/app-store.md).
 */
export type Overlay = { [L in Locale]: { [N in Namespace]?: DeepPartial<Resources[N]> } };

type Tree = { [key: string]: string | Tree };

function merge(base: Tree, patch: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] = typeof value === 'object' && typeof current === 'object' ? merge(current, value) : value;
  }
  return out;
}

/** The resources with the overlay's leaves written over them. Returns new objects: the imported base JSON stays untouched. */
export function applyOverlay<R extends Record<Locale, Resources>>(resources: R, overlay: Overlay | null): R {
  if (!overlay) return resources;
  const out = { ...resources };
  for (const locale of Object.keys(overlay) as Locale[]) {
    out[locale] = merge(resources[locale] as unknown as Tree, overlay[locale] as Tree) as unknown as Resources;
  }
  return out;
}
