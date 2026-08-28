import { test } from "node:test";
import assert from "node:assert/strict";
import { formatConflicts, formatPriorityRanking, formatRoutePlan, guardToolText, publicStatus, stripRestricted } from "./format.ts";
import { checkRule1 } from "../guard/rule1.ts";

test("restricted columns and the casualty status never reach the output", () => {
  const row = { settlement_pcode: "NP0101", settlement_name: "X", rank: 1, silence_hours: 31, extracted_people: 4, casualty_count: 4, exact_location: "27.9,84.4", urgency_tier: "red" };
  const out = stripRestricted(row);
  for (const k of ["extracted_people", "casualty_count", "exact_location", "urgency_tier"]) assert.equal(k in out, false, k);
  assert.equal(publicStatus("casualties").includes("restricted"), true);
  assert.equal(publicStatus("needs_help"), "needs_help");
  assert.equal(publicStatus(""), "unextracted");
  const t = formatPriorityRanking("r", [{ ...row, corroboration: [{ extracted_status: "casualties", confidence_tier: "corroborated-multi-source", distinct_devices: 3 }], raw_reports: [{ id: "a", received_at: "t", extracted_status: "casualties", raw_text: "two dead at the school" }] }], "darkspot.priority_rank");
  assert.doesNotMatch(t, /27\.9,84\.4|casualty_count|urgency|\bred\b|extracted_people|status=casualties/);
  assert.match(t, /restricted \(casualty-related/);
  // the raw text of a casualty-status report IS the restricted data — withheld, not quoted
  assert.doesNotMatch(t, /two dead at the school/);
  assert.match(t, /raw text withheld: this report is casualty-related/);
});

test("priority ranking renders CORE's fields honestly (never_heard, parent population, unknown hazard, stale) and cites rows", () => {
  const t = formatPriorityRanking(
    "Trishuli",
    [
      { settlement_pcode: "NP0201", settlement_name: "Simaltal", granularity_level: 3, rank: 1, silence_hours: 52.25, never_heard: 1, report_count: 0, last_report_at: null, population_used: 21000, population_basis: "parent", hazard_exposure: "unknown", hazard_unknown: 1 },
      {
        settlement_pcode: "NP0202", settlement_name: "Mugling", granularity_level: 3, rank: 2, silence_hours: 3.5, never_heard: 0, report_count: 2, last_report_at: "2026-08-28 17:00:00.000", population_used: 1800, population_basis: "unit", hazard_exposure: "high", hazard_unknown: 0,
        corroboration: [{ extracted_status: "needs_help", confidence_tier: "corroborated-multi-source", distinct_devices: 2 }],
        is_stale: 1, effective_status: "unknown, needs re-verification", window_hours: 24,
        raw_reports: [{ id: "11111111-1111-1111-1111-111111111111", received_at: "2026-08-28 17:00:00.000", extracted_status: "needs_help", raw_text: "send help bridge gone" }],
      },
    ],
    "darkspot.priority_rank",
  );
  // D-18: without coverage evidence the wording is "no device ever registered", never "silent" / "never heard"
  assert.match(t, /1\. Simaltal \(pcode NP0201, adm3\): no DarkSpot device ever registered here — no report in 52\.3h since activation is absence of data, not a signal \(coverage_basis=none\)/);
  assert.doesNotMatch(t, /never heard|silent/i);
  assert.match(t, /parent unit figure/);
  assert.match(t, /hazard exposure unknown/);
  assert.match(t, /no extracted reports — unverified/);
  assert.match(t, /2\. Mugling .* no report for 3\.5h \(2 report\(s\)/);
  assert.match(t, /needs_help: corroborated-multi-source \(2 distinct device\(s\)\)/);
  assert.match(t, /STALE: .* 24h window/);
  assert.match(t, /cited: darkspot\.priority_rank row settlement_pcode=NP0202/);
  assert.match(t, /mesh_events id=11111111-1111-1111-1111-111111111111/);
  assert.match(t, /^> send help bridge gone$/m);
  assert.equal(checkRule1(t).ok, true);
});

test("conflicts render CORE's side-by-side tuples with raw text", () => {
  const t = formatConflicts(
    "Simaltal",
    [{ settlement_pcode: "NP0201", settlement_name: "Simaltal", distinct_statuses: 2, distinct_devices: 2, reports_side_by_side: [["safe", "AABBCCDD00", "2026-08-28 16:00:00.000", "all fine here go home", "id-1"], ["casualties", "11223344ff", "2026-08-28 16:10:00.000", "two hurt at bridge", "id-2"]] }],
    "darkspot.conflicts",
  );
  assert.match(t, /Simaltal \(pcode NP0201\): 2 distinct statuses from 2 distinct devices/);
  assert.match(t, /mesh_events id=id-1 .* extracted_status=safe:/);
  assert.match(t, /^> all fine here go home$/m);
  assert.match(t, /mesh_events id=id-2 .* extracted_status=restricted \(casualty-related/);
  assert.doesNotMatch(t, /two hurt at bridge/);
  assert.match(t, /raw text withheld/);
  assert.doesNotMatch(t, /status=casualties/);
  assert.equal(checkRule1(t).ok, true);
});

test("route plan says 'simulation' in the text, even when empty, shows CORE's algorithm column, refuses non-simulation rows", () => {
  const empty = formatRoutePlan(3, [], "postgres.drone_routes_simulated");
  assert.match(empty, /simulation/i);
  assert.match(empty, /not been deconflicted/);
  // D-20: SWARM's allocation note verbatim (swarm/src/allocation.js)
  assert.match(empty, /"Suggested unit\/task pairings from a simulation\. Not a dispatch order; requires human review before any action\."/);
  const ok = formatRoutePlan(2, [{ id: "r9", is_simulation: true, algorithm: "message-ferry (Zhao & Ammar 2004)", fleet_size: 2, waypoints: [{ lat: 27.9, lon: 84.4, order: 1 }], computed_at: "2026-08-28" }], "postgres.drone_routes_simulated");
  assert.match(ok, /simulation route id=r9 .* algorithm "message-ferry \(Zhao & Ammar 2004\)"/);
  assert.match(ok, /Every route above is a simulation/);
  const bad = formatRoutePlan(2, [{ id: "r10", is_simulation: false, algorithm: "x", fleet_size: 2, waypoints: [] }], "postgres.drone_routes_simulated");
  assert.match(bad, /Refusing to show 1 row/);
  assert.doesNotMatch(bad, /route id=r10/);
  for (const t of [empty, ok, bad]) assert.equal(checkRule1(t).ok, true);
});

test("guardToolText withholds a formatter bug that produced a directive", () => {
  const t = guardToolText("Rank 1 is Ward 4. Send a team there.");
  assert.match(t, /withheld by the Rule 1 guard/);
  assert.doesNotMatch(t, /Ward 4/);
});

test("an authorized viewer (individual_pii) sees the casualty status, headcount and raw text; default stays withheld", () => {
  const rows = [{ settlement_pcode: "NP1", settlement_name: "X", rank: 1, silence_hours: 1, report_count: 1, corroboration: [{ extracted_status: "casualties", confidence_tier: "unverified-single-source", distinct_devices: 1 }], raw_reports: [{ id: "a", received_at: "t", extracted_status: "casualties", raw_text: "two dead at the school", extracted_people: 2 }] }];
  const open = formatPriorityRanking("r", rows, "src", true);
  assert.match(open, /casualties: unverified-single-source/);
  assert.match(open, /extracted_status=casualties, people stated=2/);
  assert.match(open, /^> two dead at the school$/m);
  const closed = formatPriorityRanking("r", rows, "src");
  assert.doesNotMatch(closed, /two dead|people stated/);
  const cf = formatConflicts("X", [{ settlement_pcode: "NP1", distinct_statuses: 2, distinct_devices: 2, reports_side_by_side: [["casualties", "aa", "t", "two hurt", "i1"], ["safe", "bb", "t", "fine", "i2"]] }], "src", true);
  assert.match(cf, /^> two hurt$/m);
  assert.match(cf, /extracted_status=casualties:/);
});

test("D-18/D-19: coverage_basis drives the silence wording; hazard cites kind + source; trusted corroboration shown beside the tier", () => {
  const base = { settlement_name: "X", silence_hours: 68.8, never_heard: 1, report_count: 0, last_report_at: null, population_used: 100, population_basis: "unit", hazard_exposure: "high", hazard_kind: "Flood extent", hazard_source_org: "HOT", hazard_source_licence: "ODbL", hazard_unknown: 0 };
  const none = formatPriorityRanking("r", [{ ...base, settlement_pcode: "A", rank: 1, coverage_basis: "none" }], "src");
  assert.match(none, /no DarkSpot device ever registered here — no report in 68\.8h since activation is absence of data, not a signal \(coverage_basis=none\)/);
  assert.doesNotMatch(none, /silent/i);
  const after = formatPriorityRanking("r", [{ ...base, settlement_pcode: "B", rank: 2, coverage_basis: "device_sighted_after_activation" }], "src");
  assert.match(after, /reachable since activation but no report for 68\.8h/);
  assert.doesNotMatch(after, /silent/i);
  const before = formatPriorityRanking("r", [{ ...base, settlement_pcode: "C", rank: 3, coverage_basis: "device_sighted_before_activation" }], "src");
  assert.match(before, /silent: a DarkSpot device was sighted here before activation and nothing has been heard for 68\.8h/);
  assert.match(none, /hazard exposure high — Flood extent \(HOT, ODbL\)/);
  const unk = formatPriorityRanking("r", [{ ...base, settlement_pcode: "D", rank: 4, coverage_basis: "none", hazard_exposure: "unknown", hazard_kind: null }], "src");
  assert.match(unk, /hazard exposure unknown \(no mapped product covers this unit\)/);
  const corr = formatPriorityRanking("r", [{ ...base, settlement_pcode: "E", rank: 5, never_heard: 0, report_count: 3, last_report_at: "t", coverage_basis: "device_sighted_after_activation", corroboration: [{ extracted_status: "needs_help", confidence_tier: "corroborated-multi-source", distinct_devices: 3, distinct_trusted_devices: 0, trusted_corroboration: false }] }], "src");
  assert.match(corr, /needs_help: corroborated-multi-source \(3 distinct device\(s\), 0 human-trusted; trusted corroboration: no\)/);
  for (const t of [none, after, before, unk, corr]) assert.equal(checkRule1(t).ok, true);
});
