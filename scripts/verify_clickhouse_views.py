"""End-to-end verification of the ClickHouse analytical layer against the REAL registered event + admin scope.

Inserts clearly-labelled fixture reports ("[VERIFY-FIXTURE]") for the event, asserts each view's behaviour,
then removes them (DROP PARTITION on every per-event ClickHouse table + delete the fixture review row).
Nothing invented is left behind. Exit code 0 only if every assertion holds.

Usage: python scripts/verify_clickhouse_views.py [disaster_event_id]   (defaults to the only event in Postgres)
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from connectors.db import ch, pg  # noqa: E402

FIX = "[VERIFY-FIXTURE] "
fails = []


def check(cond, msg):
    print(("OK   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


with pg() as conn, conn.cursor() as cur:
    if len(sys.argv) > 1:
        ev = sys.argv[1]
    else:
        cur.execute("SELECT id FROM disaster_events")
        ids = cur.fetchall()
        assert len(ids) == 1, f"pass an event id explicitly; found {len(ids)} events"
        ev = str(ids[0][0])
    cur.execute("SELECT staleness_window_hours FROM disaster_events WHERE id = %s", (ev,))
    window_h = cur.fetchone()[0]
    # two real in-scope settlements from hazard_exposure (not hand-picked names)
    cur.execute("""SELECT a.pcode FROM hazard_exposure h JOIN admin_units a ON a.id = h.admin_unit_id
                   WHERE h.disaster_event_id = %s AND h.level = 'high' ORDER BY a.pcode LIMIT 2""", (ev,))
    s_a, s_b = [r[0] for r in cur.fetchall()]

client = ch()
now = datetime.now(timezone.utc)
dev = [bytes([i]) * 32 for i in (1, 2, 3)]
bridge = bytes([9]) * 32
ids = [uuid.uuid4() for _ in range(5)]
rows = [
    # settlement A: two distinct devices say needs_help (corroborated), device 3 says safe (conflict)
    (ids[0], ev, dev[0], bridge, 2, now - timedelta(minutes=30), now - timedelta(minutes=20), s_a, "", FIX + "bridge down, 12 people need help", "needs_help", 12, "fixture", 0.9),
    (ids[1], ev, dev[1], bridge, 3, now - timedelta(minutes=25), now - timedelta(minutes=15), s_a, "", FIX + "road cut, families stranded near school", "needs_help", None, "fixture", 0.8),
    (ids[2], ev, dev[0], bridge, 2, now - timedelta(minutes=24), now - timedelta(minutes=14), s_a, "", FIX + "(same phone re-sending) need help", "needs_help", 12, "fixture", 0.9),
    (ids[3], ev, dev[2], bridge, 1, now - timedelta(minutes=10), now - timedelta(minutes=5), s_a, "", FIX + "all fine here", "safe", None, "fixture", 0.7),
    # settlement B: one report, older than the staleness window
    (ids[4], ev, dev[1], bridge, 4, now - timedelta(hours=window_h + 3), now - timedelta(hours=window_h + 2), s_b, "", FIX + "ok for now", "safe", None, "fixture", 0.6),
]
cols = ["id", "disaster_event_id", "device_pubkey", "bridge_pubkey", "hop_count", "reported_at", "received_at",
        "settlement_pcode", "settlement_geohash", "raw_text", "extracted_status", "extracted_people", "extraction_model", "extraction_confidence"]
review_id = None
try:
    client.insert("mesh_events", rows, column_names=cols)
    with pg() as conn, conn.cursor() as cur:
        cur.execute("""INSERT INTO reports_human_review (disaster_event_id, mesh_event_id, reviewer, decision, note)
                       VALUES (%s, %s, %s, 'confirmed', %s) RETURNING id""", (ev, str(ids[1]), FIX + "reviewer", FIX))
        review_id = cur.fetchone()[0]

    # ---- silence_duration
    r = client.query(f"SELECT settlement_pcode, report_count, never_heard, seconds_since_any_report, seconds_since_human_confirmed "
                     f"FROM silence_duration WHERE disaster_event_id = '{ev}' AND settlement_pcode IN ('{s_a}','{s_b}') ORDER BY settlement_pcode").result_rows
    d = {x[0]: x for x in r}
    check(d[s_a][1] == 4 and d[s_a][2] == 0, f"silence: {s_a} has 4 reports, never_heard=0")
    check(4 * 60 <= d[s_a][3] <= 7 * 60, f"silence: {s_a} seconds_since_any_report ~ 5 min (got {d[s_a][3]})")
    check(d[s_a][4] < 120, f"silence: {s_a} seconds_since_human_confirmed is fresh (got {d[s_a][4]})")
    check((window_h + 2) * 3600 - 120 <= d[s_b][3] <= (window_h + 2) * 3600 + 120, f"silence: {s_b} raw clock ~ {window_h + 2}h (got {d[s_b][3]})")
    n_never = client.query(f"SELECT countIf(never_heard) FROM silence_duration WHERE disaster_event_id = '{ev}'").result_rows[0][0]
    total = client.query(f"SELECT count() FROM silence_duration WHERE disaster_event_id = '{ev}'").result_rows[0][0]
    check(n_never == total - 2, f"silence: every other in-scope unit still never_heard ({n_never}/{total})")

    # ---- corroboration (distinct devices, not messages)
    r = client.query(f"SELECT extracted_status, distinct_devices, message_count, confidence_tier FROM corroboration "
                     f"WHERE disaster_event_id = '{ev}' AND settlement_pcode = '{s_a}' ORDER BY extracted_status").result_rows
    d = {x[0]: x for x in r}
    check(d["needs_help"][1] == 2 and d["needs_help"][2] == 3, "corroboration: needs_help = 2 distinct devices from 3 messages")
    check(d["needs_help"][3] == "human-verified", "corroboration: confirmed review lifts needs_help to human-verified")
    check(d["safe"][1] == 1 and d["safe"][3] == "unverified-single-source", "corroboration: safe = single source, tier unverified")
    r = client.query(f"SELECT confidence_tier FROM corroboration WHERE disaster_event_id = '{ev}' AND settlement_pcode = '{s_b}'").result_rows
    check(r[0][0] == "unverified-single-source", f"corroboration: {s_b} single unreviewed report is unverified")

    # ---- staleness
    r = client.query(f"SELECT settlement_pcode, latest_status, is_stale, effective_status FROM staleness "
                     f"WHERE disaster_event_id = '{ev}' ORDER BY settlement_pcode").result_rows
    d = {x[0]: x for x in r}
    check(d[s_a][1] == "safe" and d[s_a][2] == 0 and d[s_a][3] == "safe", f"staleness: {s_a} latest=safe, fresh")
    check(d[s_b][2] == 1 and d[s_b][3] == "unknown, needs re-verification", f"staleness: {s_b} decayed to unknown past {window_h}h")

    # ---- conflicts (side by side, raw text intact)
    r = client.query(f"SELECT settlement_pcode, distinct_statuses, distinct_devices, reports_side_by_side FROM conflicts WHERE disaster_event_id = '{ev}'").result_rows
    check(len(r) == 1 and r[0][0] == s_a, f"conflicts: exactly one conflicting settlement ({s_a})")
    check(r[0][1] == 2 and r[0][2] == 3, "conflicts: 2 statuses across 3 devices")
    check(all(t[3].startswith(FIX) for t in r[0][3]) and len(r[0][3]) == 4, "conflicts: all 4 raw texts shown side by side")

    # ---- priority_rank
    r = client.query(f"SELECT settlement_pcode, rank, population_basis, hazard_unknown, priority_score FROM priority_rank "
                     f"WHERE disaster_event_id = '{ev}' ORDER BY rank").result_rows
    check(r[-1][0] == s_a, f"priority: freshly-heard {s_a} ranks last ({r[-1][1]}/{len(r)})")
    check(all(x[2] in ("unit", "parent") for x in r), "priority: every unit has a cited population basis (unit or parent)")
    scores = [x[4] for x in r if x[4] is not None]
    check(scores == sorted(scores, reverse=True) and [x[1] for x in r] == list(range(1, len(r) + 1)), "priority: rank order == descending silence*population*hazard score")
    # NOTE: with population_basis='parent' (district figure), a hazard-unknown unit in a big district can outrank a
    # hazard-high unit in a small one. That is what the spec's formula does; it is visible, not hidden (see §6 decision log).
finally:
    # ---- cleanup: no fixture survives
    for t in ("mesh_events", "silence_state", "corroboration_state", "staleness_state"):
        client.command(f"ALTER TABLE {t} DROP PARTITION '{ev}'")
    if review_id:
        with pg() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM reports_human_review WHERE id = %s", (review_id,))
    left = client.query(f"SELECT count() FROM mesh_events WHERE disaster_event_id = '{ev}'").result_rows[0][0]
    check(left == 0, "cleanup: fixture partitions dropped")

print("\nRESULT:", "PASS" if not fails else f"FAIL ({len(fails)})")
sys.exit(1 if fails else 0)
