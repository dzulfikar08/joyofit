import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  crc16,
  decodeLinkParams,
  describeLinkFrame,
  fromHex,
  LINK_PARAMS_REQUEST,
  LinkFrameAssembler,
  parseLinkFrame,
  parseTlv,
  toHex,
} from './huaweiLink';

/** Our own Watch Fit 4 Pro capture (Android JoyoFit, 2026-10-16): `dir service command HEX message`. */
const CAPTURE = join(
  import.meta.dir,
  '../../../modules/huawei-wear/ios/HuaweiProtocol/Tests/HuaweiProtocolTests/Fixtures/real-ble-frames.txt',
);
const captured = readFileSync(CAPTURE, 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '' && !l.startsWith('#'))
  .map((l) => {
    const [dir, service, command, hex] = l.split(' ');
    return { dir, service, command, hex: hex.toLowerCase() };
  });
const frameOf = (dir: string, service: string, command: string): Uint8Array => {
  const line = captured.find((f) => f.dir === dir && f.service === service && f.command === command);
  if (!line) throw new Error(`no ${dir} ${service}/${command} in the capture`);
  return fromHex(line.hex)!;
};

const REPLY = () => frameOf('rx', '01', '01');

describe('Huawei link framing', () => {
  it('the link params request is byte for byte the one our watch capture sent', () => {
    expect(toHex(LINK_PARAMS_REQUEST)).toBe(toHex(frameOf('tx', '01', '01')));
    expect(toHex(LINK_PARAMS_REQUEST)).toBe('5a000b0001010100020003000400f13b');
  });

  it('the CRC matches every captured frame, both directions', () => {
    expect(captured.length).toBeGreaterThan(3);
    for (const { hex } of captured) {
      const bytes = fromHex(hex)!;
      expect(crc16(bytes.subarray(0, bytes.length - 2))).toBe((bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1]);
      expect(parseLinkFrame(bytes).crcOk).toBe(true);
    }
  });

  it('a damaged byte fails the CRC', () => {
    const bytes = REPLY().slice();
    bytes[10] ^= 0x01;
    expect(parseLinkFrame(bytes).crcOk).toBe(false);
    expect(describeLinkFrame(parseLinkFrame(bytes))).toContain('crc BAD');
  });

  it('reads TLV lengths of 128 and more as 7-bit groups and refuses truncated entries', () => {
    const long = new Uint8Array(3 + 128);
    long.set([0x01, 0x81, 0x00]);
    expect(parseTlv(long)?.map((e) => [e.tag, e.value.length])).toEqual([[1, 128]]);
    expect(parseTlv(Uint8Array.from([0x01, 0x05, 0x00]))).toBeNull();
    expect(parseTlv(Uint8Array.from([0x01, 0x80]))).toBeNull();
  });
});

describe('link params answer', () => {
  it('decodes the Fit 4 Pro answer from the capture', () => {
    const frame = parseLinkFrame(REPLY());
    expect(frame).toMatchObject({ crcOk: true, slice: 0, service: 1, command: 1 });
    expect(decodeLinkParams(frame.tlv!)).toEqual({
      protocolVersion: 2,
      sliceSize: 1022,
      mtu: 514,
      interval: 0,
      authVersion: 1,
      deviceSupportType: 4,
      authAlgo: null,
      bondState: 0,
      encryptMethod: null,
      other: { '0d': '00', '0f': '01', '10': '00' },
    });
    expect(describeLinkFrame(frame)).toBe(
      'frame service=01 command=01 crc ok link params: protocolVersion=2 authVersion=1 bondState=0 mtu=514 sliceSize=1022 ' +
        'deviceSupportType=4 authAlgo=- encryptMethod=- interval=0 other={0d=00,0f=01,10=00}',
    );
  });

  it('logs another command as its TLV and a piece of a sliced message as such', () => {
    expect(describeLinkFrame(parseLinkFrame(frameOf('rx', '01', '2c')))).toMatch(/^frame service=01 command=2c crc ok tlv=0150/);
    const sliced = parseLinkFrame(fromHex('5a0004010001aa0000')!);
    expect(sliced).toMatchObject({ slice: 1, service: null, tlv: null });
    expect(describeLinkFrame(sliced)).toContain('piece of a longer message');
  });
});

describe('LinkFrameAssembler', () => {
  it('joins an answer split over 20-byte notifications and drops bytes before the 5A', () => {
    const reply = REPLY();
    const assembler = new LinkFrameAssembler();
    const chunks = [Uint8Array.from([0x00, 0x11]), ...Array.from({ length: Math.ceil(reply.length / 20) }, (_, i) => reply.subarray(i * 20, i * 20 + 20))];
    const frames = chunks.flatMap((c) => assembler.push(c));
    expect(frames).toHaveLength(1);
    expect(toHex(frames[0].bytes)).toBe(toHex(reply));
  });

  it('returns two frames that arrive in one notification', () => {
    const a = REPLY();
    const b = frameOf('rx', '01', '33');
    const both = new Uint8Array(a.length + b.length);
    both.set(a);
    both.set(b, a.length);
    expect(new LinkFrameAssembler().push(both).map((f) => f.command)).toEqual([0x01, 0x33]);
  });
});
