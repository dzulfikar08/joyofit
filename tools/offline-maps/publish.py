#!/usr/bin/env python3
"""Uploads built watch maps to JoyoFit's R2 bucket and rewrites the catalog the app reads (`GET /v1/maps`, server/src/maps.ts).

    tools/offline-maps/publish.py --all            every region build_all.py finished (out/state/), oversize parts left out
    tools/offline-maps/publish.py <map id> ...     these maps (out/<id>.bin + out/<id>.json, e.g. from build-map.sh)
    options: --out DIR, --dry-run, --bucket NAME (default joyofit-maps, or $MAPS_BUCKET), --upload-only, --catalog-only

- A map whose SHA-256 is already in the catalog is not uploaded again (a run on the same extract uploads nothing).
- Two phases: upload the changed `.bin` files (each one done leaves `out/published/<id>.sha256`), then write `watch/catalog.json`
  once, listing a map's new entry only when its file is in the bucket (unchanged, or its marker names its SHA-256); a map whose upload
  failed keeps its previous entry. Files of maps that left the catalog (a region now split differently) are deleted after it, only for
  regions whose maps all made it. Exit code 1 when an upload failed.
- `--upload-only` / `--catalog-only` run one phase: the GitHub workflow uploads in each province shard and writes the catalog once in a
  final job from the shards' `out/` (state, entries, markers; no `.bin` needed), so a failed shard keeps its regions' previous entries.
- Catalog entries of JoyoFit ids (2·10^18 + part·10^4 + BPS code) that lack code/province/kind get them from regions.json.
- Uses `bunx wrangler r2 object …` from server/ (needs `bun install` there and a wrangler login or CLOUDFLARE_API_TOKEN with R2 write).
  `--dry-run` without CLOUDFLARE_API_TOKEN reads the catalog from the public API instead, so it needs no credentials.
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
import urllib.request
from typing import Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.normpath(os.path.join(HERE, "..", "..", "server"))
CATALOG_KEY = "watch/catalog.json"
ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0"
PUBLIC_CATALOG = "https://api.fit.joyorogo.com/v1/maps"
ID_BASE = 2_000_000_000_000_000_000
# wrangler is logged into several accounts on the owner's Mac and fails non-interactively without this (the JoyoFit account).
ACCOUNT = "b7e6f8457bd39fa37a7eea5249799754"


def wrangler(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    env = {**os.environ, "CLOUDFLARE_ACCOUNT_ID": os.environ.get("CLOUDFLARE_ACCOUNT_ID", ACCOUNT)}
    return subprocess.run(["bunx", "wrangler", *args], cwd=SERVER, env=env, check=check, capture_output=not check, text=True)


def read_remote_catalog(bucket: str, public: bool) -> List[dict]:
    """The bucket's catalog entries. A missing catalog is an empty list; any other failure stops the run, because writing a catalog
    from an empty list would drop every region this run did not build."""
    if public:
        # Cloudflare answers 403 to urllib's default User-Agent.
        request = urllib.request.Request(PUBLIC_CATALOG, headers={"User-Agent": "JoyoFit-offline-maps/1.0 (tools/offline-maps/publish.py)"})
        with urllib.request.urlopen(request, timeout=60) as response:
            maps = json.load(response)
        print(f"publish: read {len(maps)} entries from {PUBLIC_CATALOG} (dry run without CLOUDFLARE_API_TOKEN)")
        return [{k: v for k, v in m.items() if k != "attribution"} for m in maps]
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "catalog.json")
        result = wrangler("r2", "object", "get", f"{bucket}/{CATALOG_KEY}", "--file", path, "--remote", check=False)
        if result.returncode != 0 or not os.path.exists(path):
            output = f"{result.stdout}\n{result.stderr}"
            if "The specified key does not exist" in output:
                print("publish: no catalog in the bucket yet")
                return []
            sys.exit(f"publish: cannot read {bucket}/{CATALOG_KEY} (wrangler exited {result.returncode}):\n{output.strip()}")
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f).get("maps", [])
        except ValueError:
            sys.exit(f"publish: {bucket}/{CATALOG_KEY} is not JSON; fix or delete it first")


def load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def local_entries(out: str, ids: List[str], everything: bool, need_bins: bool) -> tuple[List[dict], Dict[str, List[str]]]:
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
        for ext in (".bin", ".json") if need_bins else (".json",):
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


def marker(out: str, map_id: str) -> str:
    return os.path.join(out, "published", f"{map_id}.sha256")


def upload(args, uploads: List[dict]) -> List[str]:
    """Uploads each map, leaving its marker when done; returns the ids that failed."""
    failed = []
    os.makedirs(os.path.join(args.out, "published"), exist_ok=True)
    for i, entry in enumerate(uploads, start=1):
        map_id = entry["id"]
        if args.dry_run:
            print(f"publish: would upload {map_id}.bin ({entry['name']}, {entry['sizeBytes']} bytes)")
            continue
        print(f"publish: [{i}/{len(uploads)}] uploading {map_id}.bin ({entry['name']}, {entry['sizeBytes']} bytes)", flush=True)
        result = wrangler("r2", "object", "put", f"{args.bucket}/watch/{map_id}.bin", "--file", os.path.join(args.out, f"{map_id}.bin"),
                          "--content-type", "application/octet-stream", "--remote", check=False)
        if result.returncode != 0:
            print(f"publish: FAILED to upload {map_id}.bin; its previous entry stays in the catalog\n{result.stderr.strip()}")
            failed.append(map_id)
            continue
        with open(marker(args.out, map_id), "w", encoding="utf-8") as f:
            f.write(entry["sha256"] + "\n")
    return failed


def in_bucket(args, entry: dict, remote_by_id: Dict[str, dict]) -> bool:
    """Whether the bucket holds this entry's file: unchanged, uploaded by this or an earlier phase (marker), or a dry run."""
    if args.dry_run or remote_by_id.get(entry["id"], {}).get("sha256") == entry["sha256"]:
        return True
    try:
        with open(marker(args.out, entry["id"]), encoding="utf-8") as f:
            return f.read().strip() == entry["sha256"]
    except OSError:
        return False


