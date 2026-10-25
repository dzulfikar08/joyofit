/**
 * Blocks several templates share: the sport glyph, the watermark footer and the stat cells. They only compose kit layers,
 * so a template that needs something different simply does not call them.
 */
import type { Kit, LayerJson, StatOpts } from './dsl';
import { FAMILY_GLYPHS } from './glyphs';

/** Condition helpers for `when`. */
export const has = (bind: string) => ({ bind, exists: true });
export const lacks = (bind: string) => ({ bind, exists: false });
export const is = (bind: string, eq: unknown) => ({ bind, eq });
export const all = (...conds: Record<string, unknown>[]) => ({ all: conds });
export const any = (...conds: Record<string, unknown>[]) => ({ any: conds });
export const not = (cond: Record<string, unknown>) => ({ not: cond });

/** `{ t: 'stickers:label.time' }`. */
export const tl = (key: string, args?: Record<string, string>) => ({ t: `stickers:${key}`, ...(args ? { args } : {}) });

/** Sport families drawn by their own pictogram rather than by `run.kind` (which reads `other` for all of them). */
const FAMILY_ICONS: readonly [family: string, glyph: { icon: string } | { path: string }][] = [
  ['gym', { icon: 'strength' }],
  ['cardio', { path: FAMILY_GLYPHS.cardio }],
  ['flow', { path: FAMILY_GLYPHS.flow }],
  ['court', { path: FAMILY_GLYPHS.court }],
];

/**
 * The glyph of a workout: the family's pictogram for a gym, cardio, flow or court session (`run.category`), else the glyph of
 * `run.kind`. One layer per glyph stacked in one box, exactly one passes its `when`.
 */
export function sportGlyph(k: Kit, x: number, y: number, size: number, color: string, bind = 'run.kind'): LayerJson[] {
  const family = bind.replace(/kind$/, 'category');
  const families = FAMILY_ICONS.map(([name]) => name);
  const plain = not({ bind: family, in: families });
  const kinds: [string, string][] = [
    ['run', 'run'],
    ['walk', 'walk'],
    ['ride', 'bike'],
    ['swim', 'swim'],
  ];
  const layers = kinds.map(([kind, icon]) => k.icon({ x, y, w: size, h: size }, icon, color, { when: all(plain, is(bind, kind)) }));
  layers.push(k.icon({ x, y, w: size, h: size }, 'fitness', color, { when: all(plain, not({ bind, in: kinds.map(([kind]) => kind) })) }));
  for (const [name, glyph] of FAMILY_ICONS) {
    const when = is(family, name);
    layers.push(
      'icon' in glyph
        ? k.icon({ x, y, w: size, h: size }, glyph.icon, color, { when })
        : k.shape({ x, y, w: size, h: size }, 'path', { d: glyph.path, viewBox: [24, 24], fill: color }, { when }),
    );
  }
  return layers;
}

/**
 * The footer of a card: brand lockup left, link right-aligned, in one row. Both are watermark layers, so they vanish when the
 * person turns the watermark off (Pro) and the rest of the card does not move. Returns one layer, placed at `x`, `y`.
 */
export function footer(k: Kit, x: number, y: number, w: number, h = 56): LayerJson[] {
  return [
    k.group({ x, y, w, h }, [k.brand({ w: 'auto', h }, 'lockup', { size: h }), k.shape({ w: 'fill', h: 1 }, 'rect'), k.brand({ w: 'auto', h: 'auto' }, 'link', { size: Math.max(26, Math.round(h * 0.5)) })], {
      dir: 'row',
      gap: 24,
      align: 'center',
    }),
  ];
}

/** A row of equal stat cells; a cell whose value is missing is removed and the others share the width. */
export function statRow(
  k: Kit,
  cells: { value: string; label: string | { t: string }; unit?: string | { t: string }; when?: Record<string, unknown> }[],
  o: { size: number; labelSize: number; color?: string; labelColor?: string; labelPos?: StatOpts['labelPos']; align?: StatOpts['align']; unitSize?: number; weight?: number },
): LayerJson[] {
  return cells.map((cell) =>
    k.stat({ w: 'fill', h: 'auto' }, cell.value, {
      unit: cell.unit,
      label: cell.label,
      size: o.size,
      labelSize: o.labelSize,
      color: o.color,
      labelColor: o.labelColor,
      labelPos: o.labelPos ?? 'above',
      align: o.align,
      unitSize: o.unitSize,
      weight: o.weight,
      minSize: 40,
      when: cell.when,
    }),
  );
}
