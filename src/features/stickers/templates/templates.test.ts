import { describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';

import { TEMPLATES } from '../catalog';
import { lookupPath } from '../core/expr';
import { lintTemplate } from '../core/lint';
import { parseTemplate } from '../core/parse';
import { measureText } from '../core/text';
import type { Scene, SceneNode, TextNode } from '../core/scene';
import { FIT_FONTS } from '../fonts';
import { FIXTURES } from '../testing/fixtures';
import { renderTemplate } from '../testing/render';
import { STICKER_KINDS } from '../subject';
import { applyCustomMetrics } from '../data/customMetrics';
import { TEMPLATE_INPUTS } from './index';
const CANVAS_SUFFIX: Record<string, string> = { story: 'story', square: 'square', portrait: 'portrait', free: 'sticker' };

function textNodes(nodes: readonly SceneNode[]): TextNode[] {
  return nodes.flatMap((node) => (node.k === 'text' ? [node] : node.k === 'group' ? textNodes(node.children) : []));
}

/** Left and right edge of a text node, measured with the same tables the layout used. */
function extent(node: TextNode): [number, number] {
  const width = measureText(node.text, FIT_FONTS.metrics(node.font, node.weight), node.size) + (node.letterSpacing ?? 0) * node.text.length;
  if (node.anchor === 'middle') return [node.x - width / 2, node.x + width / 2];
  if (node.anchor === 'end') return [node.x - width, node.x];
  return [node.x, node.x + width];
}

function rgb(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1];
}

