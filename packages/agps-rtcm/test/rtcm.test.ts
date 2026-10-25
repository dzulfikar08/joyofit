import { describe, expect, test } from 'bun:test';

import {
  bkgBrdcUrl,
  bkgBrdcUrls,
  buildHwAgnss,
  crc24q,
  encode1019,
  frame,
  HW_AGNSS_MAX_BYTES,
  MAX_AGE_S,
  parseRinexNav,
  secondsOfWeek,
  selectCurrent,
  validateHwAgnss,
} from '../src/rtcm';
import { C13, E10, G17, gpsSet, HEADER, R23 } from './fixture';

// A reader of RTCM 3 frames written from the data field tables (DF numbers in the comments), separate from the encoder.
function bitsAt(buf: Uint8Array, start: number, len: number): number {
  let n = 0;
  for (let i = start; i < start + len; i++) n = n * 2 + ((buf[i >> 3] >> (7 - (i & 7))) & 1);
  return n;
}

function frames(file: Uint8Array): { type: number; body: Uint8Array; crcOk: boolean }[] {
  const out = [];
  let i = 0;
  while (i < file.length) {
    expect(file[i]).toBe(0xd3);
    expect(file[i + 1] & 0xfc).toBe(0); // six reserved bits
    const len = ((file[i + 1] & 3) << 8) | file[i + 2];
    const end = i + 3 + len;
    const crc = (file[end] << 16) | (file[end + 1] << 8) | file[end + 2];
    const body = file.subarray(i + 3, end);
    out.push({ type: bitsAt(body, 0, 12), body, crcOk: crc24q(file.subarray(i, end)) === crc });
    i = end + 3;
  }
  return out;
}

const NOW = Date.UTC(2026, 9, 21, 2, 10, 0); // ten minutes after the GPS record's epoch
// The GLONASS record is shifted to 02:00 UTC so that all four systems are fresh at NOW.
const R_AT_0200 = R23.replace('2026 10 21 00 15 00', '2026 10 21 02 00 00');
const records = () => parseRinexNav(HEADER + G17 + E10 + C13 + R_AT_0200);

