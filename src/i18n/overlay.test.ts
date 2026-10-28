import { describe, expect, test } from 'bun:test';

import { LOCALES } from './locale';
import { applyOverlay } from './overlay';
import { iosOverlay } from './overlays/ios';
import { resources } from './resources';

const BRAND = /\b(Huawei|HUAWEI|Honor|HONOR|HarmonyOS|AppGallery|Theme Studio|Petal Maps)\b/;
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const PARAM = /\{\{\s*([\w.]+)[^}]*\}\}/g;

/**
 * Brand-bearing keys only an Android screen renders, so they need no iOS overlay. A key with `android` in its path is
 * exempt without being listed. Anything else that names a brand must get an iOS overlay (docs/app-store.md, 4.1(b)).
 */
const ANDROID_ONLY: Record<string, string> = {
  'onboarding:background.notice': 'the background step is Android-only (onboarding/flow.ts, platforms: android)',
  'settings:safety.sosDetails': "SafetySection's SMS branch; iOS shows safety.iosNotice and iosDetails",
};

function leaves(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
  }
  return [];
}

function strings(tree: object): Map<string, string> {
  return new Map(Object.entries(tree).flatMap(([ns, value]) => leaves(value).map(([key, text]) => [`${ns}:${key}`, text])));
}

const params = (text: string) => new Set([...text.matchAll(PARAM)].map((match) => match[1]));

describe('iOS string overlay', () => {
  for (const locale of LOCALES) {
    const base = strings(resources[locale]);
    const overlay = strings(iosOverlay[locale]);

    test(`${locale}: every override replaces a base string and uses only its placeholders`, () => {
      const problems: string[] = [];
      for (const [key, text] of overlay) {
        const original = base.get(key);
        if (original === undefined) {
          problems.push(`${key}: not a base string`);
          continue;
        }
        const allowed = params(original);
        for (const param of params(text)) if (!allowed.has(param)) problems.push(`${key}: unknown {{${param}}}`);
      }
      expect(problems).toEqual([]);
    });

    test(`${locale}: no Huawei or Honor branding left in a string iOS shows`, () => {
      const merged = strings(applyOverlay(resources, iosOverlay)[locale]);
      expect([...merged.keys()].sort()).toEqual([...base.keys()].sort());
      const branded = [...merged]
        .filter(([key, text]) => BRAND.test(text) && !/android/i.test(key.slice(key.indexOf(':') + 1)) && !(key in ANDROID_ONLY))
        .map(([key]) => key);
      expect(branded).toEqual([]);
    });
  }

  test('id and en override the same keys', () => {
    const [en, id] = (['en', 'id'] as const).map((locale) =>
      [...new Set([...strings(iosOverlay[locale]).keys()].map((key) => key.replace(PLURAL_SUFFIX, '')))].sort(),
    );
    expect(en).toEqual(id);
  });
});
