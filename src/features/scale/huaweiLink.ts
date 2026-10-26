/**
 * The Huawei link probe of "Rekam data timbangan": a HUAWEI Scale 3 Pro exposes service fe86 (fe01 write without response, fe02
 * notify), the same link our watches use, and stays silent to a recorder that only listens. The probe asks it the one question that
 * opens that link and changes nothing on the device (link parameters, service 01 command 01) and logs the raw answer and its fields.
 *
 * Clean room: written from our own Watch Fit 4 Pro capture only
 * (modules/huawei-wear/ios/HuaweiProtocol/Tests/HuaweiProtocolTests/Fixtures/real-ble-frames.txt). The tests check every byte against
 * the frames recorded there. Nothing here is taken from the huawei-wear link layer. What the capture shows:
 *   5A | length u16 BE (= bytes from the slice byte to the end of the TLV) | slice 00 | service | command | TLV | CRC-16 u16 BE
 * The CRC is CRC-16 with polynomial 0x1021, initial value 0 and no reflection (XMODEM), over everything before it; it matches all
 * captured frames. A TLV is tag u8, length, value; the request is the four tags 01 to 04 with no value.
 */

export const HUAWEI_LINK_SERVICE = 'fe86';
export const HUAWEI_LINK_WRITE = 'fe01';
export const HUAWEI_LINK_NOTIFY = 'fe02';

const MAGIC = 0x5a;
/** Bytes around the TLV: magic, two length bytes, then slice, service and command (counted by the length), then two CRC bytes. */
const HEADER = 3;
const TRAILER = 2;
/** A link frame is never longer than this; a length above it means the bytes are not a frame. */
const MAX_FRAME = 4096;

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function fromHex(hex: string): Uint8Array | null {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** CRC-16, polynomial 0x1021, initial value 0, not reflected. */
export function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** One unsliced frame: `5A | len | 00 | service | command | tlv | crc`. */
export function linkFrame(service: number, command: number, tlv: Uint8Array): Uint8Array {
  const length = 3 + tlv.length;
  const frame = new Uint8Array(HEADER + length + TRAILER);
  frame.set([MAGIC, length >> 8, length & 0xff, 0x00, service, command]);
  frame.set(tlv, 6);
  const crc = crc16(frame.subarray(0, frame.length - TRAILER));
  frame[frame.length - 2] = crc >> 8;
  frame[frame.length - 1] = crc & 0xff;
  return frame;
}

/** The link parameters question: service 01, command 01, tags 01 to 04 asked with no value. */
export const LINK_PARAMS_REQUEST = linkFrame(0x01, 0x01, Uint8Array.from([0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x04, 0x00]));

export interface LinkFrame {
  bytes: Uint8Array;
  crcOk: boolean;
  /** 0 for a whole frame; any other value is one piece of a longer message, whose TLV is not read here. */
  slice: number;
  service: number | null;
  command: number | null;
  /** The TLV bytes of a whole frame, else null. */
  tlv: Uint8Array | null;
}

export function parseLinkFrame(bytes: Uint8Array): LinkFrame {
  const crcOk =
    bytes.length >= HEADER + TRAILER &&
    crc16(bytes.subarray(0, bytes.length - TRAILER)) === ((bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1]);
  const slice = bytes[3] ?? -1;
  const whole = slice === 0 && bytes.length >= 6 + TRAILER;
  return {
    bytes,
    crcOk,
    slice,
    service: whole ? bytes[4] : null,
    command: whole ? bytes[5] : null,
    tlv: whole ? bytes.subarray(6, bytes.length - TRAILER) : null,
  };
}

/**
 * Joins notifications into frames: a frame longer than one notification arrives in pieces, and bytes before a `5A` are dropped.
 * `push` returns the frames that are complete with these bytes.
 */
export class LinkFrameAssembler {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): LinkFrame[] {
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    let rest = joined;
    const frames: LinkFrame[] = [];
    for (;;) {
      const start = rest.indexOf(MAGIC);
      if (start < 0) {
        rest = new Uint8Array(0);
        break;
      }
      rest = rest.subarray(start);
      if (rest.length < HEADER) break;
      const total = HEADER + ((rest[1] << 8) | rest[2]) + TRAILER;
      if (total > MAX_FRAME) {
        rest = rest.subarray(1);
        continue;
      }
      if (rest.length < total) break;
      frames.push(parseLinkFrame(rest.slice(0, total)));
      rest = rest.subarray(total);
    }
    this.buffer = rest.slice();
    return frames;
  }
}

