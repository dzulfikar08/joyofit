#!/usr/bin/env python3
"""Indonesia's Kabupaten/Kota for the offline watch maps: the region list (`regions.json`) and their boundary polygons.

    python regions.py generate --pbf .cache/asia_indonesia-latest.osm.pbf [--out regions.json]

Sources (both open, both compatible with publishing ODbL maps):
- Wikidata (CC0): every item with a 4-digit "Statistics Indonesia area code" (P1588, the BPS kode wilayah of a Kabupaten/Kota), its
  Indonesian label, its OpenStreetMap relation id (P402) and the province it lies in (P131, an item that is a "province of Indonesia",
  Q5098). Wikidata keeps the BPS codes from before the 2022 Papua split (91xx, 94xx) with the new provinces in P131; JoyoFit keeps
  those codes, so a map id never changes when a province is split.
- OpenStreetMap (ODbL), from the same Geofabrik extract the maps are built from: the `boundary=administrative` + `admin_level=5`
  relation of each region, matched by relation id (P402) or else by its `wikidata` tag. The polygons are not stored in git: build_all.py
  rebuilds them from each month's extract with `boundary_polygons()` below.

`regions.json` keeps per region: BPS code, map id, name, province, kind, Wikidata item, OSM relation, bbox (degrees, from the relation;
null when the extract has no usable relation).
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from typing import Dict, Iterable, List, Optional

from shapely.geometry import MultiPolygon, Polygon, box, shape

HERE = os.path.dirname(os.path.abspath(__file__))
REGIONS_JSON = os.path.join(HERE, "regions.json")
# JoyoFit's watch map ids: 2·10^18 + part·10^4 + BPS code (part 0 = the whole region). Above 2^60, so they never collide with Huawei's ids.
ID_BASE = 2_000_000_000_000_000_000
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
USER_AGENT = "JoyoFit-offline-maps/1.0 (https://github.com/dzulfikar08/joyofit; tools/offline-maps)"
QUERY = """
SELECT ?item ?code ?label ?osm ?provLabel WHERE {
  ?item wdt:P1588 ?code . FILTER(STRLEN(?code) = 4)
  OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) = "id") }
  OPTIONAL { ?item wdt:P402 ?osm }
  OPTIONAL { ?item wdt:P131 ?prov . ?prov wdt:P31 wd:Q5098 . ?prov rdfs:label ?provLabel FILTER(LANG(?provLabel) = "id") }
}
"""


def map_id(code: str, part: int = 0) -> str:
    return str(ID_BASE + part * 10_000 + int(code))


def kind_of(code: str) -> str:
    """BPS: the last two digits 01-69 are a Kabupaten, 71-99 a Kota."""
    return "kota" if int(code[2:]) >= 71 else "kabupaten"


def display_name(label: str, kind: str) -> str:
    for prefix in ("Kabupaten ", "Kota "):
        if label.startswith(prefix):
            label = label[len(prefix):]
    return f"{'Kota' if kind == 'kota' else 'Kabupaten'} {label}"


def wikidata_regions() -> List[dict]:
    url = WIKIDATA_SPARQL + "?" + urllib.parse.urlencode({"query": QUERY})
    request = urllib.request.Request(url, headers={"Accept": "application/sparql-results+json", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        rows = json.load(response)["results"]["bindings"]
    by_code: Dict[str, dict] = {}
    for row in rows:
        code = row["code"]["value"]
        if not code.isdigit():
            continue
        entry = by_code.setdefault(code, {"code": code, "wikidata": row["item"]["value"].rsplit("/", 1)[-1], "label": None,
                                          "osm": set(), "province": set()})
        if "label" in row:
            entry["label"] = row["label"]["value"]
        if "osm" in row:
            entry["osm"].add(int(row["osm"]["value"]))
        if "provLabel" in row:
            entry["province"].add(row["provLabel"]["value"])
    return [by_code[c] for c in sorted(by_code)]


def osm_boundaries(adm_pbf: str, workdir: str) -> List[dict]:
    """Every `admin_level=5` boundary relation osmium can assemble, as {relation, wikidata, name, geometry (shapely)}."""
    seq = os.path.join(workdir, "adm5.geojsonseq")
    subprocess.run(["osmium", "export", "--overwrite", "-f", "geojsonseq", "--geometry-types=polygon", "-a", "type,id",
                    "-o", seq, adm_pbf], check=True)
    found = []
    with open(seq, encoding="utf-8") as f:
        for line in f:
            line = line.strip().lstrip("\x1e")
            if not line:
                continue
            feature = json.loads(line)
            props = feature.get("properties", {})
            if props.get("@type") != "relation" or props.get("admin_level") != "5" or props.get("boundary") != "administrative":
                continue
            geometry = shape(feature["geometry"])
            if geometry.is_empty:
                continue
            if not geometry.is_valid:
                geometry = geometry.buffer(0)
            found.append({"relation": int(props["@id"]), "wikidata": props.get("wikidata"), "name": props.get("name"),
                          "geometry": geometry})
    return found


def relation_bbox(adm_pbf: str, relation: int, workdir: str) -> Optional[List[float]]:
    """The bbox of a relation's members, for a boundary osmium cannot assemble into an area (a broken ring, or one cut at the extract's
    edge: Kabupaten Nunukan on the Malaysian border in 2026-10). `osmium getid` exits 1 when members are missing but writes the rest."""
    path = os.path.join(workdir, f"r{relation}.osm.pbf")
    subprocess.run(["osmium", "getid", "--overwrite", "-r", "-o", path, adm_pbf, f"r{relation}"], capture_output=True)
    if not os.path.exists(path):
        return None
    out = subprocess.run(["osmium", "fileinfo", "-e", "-g", "data.bbox", path], capture_output=True, text=True).stdout.strip()
    try:
        w, s, e, n = (float(v) for v in out.strip("()").split(","))
    except ValueError:
        return None
    return [round(w, 4), round(s, 4), round(e, 4), round(n, 4)] if w < e and s < n else None


def region_boundaries(pbf: str, regions: Iterable[dict], workdir: str) -> Dict[str, dict]:
    """code → {relation, name, geometry, exact}: the region's OSM relation (by id, else by its `wikidata` tag) as an area, or, when the
    relation does not assemble, the box around its members (`exact` false). Regions with neither are left out."""
    os.makedirs(workdir, exist_ok=True)
    adm = os.path.join(workdir, "adm5.osm.pbf")
    subprocess.run(["osmium", "tags-filter", "--overwrite", "-o", adm, pbf, "r/admin_level=5"], check=True)
    boundaries = osm_boundaries(adm, workdir)
    by_relation = {b["relation"]: b for b in boundaries}
    by_wikidata: Dict[str, dict] = {}
    for b in boundaries:
        if b["wikidata"]:
            by_wikidata.setdefault(b["wikidata"], b)
    matched = {}
    for region in regions:
        relations = region.get("osmRelations") or ([region["osmRelation"]] if region.get("osmRelation") else [])
        hit = next((by_relation[r] for r in relations if r in by_relation), None) or by_wikidata.get(region["wikidata"])
        if hit:
            matched[region["code"]] = {**hit, "exact": True}
            continue
        for relation in relations:
            bbox = relation_bbox(adm, relation, workdir)
            if bbox:
                matched[region["code"]] = {"relation": relation, "name": None, "geometry": box(*bbox), "exact": False}
                break
    return matched


def rounded_bbox(geometry) -> List[float]:
    w, s, e, n = geometry.bounds
    return [round(w, 4), round(s, 4), round(e, 4), round(n, 4)]


def buffered(geometry, buffer_km: float, simplify_m: float = 200):
    """The region plus `buffer_km` (degrees ≈ km / 111 near the equator; Indonesia lies within ±11°), simplified to keep `osmium extract`
    fast on long coastlines. The buffer is larger than the simplification, so the result still covers the whole region."""
    grown = geometry.buffer(buffer_km / 111.0, quad_segs=4)
    return grown.simplify(simplify_m / 111_000.0, preserve_topology=True)


def polygons_of(geometry) -> List[Polygon]:
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, MultiPolygon):
        return list(geometry.geoms)
    return [g for g in getattr(geometry, "geoms", []) if isinstance(g, Polygon)]


def write_poly(geometry, path: str, name: str) -> None:
    """Osmosis .poly (what `osmium extract --polygon` reads): one section per outer ring, `!` sections for holes."""
    lines = [name]
    section = 1
    for polygon in polygons_of(geometry):
        rings = [(polygon.exterior, False)] + [(ring, True) for ring in polygon.interiors]
        for ring, hole in rings:
            lines.append(f"{'!' if hole else ''}{section}")
            lines.extend(f"   {x:.7f}   {y:.7f}" for x, y in ring.coords)
            lines.append("END")
            section += 1
    lines.append("END")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def osm_date(pbf: str) -> str:
    out = subprocess.run(["osmium", "fileinfo", "-g", "header.option.osmosis_replication_timestamp", pbf],
                         capture_output=True, text=True)
    return out.stdout.strip()


def load_regions(path: str = REGIONS_JSON) -> List[dict]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)["regions"]


def generate(pbf: str, out: str, workdir: str) -> None:
    wd = wikidata_regions()
    for r in wd:
        r["osmRelations"] = sorted(r["osm"])
    matched = region_boundaries(pbf, wd, workdir)
    regions = []
    problems = []
    for r in wd:
        code = r["code"]
        kind = kind_of(code)
        boundary = matched.get(code)
        label = r["label"] or (boundary or {}).get("name")
        if not r["label"]:
            problems.append(f"{code}: no Indonesian label on Wikidata ({r['wikidata']}); OSM name {label!r} used")
        if len(r["province"]) != 1:
            problems.append(f"{code}: province is {sorted(r['province']) or 'missing'} on Wikidata ({r['wikidata']})")
        if boundary is None:
            problems.append(f"{code}: no admin_level=5 relation in the extract (Wikidata {r['wikidata']}, P402 {r['osmRelations']})")
        elif not boundary["exact"]:
            problems.append(f"{code}: relation {boundary['relation']} does not form an area; the box around its members is used")
        regions.append({
            "code": code,
            "id": map_id(code),
            "name": display_name(label or code, kind),
            "province": sorted(r["province"])[0] if r["province"] else "",
            "kind": kind,
            "wikidata": r["wikidata"],
            "osmRelation": boundary["relation"] if boundary else (r["osmRelations"][0] if r["osmRelations"] else None),
            "bbox": rounded_bbox(boundary["geometry"]) if boundary else None,
        })
    header = {
        "about": "Indonesia's Kabupaten/Kota for JoyoFit's offline watch maps; generated by tools/offline-maps/regions.py. "
                 "Codes, names, provinces: Wikidata (CC0). Boundaries: OpenStreetMap relations (© OpenStreetMap contributors, ODbL 1.0).",
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "osmDate": osm_date(pbf),
    }
    # One region per line: small diffs when a month's run changes a name or a bbox.
    with open(out, "w", encoding="utf-8") as f:
        f.write("{\n")
        for key, value in header.items():
            f.write(f"{json.dumps(key)}: {json.dumps(value, ensure_ascii=False)},\n")
        f.write('"regions": [\n')
        f.write(",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in regions))
        f.write("\n]}\n")
    provinces = sorted({r["province"] for r in regions})
    print(f"regions: {len(regions)} regions ({sum(r['kind'] == 'kota' for r in regions)} kota) in {len(provinces)} provinces, "
          f"{sum(r['bbox'] is not None for r in regions)} with an OSM boundary → {out}")
    for p in problems:
        print(f"regions: warning: {p}", file=sys.stderr)


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    gen = sub.add_parser("generate", help="query Wikidata, match the extract's boundaries, write regions.json")
    gen.add_argument("--pbf", required=True, help="the Geofabrik Indonesia extract")
    gen.add_argument("--out", default=REGIONS_JSON)
    gen.add_argument("--work", default=os.path.join(HERE, ".cache", "regions"))
    args = parser.parse_args(argv)
    if args.command == "generate":
        generate(args.pbf, args.out, args.work)


if __name__ == "__main__":
    main()
