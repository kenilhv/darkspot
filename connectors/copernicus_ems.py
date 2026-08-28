"""Hazard-exposure connector: Copernicus Emergency Management Service (EMS) Rapid Mapping products.

Parameterized by disaster_event_id. Reads the event's `copernicus_ems_ref` (e.g. EMSR927) and country,
discovers that activation's published vector products on HDX (HDX mirrors every public EMS product under
the Copernicus organisation), downloads the vector bundles, and for every admin unit in scope writes a
`hazard_exposure` row:

    intersects an observedEvent polygon          -> 'high'    (with ems_product_ref + source_url)
    everything else in scope                     -> 'unknown' (NOT 'low': absence of mapped water is not safety)

Scope = every finest-level admin unit whose PARENT unit (e.g. district) is touched by any AOI or observed
extent. That is deliberately wider than the mapped water: the silence view needs the settlements nearby that
may have gone quiet, not only the ones under water.

Additional published extents (HOT, UNOSAT, ...) can be added with --extra-extent URL --extra-ref NAME; they are
treated exactly like a Copernicus observed extent and cited per row.

Consuming an already-activated product is public. REQUESTING a new activation needs an authorized org (§2).

Usage:  python -m connectors.copernicus_ems --event <uuid> [--extra-extent URL --extra-ref NAME]...
"""
from __future__ import annotations

import argparse
import io
import json
import re
import zipfile
from datetime import datetime, timezone

import requests
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

from .db import pg
from .hdx_cod import CACHE_DIR, _cached_download

HDX_SEARCH = "https://data.humdata.org/api/3/action/package_search?q={q}&rows=20"


# --------------------------------------------------------------------------- discovery
def discover_ems_vector_bundles(ems_ref: str) -> list[dict]:
    """HDX resources (format SHP, zipped vectors) for a Copernicus activation code."""
    r = requests.get(HDX_SEARCH.format(q=ems_ref), timeout=60)
    r.raise_for_status()
    out = []
    for pkg in r.json()["result"]["results"]:
        if pkg["organization"]["name"] != "copernicus":
            continue
        for res in pkg["resources"]:
            if res.get("format", "").upper() == "SHP" and ems_ref in res["url"]:
                out.append({"name": res["name"], "url": res["url"], "dataset": pkg["name"]})
    if not out:
        raise RuntimeError(f"no Copernicus vector bundles for {ems_ref} on HDX — hazard exposure stays 'unknown'")
    return out


def _layers_from_bundle(zip_path: str) -> dict[str, list]:
    """-> {'observedEventA': [(product_ref, geom)], 'areaOfInterestA': [...]} from an EMS vectors zip."""
    out: dict[str, list] = {"observedEventA": [], "areaOfInterestA": []}
    with zipfile.ZipFile(zip_path) as z:
        for n in z.namelist():
            m = re.search(r"(EMS[RN]\d+_AOI\d+_\w+?_PRODUCT)_(observedEventA|areaOfInterestA)_v\d+\.json$", n)
            if not m:
                continue
            data = json.load(io.TextIOWrapper(z.open(n), encoding="utf-8"))
            crs = (data.get("crs") or {}).get("properties", {}).get("name", "")
            if crs and "CRS84" not in crs and "4326" not in crs:
                raise RuntimeError(f"{n}: unexpected CRS {crs}, refusing to reproject blindly")
            for f in data["features"]:
                out[m.group(2)].append((m.group(1), shape(f["geometry"])))
    return out


def _geojson_extent(url: str) -> list:
    path = _cached_download(url, "extent_" + re.sub(r"[^A-Za-z0-9_.-]", "_", url.rsplit("/", 1)[-1]))
    data = json.load(open(path, encoding="utf-8"))
    return [shape(f["geometry"]) for f in data["features"]]


# --------------------------------------------------------------------------- admin polygons
def admin_polygons(iso3: str, level: int) -> dict[str, object]:
    """{pcode: polygon} for a COD-AB admin level, from the cached COD-AB GeoJSON bundle."""
    zip_path = f"{CACHE_DIR}/{iso3.lower()}_cod_ab_geojson.zip"
    with zipfile.ZipFile(zip_path) as z:
        names = [n for n in z.namelist() if re.fullmatch(rf"[a-z]{{3}}_admin{level}\.geojson", n)]
        if len(names) != 1:
            raise RuntimeError(f"expected one admin{level} polygon layer in COD-AB bundle, got {names}")
        data = json.load(io.TextIOWrapper(z.open(names[0]), encoding="utf-8"))
    polys = {}
    for f in data["features"]:
        pcode = f["properties"].get(f"adm{level}_pcode")
        if pcode:
            polys[str(pcode).strip()] = shape(f["geometry"])
    return polys


