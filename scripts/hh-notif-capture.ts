// Reads a Bluetooth capture of Huawei Health iOS talking to a watch (docs/ios-notification-app-switches.md section 4) and lists the
// Huawei frames: time, direction, service/command, the 7E cipher length and the plaintext length it implies (GCM: 7E length - 16).
// The 02/0B app switch frames are what section 4.3 asks for; the rest are listed too so a toggle can be matched to whatever HH sent.
//
// Capture on Linux: `idevicebtlogger hh-notif.pklg` (PacketLogger, the default) or `idevicebtlogger -f pcap hh-notif.pcap`.
// Then: `bun scripts/hh-notif-capture.ts hh-notif.pklg` (add `--all` for every service, not just 0x02).

import { readFileSync } from 'node:fs';

/** One ATT value: a write from the phone (to FE01) or a notification from the watch (FE02). */
export interface AttValue {
  time: number;
  fromPhone: boolean;
  handle: number;
  value: Uint8Array;
}

/** One Huawei frame rebuilt from the ATT stream of one direction. */
export interface HuaweiFrame {
  time: number;
  fromPhone: boolean;
  service: number;
  command: number;
  /** Bytes of the frame body after service and command (sliced frames joined). */
  body: Uint8Array;
  sliced: boolean;
  /** Length of the 7E (cipher text) element, null when the body is not an encrypted TLV. */
  cipherLength: number | null;
  /** The cleartext 7F result code of an unencrypted answer (100000 = OK), when present. */
  result: number | null;
}

const ATT_WRITE_REQ = 0x12;
const ATT_WRITE_CMD = 0x52;
const ATT_NOTIFY = 0x1b;
const ATT_INDICATE = 0x1d;

/** HCI ACL packets of a capture, as `[time, fromPhone, bytes after the H4 type]`. */
type Acl = [number, boolean, Uint8Array];

/** PacketLogger (.pklg): records of `len u32 BE, secs u32, usecs u32, type u8, data`; type 2 = ACL sent, 3 = ACL received. */
export function readPacketLogger(file: Uint8Array): Acl[] {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const out: Acl[] = [];
  let at = 0;
  while (at + 13 <= file.length) {
    const len = view.getUint32(at);
    if (len < 9 || at + 4 + len > file.length) break;
    const time = view.getUint32(at + 4) + view.getUint32(at + 8) / 1e6;
    const type = file[at + 12];
    if (type === 2 || type === 3) out.push([time, type === 2, file.subarray(at + 13, at + 4 + len)]);
    at += 4 + len;
  }
  return out;
}

/** pcap with link type 201 (H4 with a 4 byte direction, 0 = sent) or 187 (H4 only, direction unknown: taken from the ATT opcode). */
export function readPcap(file: Uint8Array): Acl[] {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const magic = view.getUint32(0, true);
  const little = magic === 0xa1b2c3d4 || magic === 0xa1b23c4d;
  if (!little && view.getUint32(0, false) !== 0xa1b2c3d4 && view.getUint32(0, false) !== 0xa1b23c4d) throw new Error('not a pcap file');
  const nano = (little ? magic : view.getUint32(0, false)) === 0xa1b23c4d;
  const linkType = view.getUint32(20, little);
  if (linkType !== 201 && linkType !== 187) throw new Error(`pcap link type ${linkType} is not Bluetooth H4 (187 or 201)`);
  const out: Acl[] = [];
  let at = 24;
  while (at + 16 <= file.length) {
    const time = view.getUint32(at, little) + view.getUint32(at + 4, little) / (nano ? 1e9 : 1e6);
    const caplen = view.getUint32(at + 8, little);
    const data = file.subarray(at + 16, at + 16 + caplen);
    at += 16 + caplen;
    let h4 = data;
    let sent = true;
    if (linkType === 201) {
      sent = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, false) === 0;
      h4 = data.subarray(4);
    }
    if (h4[0] === 0x02) out.push([time, sent, h4.subarray(1)]);
  }
  return out;
}

