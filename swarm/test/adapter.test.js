import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeProjection, scenarioFromPriorityRank } from '../src/adapter.js';
import { SimEngine } from '../src/engine.js';

const fixture = JSON.parse(await readFile(new URL('../data/npl_priority_rank_fixture.json', import.meta.url), 'utf-8'));

test('fixture is real CORE output with provenance, not invented', () => {
  assert.ok(fixture._provenance.query.includes('darkspot.priority_rank'));
  assert.equal(fixture.rows.length, fixture._provenance.row_count);
  for (const r of fixture.rows) { assert.match(r.settlement_pcode, /^NP\d+$/); assert.equal(r.source_dataset, 'cod-ab-npl'); }
});

test('projection is invertible and scale is uniform (km → px)', () => {
  const proj = makeProjection(fixture.rows, { width: 900, height: 560 });
  for (const r of fixture.rows.slice(0, 10)) {
    const p = proj.project(r.centroid_lat, r.centroid_lon); const back = proj.unproject(p.x, p.y);
    assert.ok(Math.abs(back.lat - r.centroid_lat) < 1e-9 && Math.abs(back.lon - r.centroid_lon) < 1e-9);
    assert.ok(p.x >= 0 && p.x <= 900 && p.y >= 0 && p.y <= 560);
  }
  // 1 km east on the ground ≈ pxPerKm pixels on screen
  const a = proj.project(27.8, 84.5), b = proj.project(27.8, 84.5 + 1 / (111.32 * Math.cos((proj.lat0 * Math.PI) / 180)));
  assert.ok(Math.abs((b.x - a.x) - proj.pxPerKm) < 1e-6);
});

test('scenario carries CORE fields through and rescales priority without changing the order', () => {
  const sc = scenarioFromPriorityRank(fixture.rows, { rangeKm: 10, maxSettlements: 30 });
  assert.equal(sc.settlements.length, 30);
  assert.equal(sc.settlements[0].id, fixture.rows[0].settlement_pcode);
  assert.equal(sc.settlements[0].priority, 10, 'top rank → priority 10');
  for (let i = 1; i < sc.settlements.length; i++) assert.ok(sc.settlements[i].priority <= sc.settlements[i - 1].priority);
  assert.ok(Math.abs(sc.range - 10 * sc.meta.pxPerKm) < 1e-9, 'range is rangeKm × pxPerKm');
  assert.ok(sc.meta.parameters.some((p) => /not a measured radio figure/.test(p)));
  assert.equal(sc.settlements[0].populationBasis, 'parent');
});

test('engine runs end-to-end on real settlements; ferry rows carry real lat/lon + P-codes and stay simulation', () => {
  const sc = scenarioFromPriorityRank(fixture.rows, { rangeKm: 12, maxSettlements: 30 });
  const eng = new SimEngine(sc);
  let s; do { s = eng.step(); } while (s.phase === 'placing');
  s = eng.step();
  assert.ok(s.alloc.suggested_pairings.length > 0);
  for (const r of eng.relays) eng.cutRelay(r.id);
  s = eng.step();
  assert.ok(s.ferry, 'some settlement is cut off after all relays fail');
  assert.equal(s.ferry.is_simulation, true);
  assert.equal(s.ferry.disaster_event_id, fixture.rows[0].disaster_event_id);
  const w = s.ferry.waypoints[0];
  assert.match(w.admin_unit_id, /^NP\d+$/); assert.ok(Number.isFinite(w.lat) && Number.isFinite(w.lon));
  assert.ok(Number.isFinite(s.ferry.relay_positions[0].lat), 'relay positions unprojected to lat/lon');
});