# --------------------------------------------------------------------------- load
def load_event(event_id: str, extra_extents: list[tuple[str, str]] = ()) -> dict:
    retrieved = datetime.now(timezone.utc)
    with pg() as conn, conn.cursor() as cur:
        cur.execute("SELECT country_iso3, copernicus_ems_ref FROM disaster_events WHERE id = %s", (event_id,))
        row = cur.fetchone()
        if not row:
            raise RuntimeError(f"no disaster_event {event_id}")
        iso3, ems_ref = row[0].strip(), row[1]
        cur.execute("SELECT max(granularity_level) FROM admin_units WHERE country_iso3 = %s", (iso3,))
        level = cur.fetchone()[0]
        if level is None:
            raise RuntimeError(f"no admin_units for {iso3} — run connectors.hdx_cod first")
        cur.execute("SELECT id, pcode, parent_pcode FROM admin_units WHERE country_iso3 = %s AND granularity_level = %s", (iso3, level))
        units = {pcode: (uid, parent) for uid, pcode, parent in cur.fetchall()}

    observed: list[tuple[str, str, object]] = []   # (product_ref, source_url, geom)
    aois: list[object] = []
    if ems_ref:
        for b in discover_ems_vector_bundles(ems_ref):
            path = _cached_download(b["url"], re.sub(r"[^A-Za-z0-9_.-]", "_", b["name"]) + ".zip")
            layers = _layers_from_bundle(path)
            observed += [(ref, b["url"], g) for ref, g in layers["observedEventA"]]
            aois += [g for _, g in layers["areaOfInterestA"]]
    for url, ref in extra_extents:
        observed += [(ref, url, g) for g in _geojson_extent(url)]

    if not observed and not aois:
        raise RuntimeError("no extents found; nothing to scope")

    polys = admin_polygons(iso3, level)
    pcodes = [p for p in polys if p in units]
    tree = STRtree([polys[p] for p in pcodes])

    touched_units: set[str] = set()
    for g in aois + [g for _, _, g in observed]:
        for i in tree.query(g, predicate="intersects"):
            touched_units.add(pcodes[i])
    touched_parents = {units[p][1] for p in touched_units}
    scope = [p for p in pcodes if units[p][1] in touched_parents]

    observed_union = unary_union([g for _, _, g in observed]) if observed else None
    stats = {"event": event_id, "iso3": iso3, "ems_ref": ems_ref, "admin_level": level,
             "observed_polygons": len(observed), "aoi_polygons": len(aois),
             "touched_parents": sorted(touched_parents), "scope_units": len(scope), "high": 0, "unknown": 0}
    with pg() as conn, conn.cursor() as cur:
        for p in scope:
            hit = None
            if observed_union is not None and polys[p].intersects(observed_union):
                hit = next((ref, url) for ref, url, g in observed if polys[p].intersects(g))
            lvl = "high" if hit else "unknown"
            stats[lvl] += 1
            cur.execute(
                """INSERT INTO hazard_exposure (disaster_event_id, admin_unit_id, level, ems_product_ref, source_url, source_retrieved)
                   VALUES (%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (disaster_event_id, admin_unit_id) DO UPDATE SET
                     level = CASE WHEN EXCLUDED.level = 'high' OR hazard_exposure.level = 'unknown' THEN EXCLUDED.level ELSE hazard_exposure.level END,
                     ems_product_ref = COALESCE(EXCLUDED.ems_product_ref, hazard_exposure.ems_product_ref),
                     source_url      = COALESCE(EXCLUDED.source_url, hazard_exposure.source_url),
                     source_retrieved = COALESCE(EXCLUDED.source_retrieved, hazard_exposure.source_retrieved)""",
                (event_id, units[p][0], lvl, hit[0] if hit else None, hit[1] if hit else None, retrieved if hit else None),
            )
    return stats


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", required=True)
    ap.add_argument("--extra-extent", action="append", default=[], help="GeoJSON URL of another published observed extent")
    ap.add_argument("--extra-ref", action="append", default=[], help="product reference to cite for the matching --extra-extent")
    a = ap.parse_args()
    if len(a.extra_extent) != len(a.extra_ref):
        raise SystemExit("--extra-extent and --extra-ref must be paired")
    print(json.dumps(load_event(a.event, list(zip(a.extra_extent, a.extra_ref))), indent=2))