/** ATT values of LE ACL packets (L2CAP channel 4), with L2CAP fragments joined per connection handle and direction. */
export function attValues(acl: Acl[]): AttValue[] {
  const pending = new Map<string, { time: number; sent: boolean; want: number; parts: Uint8Array[]; have: number }>();
  const out: AttValue[] = [];
  const finish = (p: { time: number; sent: boolean; parts: Uint8Array[]; have: number }) => {
    const pdu = new Uint8Array(p.have);
    let o = 0;
    for (const part of p.parts) {
      pdu.set(part, o);
      o += part.length;
    }
    const cid = pdu[2] | (pdu[3] << 8);
    if (cid !== 4 || pdu.length < 7) return;
    const op = pdu[4];
    const handle = pdu[5] | (pdu[6] << 8);
    if (op === ATT_WRITE_CMD || op === ATT_WRITE_REQ || op === ATT_NOTIFY || op === ATT_INDICATE) {
      out.push({ time: p.time, fromPhone: op === ATT_WRITE_CMD || op === ATT_WRITE_REQ, handle, value: pdu.subarray(7) });
    }
  };
  for (const [time, sent, data] of acl) {
    if (data.length < 4) continue;
    const handle = (data[0] | (data[1] << 8)) & 0x0fff;
    const boundary = (data[1] >> 4) & 0x3;
    const payload = data.subarray(4);
    const key = `${handle}:${sent}`;
    if (boundary === 0x01) {
      const p = pending.get(key);
      if (!p) continue;
      p.parts.push(payload);
      p.have += payload.length;
    } else {
      if (payload.length < 4) continue;
      pending.set(key, { time, sent, want: (payload[0] | (payload[1] << 8)) + 4, parts: [payload], have: payload.length });
    }
    const p = pending.get(key);
    if (p && p.have >= p.want) {
      pending.delete(key);
      finish(p);
    }
  }
  return out;
}

/** Huawei TLV length: 7 bits per byte, high bit set on all but the last. */
function varint(bytes: Uint8Array, at: number): [value: number, size: number] {
  let value = 0;
  let size = 0;
  for (;;) {
    const b = bytes[at + size];
    if (b === undefined) return [-1, size];
    value = (value << 7) | (b & 0x7f);
    size++;
    if ((b & 0x80) === 0) return [value, size];
  }
}

/** Top-level TLV tags and value ranges of `bytes`, or null when it does not parse to its end. */
function tlv(bytes: Uint8Array): { tag: number; value: Uint8Array }[] | null {
  const out: { tag: number; value: Uint8Array }[] = [];
  let at = 0;
  while (at < bytes.length) {
    const tag = bytes[at];
    const [len, size] = varint(bytes, at + 1);
    if (len < 0 || at + 1 + size + len > bytes.length) return null;
    out.push({ tag, value: bytes.subarray(at + 1 + size, at + 1 + size + len) });
    at += 1 + size + len;
  }
  return out;
}