function luminance([r, g, b]: [number, number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast of `fg` (alpha respected) over an opaque `bg`. */
function contrast(fg: string, bg: string): number {
  const f = rgb(fg);
  const b = rgb(bg);
  const mixed: [number, number, number, number] = [f[0] * f[3] + b[0] * (1 - f[3]), f[1] * f[3] + b[1] * (1 - f[3]), f[2] * f[3] + b[2] * (1 - f[3]), 1];
  const [hi, lo] = [luminance(mixed), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** The flat color the card is painted with, when the first node is one full-canvas rect. */
function flatBackground(scene: Scene): string | null {
  const first = scene.nodes[0];
  return first?.k === 'rect' && typeof first.fill === 'string' && first.w >= scene.width && first.h >= scene.height ? first.fill : null;
}

describe('built-in templates', () => {
  test('there are templates for the main families', () => {
    expect(TEMPLATES.length).toBeGreaterThan(0);
    for (const template of TEMPLATES) expect(STICKER_KINDS as readonly string[]).toContain(template.kind);
  });

  test('every template parses with no issue and does not degrade', () => {
    for (const input of TEMPLATE_INPUTS) {
      const parsed = parseTemplate(input);
      expect({ id: input.id, degraded: parsed.degraded, issues: parsed.issues }).toEqual({ id: input.id, degraded: false, issues: [] });
    }
  });

  test('ids are unique and spell kind, name and canvas', () => {
    const seen = new Set<string>();
    for (const template of TEMPLATES) {
      expect(seen.has(template.id)).toBe(false);
      seen.add(template.id);
      const suffix = CANVAS_SUFFIX[template.canvas.aspect];
      expect(suffix).toBeDefined();
      expect(template.id.startsWith(`${template.kind}.`)).toBe(true);
      expect(template.id.endsWith(`.${suffix}`)).toBe(true);
      expect(template.titleKey).toMatch(/^stickers:(tpl\.|threads\.slide\.)/);
    }
  });

  test('lint: nothing outside the story safe area, no tiny text, no unknown filter', () => {
    for (const template of TEMPLATES) {
      const issues = lintTemplate(template).filter((issue) => issue.code !== 'missing-binding');
      expect({ id: template.id, issues }).toEqual({ id: template.id, issues: [] });
    }
  });

  test('no words in a template: text is bindings or i18n keys only', () => {
    const offenders: string[] = [];
    const visit = (layers: readonly unknown[], id: string) => {
      for (const layer of layers) {
        if (typeof layer !== 'object' || layer === null) continue;
        for (const field of ['value', 'unit', 'label']) {
          const expr = (layer as Record<string, unknown>)[field];
          if (typeof expr !== 'string') continue;
          // Units are never translated (docs/i18n.md): kg, km, m, kcal, bpm, spm, km/h.
          const literal = expr.replace(/\{\{|\}\}/g, '').replace(/\{[^}]*\}/g, '').replace(/\b(kg|km|m|kcal|bpm|spm|h)\b/g, '');
          if (/\p{L}/u.test(literal)) offenders.push(`${id}: ${expr}`);
        }
        const children = (layer as { children?: unknown }).children;
        if (Array.isArray(children)) visit(children, id);
      }
    };
    for (const input of TEMPLATE_INPUTS) visit(input.layers, input.id);
    expect(offenders).toEqual([]);
  });

  test('routes keep the privacy trim and weight is never bound', () => {
    for (const input of TEMPLATE_INPUTS) {
      const json = JSON.stringify(input);
      expect(json.includes('"trim":0')).toBe(false);
      expect(/weightKg|bodyWeight/.test(json)).toBe(false);
      // The name is bound only by the Threads carousel header, and only where the person opted in (`user.name` exists then).
      if (input.kind !== 'threads') expect(json.includes('user.name')).toBe(false);
    }
  });

  test('transparent templates say so and cards are opaque', () => {
    for (const template of TEMPLATES) {
      const fixture = FIXTURES.find((f) => f.kind === template.kind);
      if (!fixture) continue;
      const scene = renderTemplate(template, fixture.data, { locale: 'id', mode: 'dark', assets: { photo: { uri: 'fixture:photo-dusk', width: 1200, height: 1800 } } }).scene;
      expect({ id: template.id, transparent: scene.transparent }).toEqual({ id: template.id, transparent: template.meta?.transparent === true });
    }
  });

  test('every requires path exists in some fixture of the kind', () => {
    for (const template of TEMPLATES) {
      for (const path of template.requires ?? []) {
        const found = FIXTURES.some((f) => f.kind === template.kind && lookupPath(f.data, path) !== undefined);
        expect({ id: template.id, path, found }).toEqual({ id: template.id, path, found: true });
      }
    }
  });
});

describe('every template renders every fixture of its kind', () => {
  for (const locale of ['id', 'en'] as const) {
    test(`${locale}: no issues, text inside the canvas, size >= 22, contrast >= 3 on flat cards`, async () => {
      await applyLocale(locale);
      try {
        for (const template of TEMPLATES) {
          for (const fixture of FIXTURES.filter((f) => f.kind === template.kind)) {
            if (template.requires?.some((path) => lookupPath(fixture.data, path) === undefined)) continue;
            for (const mode of ['dark', 'light'] as const) {
              const where = `${template.id} / ${fixture.key} / ${mode} / ${locale}`;
              const photo = template.meta?.needsPhoto ? { photo: { uri: 'fixture:photo-dusk', width: 1200, height: 1800 } } : undefined;
              const { scene, issues } = renderTemplate(template, fixture.data, { locale, mode, assets: photo });
              expect({ where, issues }).toEqual({ where, issues: [] });
              const bg = flatBackground(scene);
              for (const node of textNodes(scene.nodes)) {
                const [left, right] = extent(node);
                expect({ where, text: node.text, inside: left >= -1 && right <= scene.width + 1 }).toEqual({ where, text: node.text, inside: true });
                expect({ where, text: node.text, size: node.size >= 22 }).toEqual({ where, text: node.text, size: true });
                if (bg && !template.meta?.transparent) {
                  const ratio = contrast(node.fill, bg);
                  expect({ where, text: node.text, ratio: ratio >= 3 }).toEqual({ where, text: node.text, ratio: true });
                }
              }
            }
          }
        }
      } finally {
        await applyLocale('id');
      }
    });
  }
});

describe('custom metrics template integration', () => {
  test('renders dynamic hero and secondary slots without degradation', async () => {
    const runFixture = FIXTURES.find((f) => f.key === 'run.full')!;
    const customRun = applyCustomMetrics(runFixture.data, {
      heroId: 'pace',
      secondaryIds: ['hr', 'cadence', 'kcal'],
    }, { locale: 'en' });

    for (const id of ['run.bold.story', 'run.photo.story', 'run.minimal.story', 'run.poster.story', 'run.classic.story', 'run.classic.square']) {
      const template = TEMPLATES.find((t) => t.id === id)!;
      const photo = template.meta?.needsPhoto ? { photo: { uri: 'fixture:photo-dusk', width: 1200, height: 1800 } } : undefined;
      const { scene, issues } = renderTemplate(template, customRun, { locale: 'en', mode: 'dark', assets: photo });
      expect({ id, issues }).toEqual({ id, issues: [] });
      const texts = textNodes(scene.nodes).map((n) => n.text);
      expect(texts).toContain('6:20');
      expect(texts).toContain('154');
      expect(texts).toContain('172');
      expect(texts).toContain('402');
    }
  });

  test('renders sport family templates with customized metrics', async () => {
    const walkFixture = FIXTURES.find((f) => f.key === 'walk.hike')!;
    const customWalk = applyCustomMetrics(walkFixture.data, {
      heroId: 'steps',
      secondaryIds: ['hr', 'kcal'],
    }, { locale: 'en' });

    for (const id of ['walk.bold.story', 'walk.poster.story', 'walk.minimal.story', 'walk.stats.sticker']) {
      const template = TEMPLATES.find((t) => t.id === id)!;
      const { scene, issues } = renderTemplate(template, customWalk, { locale: 'en', mode: 'dark' });
      expect({ id, issues }).toEqual({ id, issues: [] });
      const texts = textNodes(scene.nodes).map((n) => n.text);
      expect(texts).toContain('14,210');
      expect(texts).toContain('121');
      expect(texts).toContain('1,010');
    }
  });
});
