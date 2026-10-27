#!/usr/bin/env python3
"""Reads an `offvmp` map file's header and writes its catalog entry (`<id>.json`, the shape `publish.py` uploads and `GET /v1/maps`
serves). Used by build-map.sh (one map) and build_all.py (every region).

    python mapinfo.py <file.bin> --id ID --bbox W,S,E,N --osm-date DATE [--name NAME] [--code C --province P --kind K]

Header layout (docs/offline-maps.md "The on-watch format"): magic `offvmp`, u32 LE version at 6, u32 LE index offset at 10, region name
(UTF-8, 511 bytes, zero padded) at 0x3F; the index starts with a u32 bitmap of the zoom levels.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import struct
import sys
from typing import List, Optional

NAME_OFFSET = 0x3F
NAME_BYTES = 511


def read_header(path: str) -> dict:
    with open(path, "rb") as f:
        head = f.read(0x440)
        if head[:6] != b"offvmp":
            raise ValueError(f"{path}: no offvmp header")
        version, index = struct.unpack_from("<II", head, 6)
        f.seek(index)
        flags = struct.unpack("<I", f.read(4))[0]
    name = head[NAME_OFFSET:NAME_OFFSET + NAME_BYTES].split(b"\0", 1)[0].decode("utf-8")
    return {"version": version, "name": name, "zooms": [z for z in range(32) if flags >> z & 1]}


def sha256_of(path: str) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest().upper(), size


def set_name(path: str, name: str) -> None:
    """Rewrites the header's region name (what the converter's `--country` writes): used for the parts of a split region, whose
    "n/N" is known only once every part is built."""
    raw = name.encode("utf-8")[:NAME_BYTES - 1]
    with open(path, "r+b") as f:
        if f.read(6) != b"offvmp":
            raise ValueError(f"{path}: no offvmp header")
        f.seek(NAME_OFFSET)
        f.write(raw + b"\0" * (NAME_BYTES - len(raw)))


def version_of(osm_date: str) -> int:
    """The header version for maps built from an extract of `osm_date` ("2026-10-25T21:21:21Z" → 26102521): YYMMDDHH like the
    converter's own build-time stamp, but the same for every build of the same extract, so a rebuild is byte-identical (the converter is
    otherwise deterministic) and publish.py skips it by SHA-256."""
    t = datetime.datetime.strptime(osm_date, "%Y-%m-%dT%H:%M:%SZ")
    return (t.year % 100) * 1_000_000 + t.month * 10_000 + t.day * 100 + t.hour


def set_version(path: str, version: int) -> None:
    with open(path, "r+b") as f:
        if f.read(6) != b"offvmp":
            raise ValueError(f"{path}: no offvmp header")
        f.write(struct.pack("<I", version))


def catalog_entry(path: str, map_id: str, bbox: List[float], osm_date: str, name: Optional[str] = None,
                  code: Optional[str] = None, province: Optional[str] = None, kind: Optional[str] = None,
                  part: Optional[dict] = None) -> dict:
    header = read_header(path)
    sha, size = sha256_of(path)
    entry = {"id": map_id, "name": name or header["name"]}
    if code is not None:
        entry.update({"code": code, "province": province, "kind": kind})
    if part is not None:
        entry["part"] = part
    entry.update({
        "bbox": [round(v, 4) for v in bbox],
        "sizeBytes": size,
        "sha256": sha,
        "version": header["version"],
        "builtAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "osmDate": osm_date,
    })
    return entry


def write_entry(path: str, entry: dict) -> str:
    out = path[:-4] + ".json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(entry, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return out


def main(argv: Optional[List[str]] = None) -> None:
    p = argparse.ArgumentParser(description="offvmp header and catalog entry")
    p.add_argument("bin")
    p.add_argument("--id", required=True)
    p.add_argument("--bbox", required=True, help="west,south,east,north")
    p.add_argument("--osm-date", default="")
    p.add_argument("--name")
    p.add_argument("--code")
    p.add_argument("--province")
    p.add_argument("--kind", choices=["kota", "kabupaten"])
    args = p.parse_args(argv)
    header = read_header(args.bin)
    entry = catalog_entry(args.bin, args.id, [float(v) for v in args.bbox.split(",")], args.osm_date, args.name,
                          args.code, args.province, args.kind)
    print(f"{args.bin}: {entry['sizeBytes']} bytes ({-(-entry['sizeBytes'] // 1048576)} MB announced), offvmp version "
          f"{header['version']}, region {header['name']!r}, zooms {header['zooms']}")
    print(f"sha256 {entry['sha256']}")
    print(f"catalog entry {write_entry(args.bin, entry)}")


if __name__ == "__main__":
    sys.exit(main())
