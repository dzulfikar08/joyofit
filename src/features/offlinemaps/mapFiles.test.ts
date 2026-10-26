import { describe, expect, test } from 'bun:test';

import type { CatalogMap } from './catalog';
import { downloadMap, localFile, removeFromPhone, storedMap, type MapDir } from './mapFiles';

const SHA = 'CC4743B41FD3CB1C231373D812E72A4B5298876685628CEB853D26DFEAAF5CE9';
const MAP: CatalogMap = {
  id: '2000000000000003578',
  name: 'Surabaya (lab)',
  bbox: [112.57, -7.37, 112.87, -7.17],
  sizeBytes: 12,
  sha256: SHA,
  version: 26102611,
  builtAt: '',
  osmDate: '',
  attribution: '© OpenStreetMap contributors',
};
const ROOT = 'file:///data/user/0/com.joyodigitama.joyofit/files/offline-maps/';

/** An in-memory folder with the same contract as the expo-file-system one; `files` is its content. */
type MemoryDir = MapDir & { files: Map<string, string> };

function memoryDir(): MemoryDir {
  const files = new Map<string, string>();
  return {
    files,
    uri: (name) => ROOT + name,
    size: (name) => (files.has(name) ? files.get(name)!.length : null),
    readText: (name) => {
      const text = files.get(name);
      if (text === undefined) throw new Error(`ENOENT ${name}`);
      return text;
    },
    writeText: (name, text) => void files.set(name, text),
    remove: (name) => void files.delete(name),
    move: (from, to) => {
      const text = files.get(from);
      if (text === undefined) throw new Error(`ENOENT ${from}`);
      files.delete(from);
      files.set(to, text);
    },
  };
}

/** What the native read sees: the file at `uri` must exist in the folder. */
function inspector(dir: MemoryDir, sha = SHA) {
  const seen: string[] = [];
  const inspect = async (uri: string, name: string) => {
    seen.push(uri);
    const file = uri.slice(ROOT.length);
    expect(dir.files.has(file)).toBe(true);
    return { sha256: sha, bytes: dir.files.get(file)!.length, mapId: name.replace('.bin', '') };
  };
  return { seen, inspect };
}

describe('offline map files', () => {
  test('a verified download is kept under <id>.bin, at exactly the URI the send reads (lab.8 deleted it after the move)', async () => {
    const dir = memoryDir();
    const { seen, inspect } = inspector(dir);
    const stored = await downloadMap(dir, MAP, async (name) => void dir.files.set(name, 'x'.repeat(12)), inspect);
    expect(seen).toEqual([`${ROOT}2000000000000003578.bin.part`]);
    expect([...dir.files.keys()].sort()).toEqual(['2000000000000003578.bin', '2000000000000003578.json']);
    expect(storedMap(dir, MAP.id)).toEqual(stored);
    const local = localFile(dir, MAP.id);
    expect(local).toEqual({ uri: `${ROOT}2000000000000003578.bin`, name: '2000000000000003578.bin' });
    expect(dir.size(local.uri.slice(ROOT.length))).toBe(12);
  });

  test('a file that does not match the catalog is not kept, and neither is an older copy record', async () => {
    const dir = memoryDir();
    dir.files.set('2000000000000003578.json', '{}');
    const { inspect } = inspector(dir, 'A'.repeat(64));
    await expect(downloadMap(dir, MAP, async (name) => void dir.files.set(name, 'x'.repeat(12)), inspect)).rejects.toThrow('does not match');
    expect(dir.files.has('2000000000000003578.bin.part')).toBe(false);
    expect(storedMap(dir, MAP.id)).toBeNull();
  });

  test('a failed download leaves no part file', async () => {
    const dir = memoryDir();
    const { inspect } = inspector(dir);
    await expect(
      downloadMap(dir, MAP, async (name) => {
        dir.files.set(name, 'xx');
        throw new Error('network');
      }, inspect),
    ).rejects.toThrow('network');
    expect(dir.files.size).toBe(0);
  });

  test('"on the phone" needs the file itself with the recorded size, not just the record', async () => {
    const dir = memoryDir();
    const { inspect } = inspector(dir);
    await downloadMap(dir, MAP, async (name) => void dir.files.set(name, 'x'.repeat(12)), inspect);
    dir.files.delete('2000000000000003578.bin');
    expect(storedMap(dir, MAP.id)).toBeNull();
    dir.files.set('2000000000000003578.bin', 'short');
    expect(storedMap(dir, MAP.id)).toBeNull();
    dir.files.set('2000000000000003578.bin', 'x'.repeat(12));
    expect(storedMap(dir, MAP.id)?.sha256).toBe(SHA);
    dir.files.set('2000000000000003578.json', 'not json');
    expect(storedMap(dir, MAP.id)).toBeNull();
  });

  test('delete from phone removes file and record', async () => {
    const dir = memoryDir();
    const { inspect } = inspector(dir);
    await downloadMap(dir, MAP, async (name) => void dir.files.set(name, 'x'.repeat(12)), inspect);
    removeFromPhone(dir, MAP.id);
    expect(dir.files.size).toBe(0);
  });
});
