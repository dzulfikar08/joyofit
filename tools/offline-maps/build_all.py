#!/usr/bin/env python3
"""Builds the offline watch map of every Indonesian Kabupaten/Kota (regions.json) from one Geofabrik extract. Run it through
build-all.sh, which pins the converter, prepares the Python environment and downloads the extract (README.md, "All regions").

Per region: the OSM boundary from this extract (regions.py) plus a buffer → `osmium extract` (many regions per pass over the extract)
→ the pinned converter → `out/<id>.bin` + `out/<id>.json` (catalog entry: size, SHA-256, header version, OSM date) + `out/state/<code>.json`.

- Resumable and incremental: a region whose state names the same OSM date and recipe (converter commit, zooms, languages, buffer, size
  cap) and whose files are all there is skipped; `--force` rebuilds. Killing the run loses only the regions in progress.
- Parallel: `--jobs` conversions at once (each needs up to a few GB of RAM for a dense region, see README.md), while the next batch is cut.
- Size cap: a region whose cut is above `--split-pbf-mib` or whose map is above `--max-mib` (the app's lab sends at most 64 MiB) is cut in
  two halves across its longer side, again and again up to `--max-depth`; the parts get ids 2·10^18 + part·10^4 + code and names
  "<name> n/N". A part still above the cap after that is flagged `oversize` and publish.py leaves it out.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime
import json
import math
import os
import shutil
import subprocess
import sys
import threading
import time
from typing import List, Optional

from shapely.geometry import box

import mapinfo
import regions as regionlib

HERE = os.path.dirname(os.path.abspath(__file__))
ZOOMS = "10,12,14,16"
LANGS = "id,en"
MIB = 1 << 20

print_lock = threading.Lock()


def log(message: str) -> None:
    with print_lock:
        print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def run(cmd: List[str], logfile: str) -> None:
    with open(logfile, "a", encoding="utf-8") as f:
        f.write(f"$ {' '.join(cmd)}\n")
        f.flush()
        result = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT)
    if result.returncode != 0:
        raise RuntimeError(f"{os.path.basename(cmd[0])} exited {result.returncode} (log: {logfile})")


def cut(pbf: str, jobs: List[tuple], workdir: str, logfile: str) -> None:
    """One pass over `pbf` writing every (polygon file, output) of `jobs` (`osmium extract --config`)."""
    config = os.path.join(workdir, f"extract-{threading.get_ident()}-{time.monotonic_ns()}.json")
    with open(config, "w", encoding="utf-8") as f:
        json.dump({"extracts": [{"output": out, "polygon": {"file_name": poly, "file_type": "poly"}} for poly, out in jobs]}, f)
    try:
        run(["osmium", "extract", "--overwrite", "--strategy", "complete_ways", "-c", config, pbf], logfile)
    finally:
        os.remove(config)


def pre_cut(pbf: str, regions: List[dict], osm_date: str, workdir: str) -> str:
    """One pass over the extract writing the box around `regions` (their relations' boxes from regions.json plus 0.05°, about 5.5 km,
    more than the buffer), also with complete ways: every way that touches a region's polygon touches the box, so it is in the smaller
    file with all its nodes, and so are the region relations' members. The boundary pass and the region cuts then read this file."""
    boxes = [r["bbox"] for r in regions]
    margin = 0.05
    bbox = (min(b[0] for b in boxes) - margin, min(b[1] for b in boxes) - margin,
            max(b[2] for b in boxes) + margin, max(b[3] for b in boxes) + margin)
    out = os.path.join(workdir, "selection.osm.pbf")
    log(f"cutting the box {','.join(f'{v:.4f}' for v in bbox)} around the {len(regions)} regions from the extract")
    run(["osmium", "extract", "--overwrite", "--strategy", "complete_ways", "-b", ",".join(f"{v:.4f}" for v in bbox),
         "--output-header", f"osmosis_replication_timestamp={osm_date}", "-o", out, pbf], os.path.join(workdir, "cut.log"))
    return out


def halves(geometry):
    """The two halves of `geometry` across the middle of its bbox's longer side (in km, so east-west degrees count less away from the
    equator); empty halves are dropped."""
    w, s, e, n = geometry.bounds
    lat = math.radians((s + n) / 2)
    if (e - w) * math.cos(lat) >= n - s:
        mid = (w + e) / 2
        boxes = [box(w, s, mid, n), box(mid, s, e, n)]
    else:
        mid = (s + n) / 2
        boxes = [box(w, s, e, mid), box(w, mid, e, n)]
    return [g for g in (geometry.intersection(b) for b in boxes) if not g.is_empty and g.area > 0]