describe('RTCM 3 framing', () => {
  test('CRC-24Q of "123456789" is the published check value 0xCDE703', () => {
    expect(crc24q(new TextEncoder().encode('123456789'))).toBe(0xcde703);
  });

  test('a frame is D3, length, message and a CRC that covers all of it', () => {
    const f = frame(Uint8Array.from([1, 2, 3]));
    expect([...f.subarray(0, 6)]).toEqual([0xd3, 0, 3, 1, 2, 3]);
    expect(crc24q(f.subarray(0, 6)).toString(16).padStart(6, '0')).toBe(
      [...f.subarray(6)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    );
  });

  test('a message over 1023 bytes is refused', () => {
    expect(() => frame(new Uint8Array(1024))).toThrow(RangeError);
  });
});

describe('RINEX navigation parsing', () => {
  test('reads system, satellite, epoch and every number of each record', () => {
    const [g, e, c, r] = records();
    expect([g.sys, g.prn, g.epochMs]).toEqual(['G', 17, Date.UTC(2026, 9, 21, 1, 59, 44)]);
    expect(g.v).toHaveLength(3 + 7 * 4);
    expect(g.v[0]).toBeCloseTo(-2.126386389136e-4, 15);
    expect(g.v[10]).toBeCloseTo(5153.724388123, 6); // sqrt(A)
    expect([e.sys, e.prn, e.v[20], e.v[21]]).toEqual(['E', 10, 517, 2441]);
    expect([c.sys, c.prn, c.v[21]]).toEqual(['C', 13, 1085]);
    expect(r.sys).toBe('R');
    expect(r.v).toHaveLength(3 + 4 * 4); // RINEX 3.05 GLONASS: first line plus four
    expect(r.v[2]).toBe(259200);
  });

  test('skips systems the tool does not encode', () => {
    const qzss = G17.replace('G17', 'J07');
    expect(parseRinexNav(HEADER + qzss)).toEqual([]);
  });

  test('the epoch of a record is its calendar time, and the week second follows from it', () => {
    expect(secondsOfWeek(Date.UTC(2026, 9, 21, 1, 59, 44))).toBe(3 * 86400 + 1 * 3600 + 59 * 60 + 44); // a Wednesday, and the record's own toe is 266384
    expect(secondsOfWeek(Date.UTC(1980, 0, 6))).toBe(0);
  });
});

describe('selection', () => {
  test('keeps the newest usable record per satellite and drops what is too old or from the future', () => {
    const all = records();
    const older = { ...all[0], epochMs: all[0].epochMs - 3600_000 };
    const stale = { ...all[0], prn: 18, epochMs: NOW - (MAX_AGE_S.G + 60) * 1000 };
    const future = { ...all[0], prn: 19, epochMs: NOW + 3600_000 };
    const picked = selectCurrent([older, ...all, stale, future], NOW);
    expect(picked.filter((r) => r.sys === 'G').map((r) => [r.prn, r.epochMs])).toEqual([[17, all[0].epochMs]]);
  });

  test('GLONASS must be fresher than an hour', () => {
    const r = records()[3];
    expect(selectCurrent([r], r.epochMs + 59 * 60_000)).toHaveLength(1);
    expect(selectCurrent([r], r.epochMs + 61 * 60_000)).toHaveLength(0);
  });

  test('drops unhealthy satellites and Galileo F/NAV records', () => {
    const [g, e, c, r] = records();
    const sick = (x: typeof g, i: number) => ({ ...x, v: x.v.map((n, k) => (k === i ? 1 : n)) });
    expect(selectCurrent([sick(g, 24), sick(c, 24), sick(r, 6)], NOW)).toEqual([]);
    const fnav = { ...e, v: e.v.map((n, k) => (k === 20 ? 258 : n)) };
    expect(selectCurrent([fnav], NOW)).toEqual([]);
    expect(selectCurrent([sick(e, 24)], NOW)).toEqual([]); // E1-B data validity flag set
  });
});

describe('the file', () => {
  test('one CRC-valid frame per satellite, ordered GPS, GLONASS, Galileo, BeiDou', () => {
    const built = buildHwAgnss(records(), NOW);
    expect(built.counts).toEqual({ G: 1, R: 1, E: 1, C: 1 });
    expect(built.skipped).toBe(0);
    const fs = frames(built.bytes);
    expect(fs.map((f) => f.type)).toEqual([1019, 1020, 1046, 1042]);
    expect(fs.every((f) => f.crcOk)).toBe(true);
    expect(fs.map((f) => f.body.length)).toEqual([61, 45, 63, 64]);
  });

  test('GPS 1019 fields read back (DF009 prn, DF076 week, DF081 toc, DF092 sqrt(A), DF090 e, DF084 af0)', () => {
    const b = frames(buildHwAgnss(records(), NOW).bytes)[0].body;
    expect(bitsAt(b, 12, 6)).toBe(17);
    expect(bitsAt(b, 18, 10)).toBe(2441 % 1024);
    const toc = secondsOfWeek(Date.UTC(2026, 9, 21, 1, 59, 44)) / 16;
    expect(bitsAt(b, 12 + 6 + 10 + 4 + 2 + 14 + 8, 16)).toBe(toc);
    let at = 12 + 6 + 10 + 4 + 2 + 14 + 8 + 16 + 8 + 16;
    const af0 = bitsAt(b, at, 22);
    expect((af0 >= 2 ** 21 ? af0 - 2 ** 22 : af0) * 2 ** -31).toBeCloseTo(-2.126386389136e-4, 9);
    at += 22 + 10 + 16 + 16 + 32 + 16;
    expect(bitsAt(b, at, 32) * 2 ** -33).toBeCloseTo(1.266673998907e-2, 9);
    at += 32 + 16;
    expect(bitsAt(b, at, 32) * 2 ** -19).toBeCloseTo(5153.724388123, 5);
  });

  test('Galileo 1046 week counts from the Galileo epoch (GPS-aligned week minus 1024), IODnav and sqrt(A)', () => {
    const b = frames(buildHwAgnss(records(), NOW).bytes)[2].body;
    expect(bitsAt(b, 12, 6)).toBe(10);
    expect(bitsAt(b, 18, 12)).toBe(2441 - 1024);
    expect(bitsAt(b, 30, 10)).toBe(50);
    expect(bitsAt(b, 40, 8)).toBe(107); // SISA 3.12 m
    const sqrtA = 12 + 6 + 12 + 10 + 8 + 14 + 14 + 6 + 21 + 31 + 16 + 16 + 32 + 16 + 32 + 16;
    expect(bitsAt(b, sqrtA, 32) * 2 ** -19).toBeCloseTo(5440.604673386, 5);
  });

  test('BeiDou 1042 keeps the BeiDou week as printed', () => {
    const b = frames(buildHwAgnss(records(), NOW).bytes)[3].body;
    expect(bitsAt(b, 12, 6)).toBe(13);
    expect(bitsAt(b, 18, 13)).toBe(1085);
  });

  test('GLONASS 1020: slot, channel, tb in Moscow time, X position in km', () => {
    const b = frames(buildHwAgnss(records(), NOW).bytes)[1].body;
    expect(bitsAt(b, 12, 6)).toBe(23);
    expect(bitsAt(b, 18, 5)).toBe(3 + 7);
    // epoch 02:00 UTC is 05:00 Moscow time, tb slot 20 of 15 minutes
    expect(bitsAt(b, 12 + 6 + 5 + 1 + 1 + 2 + 5 + 6 + 1 + 1 + 1, 7)).toBe(20);
    const xAt = 12 + 6 + 5 + 1 + 1 + 2 + 5 + 6 + 1 + 1 + 1 + 7 + 24; // after tb and X velocity
    const mag = bitsAt(b, xAt + 1, 26);
    expect(bitsAt(b, xAt, 1)).toBe(0);
    expect(mag * 2 ** -11).toBeCloseTo(11197.51074219, 3);
  });

  test('a record that does not fit its message is skipped and counted, not sent half-filled', () => {
    const bad = parseRinexNav(HEADER + G17.replace('5.105510354042e-06', '5.105510354042e+03'));
    const built = buildHwAgnss(bad, NOW);
    expect(built.counts.G).toBe(0);
    expect(built.skipped).toBe(1);
    expect(() => encode1019(bad[0])).toThrow(RangeError);
  });
});

describe('reading only what can still be used', () => {
  test('records older than the cut-off are skipped before their numbers are read', () => {
    const all = parseRinexNav(HEADER + G17 + E10 + C13 + R23);
    const recent = parseRinexNav(HEADER + G17 + E10 + C13 + R23, Date.UTC(2026, 9, 21, 0, 0, 0));
    expect(all.map((r) => r.sys + r.prn)).toEqual(['G17', 'E10', 'C13', 'R23']);
    expect(recent.map((r) => r.sys + r.prn)).toEqual(['G17', 'C13', 'R23']); // E10 is from 23:50 the day before
    expect(recent[0].v).toEqual(all[0].v);
  });
});

describe('BKG files', () => {
  test('the merged daily file is named by year and day of year (UTC)', () => {
    expect(bkgBrdcUrl(Date.UTC(2026, 9, 25, 3, 0, 0))).toBe(
      'https://igs.bkg.bund.de/root_ftp/IGS/BRDC/2026/298/BRDC00WRD_S_20262980000_01D_MN.rnx.gz',
    );
    expect(bkgBrdcUrl(Date.UTC(2027, 0, 1, 0, 0, 0))).toContain('/2027/001/BRDC00WRD_S_20270010000_01D_MN');
  });

  test("yesterday's file is read too while today's is younger than the oldest usable record", () => {
    expect(bkgBrdcUrls(Date.UTC(2026, 9, 25, 2, 0, 0)).map((u) => u.split('/')[7])).toEqual(['298', '297']);
    expect(bkgBrdcUrls(Date.UTC(2026, 9, 25, 4, 1, 0)).map((u) => u.split('/')[7])).toEqual(['298']);
  });
});

describe('validation before the file is served', () => {
  const good = () => buildHwAgnss(parseRinexNav(HEADER + gpsSet(24) + E10 + C13 + R_AT_0200), NOW).bytes;

  test('a full build passes', () => {
    expect(validateHwAgnss(good())).toBeNull();
  });

  test('too few satellites, a bad CRC, a cut-off frame or a foreign message are refused', () => {
    const few = buildHwAgnss(parseRinexNav(HEADER + gpsSet(19)), NOW).bytes;
    expect(validateHwAgnss(few)).toBe('only 19 satellites (at least 20 needed)');

    const flipped = good();
    flipped[10] ^= 1;
    expect(validateHwAgnss(flipped)).toBe('RTCM frame at byte 0 fails its CRC');

    const cut = good().subarray(0, good().length - 1);
    expect(validateHwAgnss(cut)).toMatch(/is cut off$/);

    const tail = new Uint8Array([...good(), 0x00]);
    expect(validateHwAgnss(tail)).toMatch(/^not an RTCM 3 frame at byte \d+$/);

    const stationFrame = frame(Uint8Array.from([0x3e, 0xd0, 0, 0, 0])); // message 1005, a station position
    expect(validateHwAgnss(new Uint8Array([...good(), ...stationFrame]))).toMatch(/^unexpected RTCM message 1005 at byte \d+$/);
  });

  test('size bounds', () => {
    expect(validateHwAgnss(new Uint8Array(100))).toBe('file too small (100 bytes)');
    expect(validateHwAgnss(new Uint8Array(HW_AGNSS_MAX_BYTES + 1))).toBe(`file too large (${HW_AGNSS_MAX_BYTES + 1} bytes)`);
  });
});