/**
 * Tag, length, value. A length of 128 or more is written in 7-bit groups, high group first, bit 7 set on every group but the last
 * (no LinkParams answer seen so far needs it). Null when the bytes do not split into whole entries.
 */
export function parseTlv(bytes: Uint8Array): { tag: number; value: Uint8Array }[] | null {
  const out: { tag: number; value: Uint8Array }[] = [];
  let i = 0;
  while (i < bytes.length) {
    const tag = bytes[i++];
    let length = 0;
    for (let groups = 0; ; groups++) {
      if (i >= bytes.length || groups === 4) return null;
      const b = bytes[i++];
      length = (length << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    if (i + length > bytes.length) return null;
    out.push({ tag, value: bytes.subarray(i, i + length) });
    i += length;
  }
  return out;
}

/** The fields of a link parameters answer; null where the device left the tag out. Tag meanings as JoyoFit's watch link reads them. */
export interface LinkParams {
  protocolVersion: number | null;
  sliceSize: number | null;
  /** Largest frame the device takes. */
  mtu: number | null;
  interval: number | null;
  /** Byte 2 of tag 05; the 16 bytes after it are a fresh random number of this session (not logged as a field). */
  authVersion: number | null;
  deviceSupportType: number | null;
  authAlgo: number | null;
  bondState: number | null;
  encryptMethod: number | null;
  /** Tags not named above, as hex. */
  other: Record<string, string>;
}

export function decodeLinkParams(tlv: Uint8Array): LinkParams | null {
  const entries = parseTlv(tlv);
  if (!entries) return null;
  const out: LinkParams = {
    protocolVersion: null, sliceSize: null, mtu: null, interval: null, authVersion: null,
    deviceSupportType: null, authAlgo: null, bondState: null, encryptMethod: null, other: {},
  };
  const named: Partial<Record<number, keyof Omit<LinkParams, 'authVersion' | 'other'>>> = {
    0x01: 'protocolVersion', 0x02: 'sliceSize', 0x03: 'mtu', 0x04: 'interval',
    0x07: 'deviceSupportType', 0x08: 'authAlgo', 0x09: 'bondState', 0x0c: 'encryptMethod',
  };
  for (const { tag, value } of entries) {
    const field = named[tag];
    if (field && value.length > 0 && value.length <= 4) out[field] = value.reduce((n, b) => n * 256 + b, 0);
    else if (tag === 0x05 && value.length >= 2) out.authVersion = value[1];
    else out.other[tag.toString(16).padStart(2, '0')] = toHex(value);
  }
  return out;
}

/** The named fields in log order: what the next step of the handshake depends on first. */
const LOGGED_FIELDS = [
  'protocolVersion', 'authVersion', 'bondState', 'mtu', 'sliceSize', 'deviceSupportType', 'authAlgo', 'encryptMethod', 'interval',
] as const;

/** One log line for a frame from fe02. */
export function describeLinkFrame(frame: LinkFrame): string {
  const crc = frame.crcOk ? 'crc ok' : 'crc BAD';
  if (frame.service === null || frame.command === null || frame.tlv === null) return `frame slice=${frame.slice} ${crc} (piece of a longer message)`;
  const head = `frame service=${frame.service.toString(16).padStart(2, '0')} command=${frame.command.toString(16).padStart(2, '0')} ${crc}`;
  if (frame.service !== 0x01 || frame.command !== 0x01) return `${head} tlv=${toHex(frame.tlv)}`;
  const p = decodeLinkParams(frame.tlv);
  if (!p) return `${head} link params: TLV does not parse (${toHex(frame.tlv)})`;
  const fields = LOGGED_FIELDS.map((k) => `${k}=${p[k] ?? '-'}`).join(' ');
  const other = Object.keys(p.other)
    .sort()
    .map((k) => `${k}=${p.other[k]}`)
    .join(',');
  return `${head} link params: ${fields} other={${other}}`;
}
