"""Register a disaster event (Postgres disaster_events). Region/disaster-agnostic; every identifier is
supplied by the operator from a real registry (GLIDE / Copernicus EMS / GDACS), never inferred here.

Usage:
  python -m connectors.register_event --type glof --iso3 NPL --region "Bhote Koshi / Trishuli corridor" \
      --date 2026-08-26 --ems EMSR927 --glide FL-2026-000167-NPL --gdacs FL1104124 --notes "..."
Prints the new event id. Idempotent on (glide_number) when given: re-running returns the existing id.
"""
from __future__ import annotations

import argparse

from .db import pg


def register(*, type_: str, iso3: str, region: str, date: str, ems: str | None, glide: str | None,
             gdacs: str | None, notes: str | None, staleness_hours: int = 24) -> str:
    with pg() as conn, conn.cursor() as cur:
        if glide:
            cur.execute("SELECT id FROM disaster_events WHERE glide_number = %s", (glide,))
            row = cur.fetchone()
            if row:
                return str(row[0])
        cur.execute(
            """INSERT INTO disaster_events (type, country_iso3, region, activation_date, copernicus_ems_ref,
                                            glide_number, gdacs_id, notes, staleness_window_hours)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (type_, iso3.upper(), region, date, ems, glide, gdacs, notes, staleness_hours),
        )
        return str(cur.fetchone()[0])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", required=True)
    ap.add_argument("--iso3", required=True)
    ap.add_argument("--region", required=True)
    ap.add_argument("--date", required=True, help="activation date YYYY-MM-DD")
    ap.add_argument("--ems", help="Copernicus EMS activation code, e.g. EMSR927")
    ap.add_argument("--glide", help="GLIDE number, e.g. FL-2026-000167-NPL")
    ap.add_argument("--gdacs", help="GDACS id, e.g. FL1104124")
    ap.add_argument("--notes")
    ap.add_argument("--staleness-hours", type=int, default=24)
    a = ap.parse_args()
    print(register(type_=a.type, iso3=a.iso3, region=a.region, date=a.date, ems=a.ems, glide=a.glide,
                   gdacs=a.gdacs, notes=a.notes, staleness_hours=a.staleness_hours))
