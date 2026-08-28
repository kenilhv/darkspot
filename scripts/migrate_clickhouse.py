"""Apply db/clickhouse/*.sql to a ClickHouse target, statement by statement, and report what ran.

  python scripts/migrate_clickhouse.py local                  # docker-compose ClickHouse (:8124)
  python scripts/migrate_clickhouse.py cloud [--with-pg-links] # shared ClickHouse Cloud, creds from repo-root .env

On `cloud`, statements that need the Postgres link (ENGINE = PostgreSQL tables and any view that reads a
`pg_*` table) are SKIPPED unless --with-pg-links is given — the cloud Postgres `darkspot` database does not exist
yet (D-6, §4). The immutable mesh_events table and the three incremental MVs + state tables do not need Postgres.
Nothing here prints credentials.

Verification is built in: after applying, a fixture row is inserted for a throwaway event partition, the two
MV state tables are checked to have received it, and the partitions are dropped again.
"""
import glob
import os
import re
import sys
import urllib.parse
import uuid
from datetime import datetime, timezone

import clickhouse_connect

ROOT = os.path.join(os.path.dirname(__file__), "..")
ENV_FILE = os.environ.get("DARKSPOT_ENV_FILE", os.path.join(ROOT, "..", "darkspot", ".env"))


def client(target: str):
    if target == "local":
        return clickhouse_connect.get_client(host="localhost", port=8124, username="darkspot", password="darkspot")
    env = {}
    for line in open(ENV_FILE, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    u = urllib.parse.urlparse(env["CLICKHOUSE_URL"])
    return clickhouse_connect.get_client(host=u.hostname, port=u.port or 8443, username=env["CLICKHOUSE_USER"],
                                         password=env["CLICKHOUSE_PASSWORD"], secure=True)


def statements():
    for path in sorted(glob.glob(os.path.join(ROOT, "db", "clickhouse", "*.sql"))):
        # strip -- comments (whole-line and inline) BEFORE splitting on ';' — a ';' inside a comment is not a terminator
        body = re.sub(r"--[^\n]*", "", open(path, encoding="utf-8").read())
        for st in body.split(";"):
            st = st.strip()
            if st:
                yield os.path.basename(path), st


def needs_pg(st: str) -> bool:
    return "ENGINE = PostgreSQL" in st or re.search(r"\bdarkspot\.pg_\w+", st) is not None


def main():
    target = sys.argv[1]
    with_pg = "--with-pg-links" in sys.argv
    c = client(target)
    ver = c.query("select version()").result_rows[0][0]
    cloud = c.query("select value from system.settings where name='cloud_mode'").result_rows[0][0]
    print(f"target={target} version={ver} cloud_mode={cloud}")
    ran = skipped = 0
    for fname, st in statements():
        name = re.search(r"(?:TABLE|VIEW|DATABASE)\s+(?:IF NOT EXISTS\s+)?([\w.]+)", st)
        label = f"{fname}: {name.group(1) if name else st[:40]}"
        if target == "cloud" and not with_pg and needs_pg(st):
            print(f"  skip (needs Postgres link)  {label}")
            skipped += 1
            continue
        c.command(st)
        print(f"  ok   {label}")
        ran += 1
    print(f"applied {ran}, skipped {skipped}")
    print("darkspot objects:", c.query("select name, engine from system.tables where database='darkspot' order by name").result_rows)

    # ---- built-in verification with a throwaway partition
    ev = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    c.insert("darkspot.mesh_events",
             [(uuid.uuid4(), ev, bytes([7]) * 32, bytes([9]) * 32, 1, now, now, "MIGRATION-FIXTURE", "", "[MIGRATION-FIXTURE] discard", "unextracted", None, "", None)],
             column_names=["id", "disaster_event_id", "device_pubkey", "bridge_pubkey", "hop_count", "reported_at", "received_at",
                           "settlement_pcode", "settlement_geohash", "raw_text", "extracted_status", "extracted_people", "extraction_model", "extraction_confidence"])
    ok = True
    for t, q in (("silence_state", f"select countMerge(report_count) from darkspot.silence_state where disaster_event_id='{ev}'"),
                 ("corroboration_state", f"select uniqExactMerge(distinct_devices) from darkspot.corroboration_state where disaster_event_id='{ev}'")):
        n = c.query(q).result_rows[0][0]
        print(f"  MV {t} received fixture: {n == 1}")
        ok &= n == 1
    for t in ("mesh_events", "silence_state", "corroboration_state", "staleness_state"):
        c.command(f"ALTER TABLE darkspot.{t} DROP PARTITION '{ev}'")
    left = c.query(f"select count() from darkspot.mesh_events where disaster_event_id='{ev}'").result_rows[0][0]
    print(f"  fixture partitions dropped: {left == 0}")
    print("RESULT:", "PASS" if ok and left == 0 else "FAIL")
    sys.exit(0 if ok and left == 0 else 1)


if __name__ == "__main__":
    main()
