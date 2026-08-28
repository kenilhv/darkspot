import { test } from "node:test";
import assert from "node:assert/strict";
import { formatConflicts, formatPriorityRanking, formatRoutePlan, guardToolText, stripRestricted } from "./format.ts";
import { checkRule1 } from "../guard/rule1.ts";

test("restricted fields never reach the output", () => {
  const row = { settlement_geohash: "tuvz1", rank: 1, silence_hours: 31, casualty_count: 4, exact_location: "27.9,84.4", urgency_tier: "red", rescue_location: "x" };
  const out = stripRestricted(row);
  assert.equal("casualty_count" in out, false);
  assert.equal("exact_location" in out, false);
  assert.equal("urgency_tier" in out, false);
  assert.equal("rescue_location" in out, false);
  const t = formatPriorityRanking("r", [row], "db.mv_priority_rank");
  assert.doesNotMatch(t, /27\.9,84\.4|casualt|urgency|red\b/);
});

test("priority ranking cites rows and quotes raw text verbatim as blockquote", () => {
  const t = formatPriorityRanking(
    "Chitwan",
    [
      {
        settlement_geohash: "tuvz1",
        settlement_name: "Simaltal",
        rank: 1,
        silence_hours: 31,
        population: 2100,
        hazard_exposure: null,
        confidence_tier: "unverified-single-source",
        is_stale: 1,
        last_confirmation_at: "2026-08-27T03:00:00Z",
        raw_reports: [{ id: 17, raw_text: "send help bridge gone at simaltal" }],
      },
    ],
    "db.mv_priority_rank",
  );
  assert.match(t, /no confirmation for 31h/);
  assert.match(t, /hazard exposure unknown/);
  assert.match(t, /unverified-single-source/);
  assert.match(t, /STALE/);
  assert.match(t, /cited: db\.mv_priority_rank row settlement_geohash=tuvz1/);
  assert.match(t, /mesh_events id=17/);
  assert.match(t, /^> send help bridge gone at simaltal$/m);
  // reporter's imperative is quoted, so the guard passes the whole text
  assert.equal(checkRule1(t).ok, true);
});

test("conflicts are shown side by side, restricted conflict fields are not revealed", () => {
  const t = formatConflicts(
    "Simaltal",
    [
      { settlement_geohash: "tuvz1", field: "bridge_status", value_a: "passable", event_id_a: 1, raw_a: "bridge ok go now", value_b: "collapsed", event_id_b: 2, raw_b: "bridge collapsed" },
      { settlement_geohash: "tuvz1", field: "casualty_count", value_a: "3", event_id_a: 3, raw_a: "3 hurt", value_b: "0", event_id_b: 4, raw_b: "none hurt" },
    ],
    "db.mv_conflicts",
  );
  assert.match(t, /A \(mesh_events id=1\): extracted "passable"/);
  assert.match(t, /B \(mesh_events id=2\): extracted "collapsed"/);
  assert.match(t, /^> bridge collapsed$/m);
  assert.match(t, /field "casualty_count": conflict exists but this field is restricted/);
  assert.doesNotMatch(t, /3 hurt|none hurt|extracted "3"/);
  assert.equal(checkRule1(t).ok, true);
});

test("route plan says 'simulation' in the text, even when empty, and refuses non-simulation rows", () => {
  const empty = formatRoutePlan(3, [], "postgres.drone_routes_simulated");
  assert.match(empty, /simulation/i);
  assert.match(empty, /not been deconflicted/);
  const ok = formatRoutePlan(2, [{ id: 9, is_simulation: true, waypoints: [[27.9, 84.4]], created_at: "2026-08-28" }], "postgres.drone_routes_simulated");
  assert.match(ok, /simulation route id=9/);
  assert.match(ok, /Every route above is a simulation/);
  const bad = formatRoutePlan(2, [{ id: 10, is_simulation: false, waypoints: [] }], "postgres.drone_routes_simulated");
  assert.match(bad, /Refusing to show 1 row/);
  assert.doesNotMatch(bad, /route id=10/);
  for (const t of [empty, ok, bad]) assert.equal(checkRule1(t).ok, true);
});

test("guardToolText withholds a formatter bug that produced a directive", () => {
  const t = guardToolText("Rank 1 is Ward 4. Send a team there.");
  assert.match(t, /withheld by the Rule 1 guard/);
  assert.doesNotMatch(t, /Ward 4/);
});
