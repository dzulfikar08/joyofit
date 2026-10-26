#!/usr/bin/env python3
"""Uploads built watch maps to JoyoFit's R2 bucket and rewrites the catalog the app reads (`GET /v1/maps`, server/src/maps.ts).

    tools/offline-maps/publish.py --all            every region build_all.py finished (out/state/), oversize parts left out
    tools/offline-maps/publish.py <map id> ...     these maps (out/<id>.bin + out/<id>.json, e.g. from build-map.sh)
    options: --out DIR, --dry-run, --bucket NAME (default joyofit-maps, or $MAPS_BUCKET)

- A map whose SHA-256 is already in the catalog is not uploaded again (a monthly run uploads only what changed).
- `watch/catalog.json` is written last, so it never lists a file that is not there yet; files of maps that left the catalog (a region now
  split into parts, or no longer split) are deleted after it.
- Catalog entries of JoyoFit ids (2·10^18 + part·10^4 + BPS code) that lack code/province/kind get them from regions.json.
- Uses `bunx wrangler r2 object …` from server/ (needs `bun install` there and a wrangler login or CLOUDFLARE_API_TOKEN with R2 write).
The bucket also holds the bike computer's PMTiles (docs/bike-computer.md); this only touches `watch/`.
"""
from __future__ import annotations

import argparse
import datetime
import glob
import json
import os
import subprocess
import sys
import tempfile
from typing import Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.normpath(os.path.join(HERE, "..", "..", "server"))
CATALOG_KEY = "watch/catalog.json"
ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0"
ID_BASE = 2_000_000_000_000_000_000
# wrangler is logged into several accounts on the owner's Mac and fails non-interactively without this (the JoyoFit account).
ACCOUNT = "b7e6f8457bd39fa37a7eea5249799754"


def wrangler(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    env = {**os.environ, "CLOUDFLARE_ACCOUNT_ID": os.environ.get("CLOUDFLARE_ACCOUNT_ID", ACCOUNT)}
    return subprocess.run(["bunx", "wrangler", *args], cwd=SERVER, env=env, check=check, capture_output=not check, text=True)


def read_remote_catalog(bucket: str) -> List[dict]:
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "catalog.json")
        result = wrangler("r2", "object", "get", f"{bucket}/{CATALOG_KEY}", "--file", path, "--remote", check=False)
        if result.returncode != 0 or not os.path.exists(path):
            print("publish: no catalog in the bucket yet")
            return []
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f).get("maps", [])
        except ValueError:
            print("publish: the bucket's catalog is not JSON; starting a new one")
            return []


def load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def local_entries(out: str, ids: List[str], everything: bool) -> tuple[List[dict], Dict[str, List[str]]]:
    """The entries to publish, and code → its current ids (only for regions built by build_all.py)."""
    entries: List[dict] = []
    current: Dict[str, List[str]] = {}
    if everything:
        for path in sorted(glob.glob(os.path.join(out, "state", "*.json"))):
            state = load_json(path)
            if state.get("status") != "ok":
                continue
            current[state["code"]] = state["ids"]
            for map_id in state["ids"]:
                if map_id in state.get("oversize", []):
                    print(f"publish: leaving out {map_id} ({state['name']}): above the size cap")
                    continue
                entries.append(load_json(os.path.join(out, f"{map_id}.json")))
    for map_id in ids:
        if not map_id.isdigit():
            sys.exit(f"publish: not a map id: {map_id}")
        for ext in (".bin", ".json"):
            path = os.path.join(out, map_id + ext)
            if not os.path.exists(path) or os.path.getsize(path) == 0:
                sys.exit(f"publish: missing {path} (run build-map.sh or build-all.sh)")
        entries.append(load_json(os.path.join(out, f"{map_id}.json")))
    return entries, current


def code_of(map_id: str) -> Optional[str]:
    value = int(map_id) - ID_BASE
    if value < 0 or value >= 10_000 * 100:
        return None
    return f"{value % 10_000:04d}"


