/**
 * Which templates the sheet offers for a subject, and how they group: a style (`run.bold`) comes in a Story and a Square
 * version, a transparent sticker in one. Pure, so the decisions are unit tested without a phone.
 */
import { isMissing, lookupPath } from './core/expr';
import type { Template } from './core/schema';
import { TEMPLATES } from './catalog';
import type { StickerKind, StickerSubject } from './subject';

/** The canvas a template id ends with. */
export type Canvas = 'story' | 'square' | 'portrait' | 'sticker';

export function canvasOf(template: Pick<Template, 'canvas'>): Canvas {
  const { aspect } = template.canvas;
  return aspect === 'story' ? 'story' : aspect === 'square' ? 'square' : aspect === 'portrait' ? 'portrait' : 'sticker';
}

/** One picker entry: the versions of a style. */
export interface TemplateGroup {
  /** `<kind>.<name>`: the id without its canvas. */
  key: string;
  kind: StickerKind;
  name: string;
  style: string;
  titleKey: string;
  variants: Partial<Record<Canvas, Template>>;
  /** Transparent PNG sticker. */
  transparent: boolean;
  /** Draws the person's photo: share stays off until one is chosen. */
  needsPhoto: boolean;
}

/** Every `requires` path of the template resolves in the subject's data (a photo is not data: it is chosen in the sheet). */
export function isOffered(template: Template, subject: Pick<StickerSubject, 'data'>): boolean {
  return (template.requires ?? []).every((path) => !isMissing(lookupPath(subject.data, path)));
}

/** The groups for a subject: the kinds in the subject's order, then catalog order. */
export function offerGroups(subject: StickerSubject, templates: readonly Template[] = TEMPLATES): TemplateGroup[] {
  const groups = new Map<string, TemplateGroup>();
  for (const kind of subject.kinds) {
    for (const template of templates) {
      if (template.kind !== kind || !isOffered(template, subject)) continue;
      const canvas = canvasOf(template);
      const key = template.id.slice(0, template.id.length - canvas.length - 1);
      const existing = groups.get(key);
      if (existing) {
        existing.variants[canvas] = template;
        continue;
      }
      groups.set(key, {
        key,
        kind,
        name: key.slice(kind.length + 1),
        style: template.style,
        titleKey: template.titleKey ?? `stickers:tpl.${key}`,
        variants: { [canvas]: template },
        transparent: template.meta?.transparent === true,
        needsPhoto: template.meta?.needsPhoto === true,
      });
    }
  }
  return [...groups.values()];
}

/**
 * The group the sheet opens on: the subject's `defaultGroup` (the card that fits the sport, `data/sportMetrics.ts`) when the
 * groups hold it, else the first group; null without groups.
 */
export function initialGroup(groups: readonly TemplateGroup[], subject: Pick<StickerSubject, 'defaultGroup'>): TemplateGroup | null {
  return groups.find((g) => g.key === subject.defaultGroup) ?? groups[0] ?? null;
}

/** The template of a group for the wanted canvas; a style that only has the other canvas keeps its own. */
export function pickVariant(group: TemplateGroup, wanted: Exclude<Canvas, 'sticker' | 'portrait'>): Template {
  const variant = group.variants[wanted] ?? group.variants.story ?? group.variants.square ?? group.variants.portrait ?? group.variants.sticker;
  if (!variant) throw new Error(`template group ${group.key} has no variant`);
  return variant;
}

/** Whether the Story / Square switch means something for this group. */
export function hasCanvasChoice(group: TemplateGroup): boolean {
  return group.variants.story !== undefined && group.variants.square !== undefined;
}

/** The picker sections, in display order. */
export type OfferSection = 'photo' | 'overlay' | 'card' | 'badge' | 'yours';

export const OFFER_SECTIONS: readonly OfferSection[] = ['photo', 'overlay', 'card', 'badge', 'yours'];

/** The section a group sits in: the person's own templates (`u-` ids) first, then by what it draws. */
export function sectionOf(group: TemplateGroup): OfferSection {
  if (Object.values(group.variants).some((t) => t.id.startsWith('u-'))) return 'yours';
  if (group.needsPhoto) return 'photo';
  if (group.kind === 'badge') return 'badge';
  if (group.transparent) return 'overlay';
  return 'card';
}

export interface OfferSectionGroups {
  section: OfferSection;
  groups: TemplateGroup[];
}

/** Groups split into non-empty sections in display order; every group lands in exactly one, so a new catalog entry shows up by itself. */
export function sectionGroups(groups: readonly TemplateGroup[]): OfferSectionGroups[] {
  return OFFER_SECTIONS.map((section) => ({ section, groups: groups.filter((g) => sectionOf(g) === section) })).filter((s) => s.groups.length > 0);
}