def write_catalog(args, entries: List[dict], current: Dict[str, List[str]], remote: List[dict], regions: Dict[str, dict]) -> None:
    by_id = {m["id"]: m for m in remote if "id" in m}
    ready = [e for e in entries if in_bucket(args, e, by_id)]
    missing = {e["id"] for e in entries} - {e["id"] for e in ready}
    for map_id in sorted(missing):
        print(f"publish: {map_id}.bin is not in the bucket; {'its previous entry stays' if map_id in by_id else 'left out'}")
    # Maps of a rebuilt region that are no longer its maps (split differently than last time), for regions whose maps all made it.
    complete = {code for code, ids in current.items() if not missing.intersection(ids)}
    dropped = [m["id"] for m in remote if code_of(m["id"]) in complete and m["id"] not in current[code_of(m["id"])]]

    catalog = {m["id"]: m for m in remote if m.get("id") not in dropped}
    for entry in ready:
        catalog[entry["id"]] = entry
    maps = sorted((enrich(m, regions) for m in catalog.values()),
                  key=lambda m: (m.get("province", ""), m.get("code", ""), m.get("part", {}).get("index", 0), m["name"]))
    changed = sum(1 for e in ready if by_id.get(e["id"]) != e)
    print(f"publish: catalog: {len(maps)} maps, {changed} new or changed entries, {len(dropped)} dropped")
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
    total = sum(m.get("sizeBytes", 0) for m in maps)
    if args.dry_run:
        for map_id in dropped:
            print(f"publish: would drop {map_id}")
        print(f"publish: dry run; the catalog would list {len(maps)} maps, {total / 1048576:.1f} MiB ({local_catalog})")
        return
    # One PUT replaces the object as a whole: a reader sees the old catalog or the new one, never a mix.
    wrangler("r2", "object", "put", f"{args.bucket}/{CATALOG_KEY}", "--file", local_catalog, "--content-type", "application/json",
             "--remote")
    for map_id in dropped:
        wrangler("r2", "object", "delete", f"{args.bucket}/watch/{map_id}.bin", "--remote", check=False)
    print(f"publish: catalog lists {len(maps)} maps, {total / 1048576:.1f} MiB in all. Check: curl -s {PUBLIC_CATALOG}")


def main(argv: Optional[List[str]] = None) -> None:
    p = argparse.ArgumentParser(description="Publish watch maps to R2 and rewrite watch/catalog.json")
    p.add_argument("ids", nargs="*")
    p.add_argument("--all", action="store_true", help="every region build_all.py finished")
    p.add_argument("--out", default=os.path.join(HERE, "out"))
    p.add_argument("--bucket", default=os.environ.get("MAPS_BUCKET", "joyofit-maps"))
    p.add_argument("--dry-run", action="store_true", help="show what would change, upload nothing")
    phase = p.add_mutually_exclusive_group()
    phase.add_argument("--upload-only", action="store_true", help="upload changed maps, leave the catalog as it is")
    phase.add_argument("--catalog-only", action="store_true", help="write the catalog for maps already uploaded (no .bin needed)")
    args = p.parse_args(argv)
    if not args.all and not args.ids:
        p.error("give map ids or --all")

    with open(os.path.join(HERE, "regions.json"), encoding="utf-8") as f:
        regions = {r["code"]: r for r in json.load(f)["regions"]}
    entries, current = local_entries(args.out, args.ids, args.all, need_bins=not args.catalog_only)
    remote = read_remote_catalog(args.bucket, public=args.dry_run and not os.environ.get("CLOUDFLARE_API_TOKEN"))
    by_id = {m["id"]: m for m in remote if "id" in m}

    failed: List[str] = []
    if not args.catalog_only:
        uploads = [e for e in entries if by_id.get(e["id"], {}).get("sha256") != e["sha256"]]
        print(f"publish: {len(entries)} maps, {len(uploads)} to upload ({sum(e['sizeBytes'] for e in uploads) / 1048576:.1f} MiB), "
              f"{len(entries) - len(uploads)} unchanged")
        failed = upload(args, uploads)
    if not args.upload_only:
        write_catalog(args, entries, current, remote, regions)
    if failed:
        sys.exit(f"publish: {len(failed)} uploads failed: {', '.join(failed)}")


if __name__ == "__main__":
    main()
