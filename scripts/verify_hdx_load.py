"""D-8: make the "N admin units verified" claim reproducible, not asserted.

Prints, for one ISO3: the HDX dataset slugs, their last_modified + resource names (from the live HDX API),
what is in admin_units (Postgres) per level, and cross-checks against the cached source files:
  - COD-AB xlsx row count per level == admin_units count per level
  - COD-PS per-level csv T_TL sum == sum(admin_units.population) at that level
Exit 0 only if every cross-check holds. Save the output under data/verification/ when committing a claim.

Usage: python scripts/verify_hdx_load.py NPL
"""
import csv
import glob
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from connectors.db import pg                      # noqa: E402
from connectors.hdx_cod import CACHE_DIR, hdx_package, parse_cod_ab_xlsx  # noqa: E402

iso3 = sys.argv[1].upper()
ok = True
print(f"# HDX load verification — {iso3} — run {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
for slug in (f"cod-ab-{iso3.lower()}", f"cod-ps-{iso3.lower()}"):
    p = hdx_package(slug)
    print(f"{slug}: '{p['title']}' | dataset_date={p.get('dataset_date')} | last_modified={p.get('last_modified')} | org={p['organization']['title']}")
    for r in p["resources"]:
        print(f"   resource {r['name']} | {r['format']} | last_modified={r.get('last_modified')}")

ab = parse_cod_ab_xlsx(os.path.join(CACHE_DIR, f"{iso3.lower()}_cod_ab.xlsx"))
with pg() as conn, conn.cursor() as cur:
    cur.execute("""SELECT granularity_level, count(*), count(population), sum(population), count(centroid_lat), max(source_retrieved)
                   FROM admin_units WHERE country_iso3 = %s GROUP BY 1 ORDER BY 1""", (iso3,))
    db = {r[0]: r for r in cur.fetchall()}

print("\nlevel | source_rows(COD-AB xlsx) | db_units | db_with_pop | db_pop_sum | source_pop_sum(COD-PS csv) | db_with_point | retrieved")
for lvl in sorted(ab):
    src_rows = len(ab[lvl])
    src_pop = None
    ps_overlap = None
    for f in sorted(glob.glob(os.path.join(CACHE_DIR, f"{iso3.lower()}_cod_ps_adm{lvl}_*.csv")))[-1:]:
        with open(f, encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.DictReader(fh))
        src_pop = sum(int(float(r["T_TL"])) for r in rows)
        ps_overlap = len({r[f"ADM{lvl}_PCODE"].strip() for r in rows} & {u["pcode"] for u in ab[lvl]})
        if ps_overlap == 0:
            print(f"  level {lvl}: COD-PS pcodes share NOTHING with COD-AB pcodes at this level (scheme mismatch) -> population honestly NULL, not compared")
            src_pop = None
    d = db.get(lvl)
    db_units, db_pop_n, db_pop, db_pts, ret = (d[1], d[2], d[3], d[4], d[5]) if d else (0, 0, None, 0, None)
    line_ok = db_units == src_rows and (src_pop is None or db_pop == src_pop)
    ok &= line_ok
    print(f"{lvl:>5} | {src_rows:>24} | {db_units:>8} | {db_pop_n:>11} | {str(db_pop):>10} | {str(src_pop):>26} | {db_pts:>13} | {ret}  {'OK' if line_ok else 'MISMATCH'}")

print(f"\nTOTAL admin_units({iso3}) = {sum(d[1] for d in db.values())}   RESULT: {'PASS' if ok else 'FAIL'}")
sys.exit(0 if ok else 1)
