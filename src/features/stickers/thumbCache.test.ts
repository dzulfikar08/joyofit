import { describe, expect, test } from 'bun:test';
import { LruCache, hashText, thumbKey } from './thumbCache';

const base = { templateId: 'run.bold.story', dataHash: 'a', date: 1, photoUri: null, locale: 'en', mode: 'dark', options: { watermark: true } };

describe('thumbKey', () => {
  test('is stable and changes with every input', () => {
    expect(thumbKey(base)).toBe(thumbKey({ ...base }));
    for (const change of [{ templateId: 'x' }, { dataHash: 'b' }, { date: 2 }, { photoUri: 'file://p' }, { locale: 'id' }, { mode: 'light' }, { options: { watermark: false } }]) {
      expect(thumbKey({ ...base, ...change })).not.toBe(thumbKey(base));
    }
  });
});

describe('hashText', () => {
  test('equal text, equal hash; different text differs', () => {
    expect(hashText('{"a":1}')).toBe(hashText('{"a":1}'));
    expect(hashText('{"a":1}')).not.toBe(hashText('{"a":2}'));
  });
});

describe('LruCache', () => {
  test('builds once per key', () => {
    const cache = new LruCache<number>(3);
    let made = 0;
    const make = () => ++made;
    expect(cache.getOrCreate('k', make)).toBe(1);
    expect(cache.getOrCreate('k', make)).toBe(1);
    expect(made).toBe(1);
  });

  test('evicts the least recently used', () => {
    const cache = new LruCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.size).toBe(2);
  });
});
