"""Admin-unit + population connector: HDX Common Operational Datasets (OCHA).

  COD-AB  (administrative boundaries)   HDX slug  cod-ab-<iso3>
  COD-PS  (population statistics)       HDX slug  cod-ps-<iso3>

Parameterized by ISO3 — nothing here is Nepal-specific. The COD-AB v2 template (OCHA) gives every
country the same shape: an .xlsx with one sheet per admin level (adm<n>_name / adm<n>_pcode /
adm<n-1>_pcode columns) and a GeoJSON bundle whose *adminpoints* layer carries an official point
per unit per level. COD-PS ships per-level CSVs with ADM<n>_PCODE and T_TL (total population).

Honest fallback (COORDINATION.md §2 connector table): population is attached ONLY at the levels
COD-PS actually publishes; finer levels get population = NULL rather than a disaggregated guess.
If a country's files don't match the template, this raises — it never infers.

Every admin_units row records source_dataset / source_url / source_retrieved (provenance).

Usage:  python -m connectors.hdx_cod NPL
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timezone

import openpyxl
import requests

from . import geohash
from .db import pg

HDX_API = "https://data.humdata.org/api/3/action/package_show?id={slug}"
# HDX CKAN returns 403 to some default client UAs (RESEARCH 2026-08-28); identify ourselves explicitly.
HDX_HEADERS = {"User-Agent": "DarkSpot-CORE/0.1 (+https://github.com/darkspot; HDX COD connector)"}
CACHE_DIR = os.environ.get("DARKSPOT_CACHE_DIR", os.path.join(os.path.dirname(__file__), "..", "data", "cache"))


# --------------------------------------------------------------------------- HDX fetch
def hdx_package(slug: str) -> dict:
    r = requests.get(HDX_API.format(slug=slug), timeout=60, headers=HDX_HEADERS)
    r.raise_for_status()
    body = r.json()
    if not body.get("success"):
        raise RuntimeError(f"HDX package_show failed for {slug}: {body}")
    return body["result"]


def _cached_download(url: str, filename: str) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, filename)
    if not os.path.exists(path):
        with requests.get(url, stream=True, timeout=600, headers=HDX_HEADERS) as r:
            r.raise_for_status()
            with open(path, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
    return path


def _pick(resources: list[dict], pattern: str) -> dict:
    rx = re.compile(pattern, re.I)
    hits = [r for r in resources if rx.search(r.get("name", "")) or rx.search(r.get("url", ""))]
    if len(hits) != 1:
        raise RuntimeError(f"expected exactly one resource matching /{pattern}/, got {[h.get('name') for h in hits]}")
    return hits[0]


# --------------------------------------------------------------------------- COD-AB parse
def parse_cod_ab_xlsx(path: str) -> dict[int, list[dict]]:
    """-> {level: [{pcode, name, parent_pcode}]} for every non-'_em' admin sheet."""
    wb = openpyxl.load_workbook(path, read_only=True)
    out: dict[int, list[dict]] = {}
    for ws in wb.worksheets:
        m = re.fullmatch(r"[a-z]{3}_admin(\d)", ws.title)
        if not m:
            continue
        lvl = int(m.group(1))
        rows = ws.iter_rows(values_only=True)
        header = [str(h).lower() if h is not None else "" for h in next(rows)]
        col = {h: i for i, h in enumerate(header)}
        need = [f"adm{lvl}_name", f"adm{lvl}_pcode"] + ([f"adm{lvl-1}_pcode"] if lvl > 0 else [])
        missing = [c for c in need if c not in col]
        if missing:
            raise RuntimeError(f"{os.path.basename(path)} sheet {ws.title}: missing columns {missing} — not COD-AB v2 template, refusing to guess")
        units = []
        for r in rows:
            if r[col[f"adm{lvl}_pcode"]] is None:
                continue
            units.append({
                "pcode": str(r[col[f"adm{lvl}_pcode"]]).strip(),
                "name": str(r[col[f"adm{lvl}_name"]]).strip(),
                "parent_pcode": str(r[col[f"adm{lvl-1}_pcode"]]).strip() if lvl > 0 else None,
            })
        out[lvl] = units
    if not out:
        raise RuntimeError(f"{os.path.basename(path)}: no *_admin<n> sheets found")
    return out


def polygon_points(zip_path: str, level: int) -> dict[str, tuple[float, float]]:
    """-> {pcode: (lat, lon)} representative points of the COD-AB polygon layer for one level (fallback when
    the adminpoints layer lags the polygon revision, e.g. BGD 2020 points vs 2023 polygons)."""
    from shapely.geometry import shape
    with zipfile.ZipFile(zip_path) as z:
        names = [n for n in z.namelist() if re.fullmatch(rf"[a-z]{{3}}_admin{level}\.geojson", n)]
        if len(names) != 1:
            return {}
        data = json.load(io.TextIOWrapper(z.open(names[0]), encoding="utf-8"))
    out = {}
    for f in data["features"]:
        pcode = f["properties"].get(f"adm{level}_pcode")
        if pcode:
            pt = shape(f["geometry"]).representative_point()
            out[str(pcode).strip()] = (pt.y, pt.x)
    return out


def parse_adminpoints(zip_path: str) -> dict[str, tuple[float, float]]:
    """-> {pcode: (lat, lon)} from the COD-AB *adminpoints* GeoJSON layer (official per-unit points)."""
    with zipfile.ZipFile(zip_path) as z:
        names = [n for n in z.namelist() if re.search(r"adminpoints\.geojson$", n) and "_em" not in n]
        if len(names) != 1:
            raise RuntimeError(f"expected one adminpoints layer in {os.path.basename(zip_path)}, got {names}")
        data = json.load(io.TextIOWrapper(z.open(names[0]), encoding="utf-8"))
    pts: dict[str, tuple[float, float]] = {}
    for f in data["features"]:
        p = f["properties"]
        lvl = p.get("admin_level")
        if lvl is None:
            continue
        pcode = p.get(f"adm{lvl}_pcode")
        lon, lat = f["geometry"]["coordinates"][:2]
        if pcode:
            pts[str(pcode).strip()] = (float(lat), float(lon))
    if not pts:
        raise RuntimeError("adminpoints layer had no pcoded points")
    return pts


# --------------------------------------------------------------------------- COD-PS parse
def parse_cod_ps_csv(path: str, level: int) -> tuple[dict[str, int], int]:
    """-> ({pcode: total_population}, reference_year) from a COD-PS per-level CSV."""
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise RuntimeError(f"{os.path.basename(path)}: empty")
    key = f"ADM{level}_PCODE"
    if key not in rows[0] or "T_TL" not in rows[0]:
        raise RuntimeError(f"{os.path.basename(path)}: need columns {key} and T_TL — not COD-PS template, refusing to guess")
    years = {int(r["year"]) for r in rows if r.get("year")}
    if len(years) != 1:
        raise RuntimeError(f"{os.path.basename(path)}: ambiguous reference year {years}")
    return {r[key].strip(): int(float(r["T_TL"])) for r in rows}, years.pop()


# --------------------------------------------------------------------------- load
def load_country(iso3: str, *, max_level: int | None = None) -> dict:
    iso3 = iso3.upper()
    retrieved = datetime.now(timezone.utc)

    ab = hdx_package(f"cod-ab-{iso3.lower()}")
    ab_xlsx = _pick(ab["resources"], r"\.xlsx$")
    ab_geo = _pick(ab["resources"], r"geojson\.zip$")
    units_by_level = parse_cod_ab_xlsx(_cached_download(ab_xlsx["url"], f"{iso3.lower()}_cod_ab.xlsx"))
    geo_path = _cached_download(ab_geo["url"], f"{iso3.lower()}_cod_ab_geojson.zip")
    points = parse_adminpoints(geo_path)

    ps = hdx_package(f"cod-ps-{iso3.lower()}")
    # COD-PS often ships several reference years per level (PHL: 2022+2023, MOZ: 2024+2025). Pick the LATEST
    # year per level deterministically — never "whichever resource the API listed last".
    candidates: dict[int, list[tuple[int, dict]]] = {}
    for res in ps["resources"]:
        m = re.search(r"adm(\d)_(\d{4})[^/]*\.csv$", res.get("name", ""), re.I)
        if m:
            candidates.setdefault(int(m.group(1)), []).append((int(m.group(2)), res))
    pop_by_level: dict[int, tuple[dict[str, int], int, str]] = {}
    for lvl, opts in candidates.items():
        year_in_name, res = max(opts, key=lambda t: t[0])
        pops, year = parse_cod_ps_csv(_cached_download(res["url"], f"{iso3.lower()}_cod_ps_adm{lvl}_{year_in_name}.csv"), lvl)
        if year != year_in_name:
            raise RuntimeError(f"{res['name']}: filename year {year_in_name} != data year {year}, refusing to guess")
        pop_by_level[lvl] = (pops, year, res["url"])

    ab_url = f"https://data.humdata.org/dataset/cod-ab-{iso3.lower()}"
    stats = {"iso3": iso3, "cod_ab_last_modified": ab.get("last_modified"), "cod_ps_last_modified": ps.get("last_modified"),
             "levels": {}}
    with pg() as conn, conn.cursor() as cur:
        for lvl, units in sorted(units_by_level.items()):
            if max_level is not None and lvl > max_level:
                continue
            pops, year, ps_url = pop_by_level.get(lvl, ({}, None, None))
            unit_pcodes = {u["pcode"] for u in units}
            pop_matched = len(unit_pcodes & set(pops)) if pops else 0
            pt_matched = len(unit_pcodes & set(points))
            fallback = polygon_points(geo_path, lvl) if pt_matched < len(units) else {}
            n_pop = n_pt = n_fb = 0
            for u in units:
                src = "cod-ab-adminpoints"
                latlon = points.get(u["pcode"])
                if latlon is None and u["pcode"] in fallback:
                    latlon, src = fallback[u["pcode"]], "cod-ab-polygon-representative-point"
                    n_fb += 1
                pop = pops.get(u["pcode"]) if pops else None
                n_pop += pop is not None
                n_pt += latlon is not None
                cur.execute(
                    """
                    INSERT INTO admin_units (country_iso3, granularity_level, pcode, name, parent_pcode,
                        population, population_year, centroid_lat, centroid_lon, geohash, centroid_source,
                        source_dataset, source_url, source_retrieved)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (country_iso3, granularity_level, pcode) DO UPDATE SET
                        name = EXCLUDED.name, parent_pcode = EXCLUDED.parent_pcode,
                        population = EXCLUDED.population, population_year = EXCLUDED.population_year,
                        centroid_lat = EXCLUDED.centroid_lat, centroid_lon = EXCLUDED.centroid_lon, geohash = EXCLUDED.geohash,
                        centroid_source = EXCLUDED.centroid_source,
                        source_dataset = EXCLUDED.source_dataset, source_url = EXCLUDED.source_url, source_retrieved = EXCLUDED.source_retrieved
                    """,
                    (iso3, lvl, u["pcode"], u["name"], u["parent_pcode"],
                     pop, year if pop is not None else None,
                     latlon[0] if latlon else None, latlon[1] if latlon else None,
                     geohash.encode(*latlon) if latlon else None, src if latlon else None,
                     f"cod-ab-{iso3.lower()}" + (f"+cod-ps-{iso3.lower()}" if pop is not None else ""),
                     ab_url + (f" ; {ps_url}" if pop is not None else ""),
                     retrieved),
                )
            lvl_stats = {"units": len(units), "with_population": n_pop, "with_point": n_pt,
                         "point_from_polygon_fallback": n_fb, "population_year": year if n_pop else None}
            if pops and pop_matched == 0:
                # COD-PS and COD-AB disagree on the pcode scheme at this level (e.g. BGD ADM3: PS 2022 uses the
                # 2020 codes, AB xlsx/polygons use the 2023 revision). Population stays NULL — never remapped by guess.
                lvl_stats["population_pcode_scheme_mismatch"] = {
                    "cod_ps_rows": len(pops), "sample_ab": sorted(unit_pcodes)[:2], "sample_ps": sorted(pops)[:2]}
            stats["levels"][lvl] = lvl_stats
    return stats


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python -m connectors.hdx_cod <ISO3> [max_level]")
    s = load_country(sys.argv[1], max_level=int(sys.argv[2]) if len(sys.argv) > 2 else None)
    print(json.dumps(s, indent=2))