/** Frames of one direction's byte stream (ATT values in order); a frame may span values, and slices are joined. */
export function huaweiFrames(values: AttValue[]): HuaweiFrame[] {
  const frames: HuaweiFrame[] = [];
  for (const fromPhone of [true, false]) {
    let buf = new Uint8Array(0);
    let bufTime = 0;
    let slice: { time: number; service: number; command: number; parts: Uint8Array[] } | null = null;
    for (const v of values.filter((x) => x.fromPhone === fromPhone)) {
      if (buf.length === 0) bufTime = v.time;
      const joined = new Uint8Array(buf.length + v.value.length);
      joined.set(buf);
      joined.set(v.value, buf.length);
      buf = joined;
      for (;;) {
        const start = buf.indexOf(0x5a);
        if (start < 0) {
          buf = new Uint8Array(0);
          break;
        }
        if (start > 0) buf = buf.subarray(start);
        if (buf.length < 3) break;
        const total = 3 + ((buf[1] << 8) | buf[2]) + 2;
        if (buf.length < total) break;
        const frame = buf.subarray(0, total - 2);
        buf = buf.subarray(total);
        const kind = frame[3];
        if (kind === 0x00 && frame.length >= 6) {
          frames.push(describe(bufTime, fromPhone, frame[4], frame[5], frame.subarray(6), false));
        } else if (kind === 0x01 && frame.length >= 7) {
          slice = { time: bufTime, service: frame[5], command: frame[6], parts: [frame.subarray(7)] };
        } else if ((kind === 0x02 || kind === 0x03) && slice && frame.length >= 5) {
          slice.parts.push(frame.subarray(5));
          if (kind === 0x03) {
            const size = slice.parts.reduce((n, p) => n + p.length, 0);
            const body = new Uint8Array(size);
            let o = 0;
            for (const p of slice.parts) {
              body.set(p, o);
              o += p.length;
            }
            frames.push(describe(slice.time, fromPhone, slice.service, slice.command, body, true));
            slice = null;
          }
        }
        bufTime = v.time;
      }
    }
  }
  return frames.sort((a, b) => a.time - b.time);
}

function describe(time: number, fromPhone: boolean, service: number, command: number, body: Uint8Array, sliced: boolean): HuaweiFrame {
  const elements = tlv(body);
  const cipher = elements?.find((e) => e.tag === 0x7e);
  const encrypted = elements?.some((e) => e.tag === 0x7c) ?? false;
  const code = elements?.find((e) => e.tag === 0x7f);
  const result = !encrypted && code && code.value.length === 4 ? new DataView(code.value.buffer, code.value.byteOffset, 4).getUint32(0) : null;
  return { time, fromPhone, service, command, body, sliced, cipherLength: encrypted && cipher ? cipher.value.length : null, result };
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** One line per frame, the way section 4.3 reads them. */
export function formatFrame(f: HuaweiFrame, t0: number): string {
  const dir = f.fromPhone ? 'HH -> watch' : 'watch -> HH';
  const what =
    f.cipherLength !== null
      ? `7E ${f.cipherLength} bytes, plaintext ${f.cipherLength - 16} if GCM`
      : f.result !== null
        ? `answer ${f.result}${f.result === 100000 ? ' (OK)' : ''}`
        : `${f.body.length} body bytes, not encrypted`;
  return `${(f.time - t0).toFixed(3).padStart(9)} s  ${dir}  ${hex2(f.service)}/${hex2(f.command)}${f.sliced ? ' (sliced)' : ''}  ${what}`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) {
    console.error('usage: bun scripts/hh-notif-capture.ts <capture.pklg|capture.pcap> [--all]');
    process.exit(2);
  }
  const bytes = new Uint8Array(readFileSync(path));
  const magic = new DataView(bytes.buffer).getUint32(0, true);
  const acl = magic === 0xa1b2c3d4 || magic === 0xd4c3b2a1 || magic === 0xa1b23c4d || magic === 0x4d3cb2a1 ? readPcap(bytes) : readPacketLogger(bytes);
  const frames = huaweiFrames(attValues(acl));
  const shown = args.includes('--all') ? frames : frames.filter((f) => f.service === 0x02);
  const t0 = frames[0]?.time ?? 0;
  console.log(`${acl.length} ACL packets, ${frames.length} Huawei frames; ${shown.length} shown${args.includes('--all') ? '' : ' (service 0x02; --all for every service)'}`);
  for (const f of shown) console.log(formatFrame(f, t0));
  const switches = frames.filter((f) => f.service === 0x02 && f.command === 0x0b && f.fromPhone);
  console.log(
    switches.length > 0
      ? `02/0B from HH: ${switches.length}. Compare the plaintext lengths with the table in section 4.3 (bundle id: n + 9, appid "1": 10).`
      : 'No 02/0B from HH. Rerun with --all and look at what HH sent at the moments you toggled an app.',
  );
}
