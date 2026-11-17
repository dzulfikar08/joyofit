import { describe, expect, it } from 'bun:test';

import { attValues, formatFrame, huaweiFrames, readPacketLogger, readPcap } from './hh-notif-capture';

const bytes = (...parts: (number | number[] | Uint8Array)[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === 'number' ? [p] : [...p])));

/** A Huawei frame with a dummy CRC: `5A len 00 svc cmd body CRC` (len counts from the 00 to the end of the body). */
function frame(service: number, command: number, body: Uint8Array): Uint8Array {
  const len = 3 + body.length;
  return bytes(0x5a, len >> 8, len & 0xff, 0x00, service, command, body, 0xab, 0xcd);
}

/** An encrypted body: `7C 01 01`, `7D 10 <iv>`, `7E <len> <cipher>`. */
function encrypted(cipherLength: number): Uint8Array {
  const len = cipherLength > 127 ? [0x80 | (cipherLength >> 7), cipherLength & 0x7f] : [cipherLength];
  return bytes(0x7c, 0x01, 0x01, 0x7d, 0x10, new Array(16).fill(7), 0x7e, len, new Array(cipherLength).fill(9));
}

/** An ACL packet carrying (part of) an L2CAP frame on the ATT channel. */
function acl(handle: number, boundary: number, payload: Uint8Array): Uint8Array {
  const hb = handle | (boundary << 12);
  return bytes(hb & 0xff, hb >> 8, payload.length & 0xff, payload.length >> 8, payload);
}

function att(opcode: number, attHandle: number, value: Uint8Array): Uint8Array {
  const pdu = bytes(opcode, attHandle & 0xff, attHandle >> 8, value);
  return bytes(pdu.length & 0xff, pdu.length >> 8, 0x04, 0x00, pdu);
}

function pklgRecord(secs: number, type: number, data: Uint8Array): Uint8Array {
  const len = 9 + data.length;
  const head = new DataView(new ArrayBuffer(13));
  head.setUint32(0, len);
  head.setUint32(4, secs);
  head.setUint32(8, 0);
  head.setUint8(12, type);
  return bytes(new Uint8Array(head.buffer), data);
}

describe('hh-notif-capture', () => {
  it('finds an encrypted 02/0B write, a split L2CAP packet and an answer spread over two notifications', () => {
    const write = att(0x52, 0x0010, frame(0x02, 0x0b, encrypted(30)));
    const answer = frame(0x02, 0x0b, bytes(0x7f, 0x04, 0x00, 0x01, 0x86, 0xa0));
    const capture = bytes(
      pklgRecord(100, 0x02, acl(0x40, 0x00, write.subarray(0, 20))),
      pklgRecord(100, 0x02, acl(0x40, 0x01, write.subarray(20))),
      pklgRecord(101, 0x03, acl(0x40, 0x02, att(0x1b, 0x0012, answer.subarray(0, 5)))),
      pklgRecord(101, 0x03, acl(0x40, 0x02, att(0x1b, 0x0012, answer.subarray(5)))),
      pklgRecord(102, 0x01, bytes(0x0e, 0x04, 0x01, 0x00, 0x00, 0x00)),
    );
    const frames = huaweiFrames(attValues(readPacketLogger(capture)));
    expect(frames.map((f) => [f.fromPhone, f.service, f.command, f.cipherLength, f.result])).toEqual([
      [true, 0x02, 0x0b, 30, null],
      [false, 0x02, 0x0b, null, 100000],
    ]);
    expect(formatFrame(frames[0], 100)).toContain('02/0b  7E 30 bytes, plaintext 14 if GCM');
    expect(formatFrame(frames[1], 100)).toContain('watch -> HH  02/0b  answer 100000 (OK)');
  });

  it('joins a sliced frame and reads a two-byte TLV length', () => {
    const body = encrypted(200);
    const first = bytes(0x5a, 0x00, 4 + 100, 0x01, 0x00, 0x02, 0x0b, body.subarray(0, 100), 0, 0);
    const last = bytes(0x5a, 0x00, 2 + body.length - 100, 0x03, 0x01, body.subarray(100), 0, 0);
    const capture = bytes(
      pklgRecord(5, 0x02, acl(0x40, 0x00, att(0x52, 0x10, first))),
      pklgRecord(5, 0x02, acl(0x40, 0x00, att(0x52, 0x10, last))),
    );
    const [f] = huaweiFrames(attValues(readPacketLogger(capture)));
    expect(f.sliced).toBe(true);
    expect(f.cipherLength).toBe(200);
  });

  it('reads a pcap of link type 201 (H4 with direction)', () => {
    const packet = bytes(0, 0, 0, 0, 0x02, acl(0x40, 0x00, att(0x52, 0x10, frame(0x02, 0x04, encrypted(24)))));
    const header = new DataView(new ArrayBuffer(24));
    header.setUint32(0, 0xa1b2c3d4, true);
    header.setUint16(4, 2, true);
    header.setUint16(6, 4, true);
    header.setUint32(16, 65535, true);
    header.setUint32(20, 201, true);
    const record = new DataView(new ArrayBuffer(16));
    record.setUint32(0, 7, true);
    record.setUint32(8, packet.length, true);
    record.setUint32(12, packet.length, true);
    const capture = bytes(new Uint8Array(header.buffer), new Uint8Array(record.buffer), packet);
    const [f] = huaweiFrames(attValues(readPcap(capture)));
    expect([f.service, f.command, f.cipherLength, f.fromPhone]).toEqual([0x02, 0x04, 24, true]);
  });
});