def enrich(entry: dict, regions: Dict[str, dict]) -> dict:
    """Adds code, province and kind to an entry of a JoyoFit id that lacks them (maps built by build-map.sh, e.g. the lab's Surabaya)."""
    if all(entry.get(k) for k in ("code", "province", "kind")):
        return entry
    code = code_of(entry["id"])
    region = regions.get(code or "")
    if not region:
        return entry
    enriched = {"id": entry["id"], "name": entry["name"], "code": code, "province": region["province"], "kind": region["kind"]}
    enriched.update({k: v for k, v in entry.items() if k not in enriched})
    return enriched


def main(argv: Optional[List[str]] = None) -> None:
    p = argparse.ArgumentParser(description="Publish watch maps to R2 and rewrite watch/catalog.json")
    p.add_argument("ids", nargs="*")
    p.add_argument("--all", action="store_true", help="every region build_all.py finished")
    p.add_argument("--out", default=os.path.join(HERE, "out"))
    p.add_argument("--bucket", default=os.environ.get("MAPS_BUCKET", "joyofit-maps"))
    p.add_argument("--dry-run", action="store_true", help="show what would change, upload nothing")
    args = p.parse_args(argv)
    if not args.all and not args.ids:
        p.error("give map ids or --all")

    with open(os.path.join(HERE, "regions.json"), encoding="utf-8") as f:
        regions = {r["code"]: r for r in json.load(f)["regions"]}
    entries, current = local_entries(args.out, args.ids, args.all)
    remote = read_remote_catalog(args.bucket)
    by_id = {m["id"]: m for m in remote if "id" in m}

    uploads = [e for e in entries if by_id.get(e["id"], {}).get("sha256") != e["sha256"]]
    unchanged = len(entries) - len(uploads)
    # Maps of a rebuilt region that are no longer its maps (split differently than last time).
    dropped = [m["id"] for m in remote if code_of(m["id"]) in current and m["id"] not in current[code_of(m["id"])]]
    print(f"publish: {len(entries)} maps, {len(uploads)} to upload ({sum(e['sizeBytes'] for e in uploads) / 1048576:.1f} MiB), "
          f"{unchanged} unchanged, {len(dropped)} to drop")

    catalog = {m["id"]: m for m in remote if m.get("id") not in dropped}
    for entry in entries:
        catalog[entry["id"]] = entry
    maps = sorted((enrich(m, regions) for m in catalog.values()),
                  key=lambda m: (m.get("province", ""), m.get("code", ""), m.get("part", {}).get("index", 0), m["name"]))
    document = {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "attribution": ATTRIBUTION,
        "maps": maps,
    }
    local_catalog = os.path.join(args.out, "catalog.json")
    os.makedirs(args.out, exist_ok=True)
    with open(local_catalog, "w", encoding="utf-8") as f:
        json.dump(document, f, ensure_ascii=False, indent=1)
        f.write("\n")
    if args.dry_run:
        for e in uploads:
            print(f"publish: would upload {e['id']}.bin ({e['name']}, {e['sizeBytes']} bytes)")
        for map_id in dropped:
            print(f"publish: would drop {map_id}")
        print(f"publish: dry run; the catalog would list {len(maps)} maps ({local_catalog})")
        return

    for i, entry in enumerate(uploads, start=1):
        print(f"publish: [{i}/{len(uploads)}] uploading {entry['id']}.bin ({entry['name']}, {entry['sizeBytes']} bytes)", flush=True)
        wrangler("r2", "object", "put", f"{args.bucket}/watch/{entry['id']}.bin", "--file", os.path.join(args.out, f"{entry['id']}.bin"),
                 "--content-type", "application/octet-stream", "--remote")
    wrangler("r2", "object", "put", f"{args.bucket}/{CATALOG_KEY}", "--file", local_catalog, "--content-type", "application/json",
             "--remote")
    for map_id in dropped:
        wrangler("r2", "object", "delete", f"{args.bucket}/watch/{map_id}.bin", "--remote", check=False)
    total = sum(m.get("sizeBytes", 0) for m in maps)
    print(f"publish: catalog lists {len(maps)} maps, {total / 1048576:.1f} MiB in all. Check: curl -s https://api.fit.joyorogo.com/v1/maps")


if __name__ == "__main__":
    main()
