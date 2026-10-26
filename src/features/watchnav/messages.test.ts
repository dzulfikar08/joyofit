import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { byteLength, cutName, decodeWatchMessage, DIRS, MAX_MESSAGE_BYTES, MAX_NAME_CHARS, MessageEncoder } from './messages';

const schema = JSON.parse(readFileSync(join(import.meta.dir, '../../../protocol/watch-nav.schema.json'), 'utf8'));

describe('MessageEncoder', () => {
  test('envelope first: v, t, n, then the fields; n counts from 1', () => {
    const enc = new MessageEncoder();
    expect(enc.encode({ t: 'hb' }).json).toBe('{"v":1,"t":"hb","n":1}');
    const turn = enc.encode({ t: 'turn', dir: 'right', distM: 120.4, street: 'Jl. Ijen', next: { dir: 'left', street: 'Jl. Semeru' } });
    expect(turn.json).toBe('{"v":1,"t":"turn","n":2,"dir":"right","distM":120,"street":"Jl. Ijen","next":{"dir":"left","street":"Jl. Semeru"}}');
    expect(turn.n).toBe(2);
    expect(turn.bytes).toBe(byteLength(turn.json));
  });

  test('distances and times are whole and never negative', () => {
    const json = JSON.parse(new MessageEncoder().encode({ t: 'prog', distM: -3, remM: 1234.6, etaS: Number.NaN }).json);
    expect(json).toEqual({ v: 1, t: 'prog', n: 1, distM: 0, remM: 1235, etaS: 0 });
  });

  test('exit only when given; names cut to 48 characters without splitting an emoji', () => {
    const enc = new MessageEncoder();
    const long = 'Jalan '.repeat(20) + '🚲';
    const turn = JSON.parse(enc.encode({ t: 'turn', dir: 'roundabout', distM: 10, street: long, exit: 2 }).json);
    expect(turn.exit).toBe(2);
    expect(Array.from(turn.street as string).length).toBeLessThanOrEqual(MAX_NAME_CHARS);
    expect(JSON.parse(enc.encode({ t: 'turn', dir: 'left', distM: 10, street: '' }).json)).not.toHaveProperty('exit');
    expect(cutName('a'.repeat(47) + '🚲🚲')).toBe('a'.repeat(47) + '🚲');
  });

  test('the largest possible message stays far under 1000 bytes', () => {
    const name = '𝔍'.repeat(100); // 4 bytes each in UTF-8
    const { bytes } = new MessageEncoder().encode({
      t: 'turn',
      dir: 'sharp_right',
      distM: 9_999_999,
      street: name,
      exit: 12,
      next: { dir: 'slight_right', street: name },
    });
    expect(bytes).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    expect(bytes).toBeLessThan(600);
  });

  test('n wraps from 2^31 - 1 back to 1', () => {
    const enc = new MessageEncoder();
    Reflect.set(enc, 'seq', 2_147_483_646);
    expect(enc.encode({ t: 'hb' }).n).toBe(2_147_483_647);
    expect(enc.encode({ t: 'hb' }).n).toBe(1);
  });

  test('a message over 1000 bytes throws instead of going out cut', () => {
    const enc = new MessageEncoder();
    const huge = { t: 'end', why: 'x'.repeat(2000) } as unknown as Parameters<MessageEncoder['encode']>[0];
    expect(() => enc.encode(huge)).toThrow(/more than 1000/);
    // The failed message used no sequence number.
    expect(enc.next).toBe(1);
  });
});

describe('decodeWatchMessage', () => {
  test('reads hello, pause, resume, stop', () => {
    expect(decodeWatchMessage('{"v":1,"t":"hello","n":1,"app":"1.0.0"}')).toEqual({ t: 'hello', n: 1, app: '1.0.0' });
    expect(decodeWatchMessage('{"v":1,"t":"pause","n":2}')).toEqual({ t: 'pause', n: 2 });
    expect(decodeWatchMessage('{"v":1,"t":"resume","n":3,"extra":true}')).toEqual({ t: 'resume', n: 3 });
    expect(decodeWatchMessage('{"v":1,"t":"stop","n":4}')).toEqual({ t: 'stop', n: 4 });
  });

  test('ignores anything else', () => {
    for (const bad of ['', 'not json', '[]', '{"v":2,"t":"stop","n":1}', '{"v":1,"t":"turn","n":1}', '{"v":1,"t":"stop"}', '{"v":1,"t":"stop","n":0}', '{"v":1,"t":"hello","n":1}']) {
      expect(decodeWatchMessage(bad)).toBeNull();
    }
  });
});

describe('schema', () => {
  test('the dir enum and the limits agree with protocol/watch-nav.schema.json', () => {
    expect(schema.$defs.dir.enum).toEqual([...DIRS]);
    expect(schema['x-joyofit'].maxBytes).toBe(MAX_MESSAGE_BYTES);
    expect(schema.$defs.street.maxLength).toBe(MAX_NAME_CHARS);
    expect(schema.properties.t.enum).toEqual(['start', 'turn', 'prog', 'off', 'reroute', 'arrive', 'end', 'hb', 'hello', 'pause', 'resume', 'stop']);
  });
});