class Builder:
    def __init__(self, args, osm_date: str):
        self.args = args
        self.osm_date = osm_date
        self.out = args.out
        self.state_dir = os.path.join(args.out, "state")
        self.work = os.path.join(args.out, "work")
        self.max_bytes = int(args.max_mib * MIB)
        self.split_pbf = int(args.split_pbf_mib * MIB)
        self.recipe = (f"converter {args.converter_commit}; zooms {ZOOMS}; langs {LANGS}; buffer {args.buffer_km:g} km; "
                       f"max {args.max_mib:g} MiB; split pbf {args.split_pbf_mib:g} MiB; depth {args.max_depth}")
        os.makedirs(self.state_dir, exist_ok=True)
        os.makedirs(self.work, exist_ok=True)

    # State -------------------------------------------------------------------------------------------------------------------------

    def state_path(self, code: str) -> str:
        return os.path.join(self.state_dir, f"{code}.json")

    def read_state(self, code: str) -> Optional[dict]:
        try:
            with open(self.state_path(code), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def up_to_date(self, region: dict) -> bool:
        state = self.read_state(region["code"])
        if not state or state.get("status") != "ok" or state.get("osmDate") != self.osm_date or state.get("recipe") != self.recipe:
            return False
        for map_id, size in zip(state["ids"], state["sizes"]):
            path = os.path.join(self.out, f"{map_id}.bin")
            if not os.path.exists(path) or os.path.getsize(path) != size or not os.path.exists(path[:-4] + ".json"):
                return False
        return True

    def write_state(self, code: str, state: dict) -> None:
        tmp = self.state_path(code) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=1)
            f.write("\n")
        os.replace(tmp, self.state_path(code))

    # One region ---------------------------------------------------------------------------------------------------------------------

    def convert(self, pbf: str, name: str, target: str, logfile: str) -> int:
        geojson = target[:-4] + ".geojson"
        try:
            run([os.path.join(self.args.converter, "scripts", "extract_geojson.sh"), pbf, geojson], logfile)
            run([sys.executable, os.path.join(self.args.converter, "build_country.py"), geojson, "--out", target, "--country", name,
                 "--zooms", ZOOMS, "--langs", LANGS, "--default-lang", "id"], logfile)
            # The converter stamps the build hour; the extract's date makes a rebuild of the same extract byte-identical.
            mapinfo.set_version(target, mapinfo.version_of(self.osm_date))
        finally:
            if os.path.exists(geojson):
                os.remove(geojson)
        return os.path.getsize(target)

    def build_region(self, region: dict, geometry, region_pbf: str, exact: bool) -> dict:
        code, name = region["code"], region["name"]
        rdir = os.path.dirname(region_pbf)
        logfile = os.path.join(rdir, "build.log")
        started = time.monotonic()
        leaves: List[tuple] = []  # (geometry, bin path, size)
        splits = 0

        def make(geom, pbf: str, depth: int, tag: str) -> None:
            nonlocal splits
            if os.path.getsize(pbf) > self.split_pbf and depth < self.args.max_depth:
                return split(geom, pbf, depth, tag)
            target = os.path.join(rdir, f"{tag}.bin")
            size = self.convert(pbf, name, target, logfile)
            if size > self.max_bytes and depth < self.args.max_depth:
                os.remove(target)
                return split(geom, pbf, depth, tag)
            leaves.append((geom, target, size))

        def split(geom, pbf: str, depth: int, tag: str) -> None:
            nonlocal splits
            splits += 1
            parts = halves(geom)
            jobs = []
            for i, part in enumerate(parts):
                poly = os.path.join(rdir, f"{tag}{i}.poly")
                regionlib.write_poly(part, poly, f"{code}-{tag}{i}")
                jobs.append((poly, os.path.join(rdir, f"{tag}{i}.osm.pbf")))
            cut(pbf, jobs, rdir, logfile)
            for i, part in enumerate(parts):
                make(part, jobs[i][1], depth + 1, f"{tag}{i}")

        make(geometry, region_pbf, 0, "r")

        previous = self.read_state(code) or {}
        ids, sizes, oversize = [], [], []
        count = len(leaves)
        for index, (geom, path, size) in enumerate(leaves, start=1):
            if count == 1:
                map_id, label, part = regionlib.map_id(code), name, None
            else:
                map_id, label, part = regionlib.map_id(code, index), f"{name} {index}/{count}", {"index": index, "count": count}
                mapinfo.set_name(path, label)
            final = os.path.join(self.out, f"{map_id}.bin")
            os.replace(path, final)
            entry = mapinfo.catalog_entry(final, map_id, list(geom.bounds), self.osm_date, label, code, region["province"],
                                          region["kind"], part)
            mapinfo.write_entry(final, entry)
            ids.append(map_id)
            sizes.append(entry["sizeBytes"])
            if size > self.max_bytes:
                oversize.append(map_id)
        for old in set(previous.get("ids", [])) - set(ids):
            for ext in (".bin", ".json"):
                path = os.path.join(self.out, f"{old}{ext}")
                if os.path.exists(path):
                    os.remove(path)
        state = {
            "code": code, "name": name, "status": "ok", "osmDate": self.osm_date, "recipe": self.recipe, "ids": ids, "sizes": sizes,
            "oversize": oversize, "splits": splits, "boundary": "relation" if exact else "member bbox",
            "seconds": round(time.monotonic() - started, 1),
            "builtAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        self.write_state(code, state)
        if not self.args.keep_work:
            shutil.rmtree(rdir, ignore_errors=True)
        return state

    def fail(self, region: dict, problem: str) -> dict:
        state = {"code": region["code"], "name": region["name"], "status": "failed", "osmDate": self.osm_date, "recipe": self.recipe,
                 "problem": problem, "ids": [], "sizes": []}
        previous = self.read_state(region["code"])
        if previous and previous.get("status") == "ok":
            # Keep the last good build listed: publish.py publishes what is there, and the next run tries again.
            state = {**previous, "lastProblem": problem}
        else:
            self.write_state(region["code"], state)
        return state


def select(all_regions: List[dict], args) -> List[dict]:
    chosen = all_regions
    if args.only:
        codes = {c.strip() for c in args.only.split(",") if c.strip()}
        unknown = codes - {r["code"] for r in all_regions}
        if unknown:
            sys.exit(f"build-all: unknown BPS codes {sorted(unknown)} (regions.json)")
        chosen = [r for r in chosen if r["code"] in codes]
    if args.province:
        chosen = [r for r in chosen if r["province"].lower() == args.province.lower()]
    return chosen


def main(argv: Optional[List[str]] = None) -> None:
    p = argparse.ArgumentParser(description="Build every Kabupaten/Kota map (see build-all.sh)")
    p.add_argument("--pbf", required=True, help="the Geofabrik Indonesia extract")
    p.add_argument("--converter", required=True, help="HDataResearch offvmp/converter directory (pinned by lib.sh)")
    p.add_argument("--converter-commit", required=True)
    p.add_argument("--regions", default=regionlib.REGIONS_JSON)
    p.add_argument("--out", default=os.path.join(HERE, "out"))
    p.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    p.add_argument("--only", help="comma-separated BPS codes, e.g. 3573,3515,3579")
    p.add_argument("--province", help="only this province, e.g. 'Jawa Timur'")
    p.add_argument("--max-mib", type=float, default=64, help="largest map file (the app's lab sends at most 64 MiB)")
    p.add_argument("--split-pbf-mib", type=float, default=40,
                   help="split before converting when the cut is larger (a 27 MiB cut gave a 45 MiB map for Surabaya)")
    p.add_argument("--max-depth", type=int, default=4, help="halvings per region at most (up to 16 parts)")
    p.add_argument("--buffer-km", type=float, default=1.0, help="added around each boundary")
    p.add_argument("--batch", type=int, default=16,
                   help="regions cut per pass over the extract; osmium needs about 1.3 GB per region on Linux (Gorontalo, 6 regions: 7.6 GB) "
                        "and reports far less on macOS (8 and 24 peaked at about 2 GB; 64 at once ran out of 8 GB)")
    p.add_argument("--pre-cut", action="store_true",
                   help="first cut the box around the selected regions (one pass), then read that smaller file (for --province)")
    p.add_argument("--force", action="store_true", help="rebuild regions that are up to date")
    p.add_argument("--keep-work", action="store_true", help="keep out/work/<code>/ (cuts, polygons, logs)")
    args = p.parse_args(argv)
    args.out = os.path.abspath(args.out)

    started = time.monotonic()
    osm_date = regionlib.osm_date(args.pbf)
    if not osm_date:
        sys.exit("build-all: the extract has no replication timestamp (osmium fileinfo); use a Geofabrik extract")
    chosen = select(regionlib.load_regions(args.regions), args)
    builder = Builder(args, osm_date)
    todo = chosen if args.force else [r for r in chosen if not builder.up_to_date(r)]
    log(f"OSM data of {osm_date}; {len(chosen)} regions selected, {len(chosen) - len(todo)} up to date, {len(todo)} to build "
        f"with {args.jobs} jobs")

    results = {r["code"]: builder.read_state(r["code"]) for r in chosen if r not in todo}
    if todo:
        source = pre_cut(args.pbf, todo, osm_date, builder.work) if args.pre_cut else args.pbf
        log("reading the boundaries from the extract")
        boundaries = regionlib.region_boundaries(source, todo, os.path.join(builder.work, "boundaries"))
        cuttable = []
        for region in todo:
            boundary = boundaries.get(region["code"])
            if boundary is None:
                results[region["code"]] = builder.fail(region, "no boundary in the extract")
                log(f"{region['code']} {region['name']}: FAILED, no boundary in the extract")
                continue
            geometry = regionlib.buffered(boundary["geometry"], args.buffer_km)
            rdir = os.path.join(builder.work, region["code"])
            shutil.rmtree(rdir, ignore_errors=True)
            os.makedirs(rdir)
            poly = os.path.join(rdir, "r.poly")
            regionlib.write_poly(geometry, poly, region["code"])
            cuttable.append((region, geometry, poly, os.path.join(rdir, "r.osm.pbf"), boundary["exact"]))

        done = 0
        lock = threading.Lock()

        def work(region, geometry, pbf, exact):
            nonlocal done
            try:
                state = builder.build_region(region, geometry, pbf, exact)
                mib = sum(state["sizes"]) / MIB
                parts = f" in {len(state['ids'])} parts" if len(state["ids"]) > 1 else ""
                flag = f", OVERSIZE {state['oversize']}" if state["oversize"] else ""
                message = f"{region['code']} {region['name']}: {mib:.1f} MiB{parts} in {state['seconds']:.0f} s{flag}"
            except Exception as error:  # noqa: BLE001 — one region's failure must not stop the others
                state = builder.fail(region, str(error))
                message = f"{region['code']} {region['name']}: FAILED, {error}"
            with lock:
                done += 1
                results[region["code"]] = state
                log(f"[{done}/{len(cuttable)}] {message}")

        with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
            futures = []
            for start in range(0, len(cuttable), args.batch):
                batch = cuttable[start:start + args.batch]
                log(f"cutting regions {start + 1}-{start + len(batch)} of {len(cuttable)} from the extract")
                try:
                    cut(source, [(poly, pbf) for _, _, poly, pbf, _ in batch], builder.work, os.path.join(builder.work, "cut.log"))
                except RuntimeError as error:
                    for region, *_ in batch:
                        results[region["code"]] = builder.fail(region, f"cut: {error}")
                    log(f"cut FAILED for {[r['code'] for r, *_ in batch]}: {error}")
                    continue
                for region, geometry, _, pbf, exact in batch:
                    futures.append(pool.submit(work, region, geometry, pbf, exact))
            concurrent.futures.wait(futures)
        if source != args.pbf and not args.keep_work:
            os.remove(source)

    states = [results[r["code"]] for r in chosen if results.get(r["code"])]
    ok = [s for s in states if s.get("status") == "ok"]
    failed = [s for s in states if s.get("status") != "ok" or s.get("lastProblem")]
    oversize = [m for s in ok for m in s.get("oversize", [])]
    total = sum(sum(s["sizes"]) for s in ok)
    report = {
        "osmDate": osm_date, "recipe": builder.recipe, "regions": len(chosen), "built": len(ok), "maps": sum(len(s["ids"]) for s in ok),
        "totalBytes": total, "failed": [{"code": s["code"], "problem": s.get("problem") or s.get("lastProblem")} for s in failed],
        "oversize": oversize, "seconds": round(time.monotonic() - started),
        "largest": sorted(({"code": s["code"], "name": s["name"], "bytes": sum(s["sizes"]), "parts": len(s["ids"])} for s in ok),
                          key=lambda x: -x["bytes"])[:15],
    }
    with open(os.path.join(args.out, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
        f.write("\n")
    log(f"done in {report['seconds']} s: {len(ok)}/{len(chosen)} regions ok ({report['maps']} maps, {total / MIB:.1f} MiB), "
        f"{len(failed)} failed, {len(oversize)} oversize; report {os.path.join(args.out, 'report.json')}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
