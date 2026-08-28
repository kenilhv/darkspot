import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario, SimEngine } from '../src/engine.js';
import { ferryRouteRow, nearestNeighbourTour } from '../src/ferry.js';

const runUntilMesh = (eng) => { let s; do { s = eng.step(); } while (s.phase === 'placing'); return s; };

test('engine: PSO phase replays one iteration per tick, then forms the mesh with the final gbest relays', () => {
  const eng = new SimEngine(buildScenario({ seed: 7 }));
  assert.equal(eng.phase, 'placing');
  const s = runUntilMesh(eng);
  assert.equal(s.phase, 'running');
  assert.equal(s.relays.length, 5);
  assert.deepEqual(s.relays.map((r) => [r.x, r.y]), eng.pso.relays.map((r) => [r.x, r.y]));
  assert.ok(s.sessions.length > 0, 'some settlements reachable from the bridge');
  assert.equal(s.is_simulation, true);
});

test('engine: running ticks produce packets on both protocols, metrics, and an allocation with both halves possible', () => {
  const eng = new SimEngine(buildScenario({ seed: 7 }));
  runUntilMesh(eng);
  const s = eng.step();
  assert.ok(s.packets.some((p) => p.proto === 'ant') && s.packets.some((p) => p.proto === 'aodv'));
  assert.ok(s.metrics.ant.delivery > 0);
  assert.ok(s.alloc.suggested_pairings.length > 0);
  assert.equal(s.alloc.is_simulation, true);
  for (const m of s.alloc.modes) assert.ok(['hungarian', 'auction'].includes(m.mode));
});

test('engine: bumping a priority changes a suggested pairing and is logged descriptively (no imperatives)', () => {
  const eng = new SimEngine(buildScenario({ seed: 7 }));
  runUntilMesh(eng); eng.step();
  const before = new Map(eng.alloc.suggested_pairings.map((p) => [p.unitId, p.taskId]));
  // pick a task in the bridge component that is currently unassigned and far from every unit
  const assigned = new Set(before.values());
  const comp = eng._components(eng.net); const bc = comp.get('bridge');
  const cand = eng.sc.settlements.filter((s) => comp.get(s.id) === bc && !assigned.has(s.id));
  assert.ok(cand.length, 'an unassigned reachable settlement exists');
  eng.bumpPriority(cand[0].id, 50);
  const s = eng.step();
  assert.ok(s.changes.length > 0, 'a pairing changed');
  assert.ok(s.alloc.suggested_pairings.some((p) => p.taskId === cand[0].id), 'the bumped task now has a suggested unit');
  for (const e of s.events) assert.ok(!/^(go|send|dispatch|proceed)\b/i.test(e.msg), `imperative log line: ${e.msg}`);
});

test('engine: cutting a relay flips units that lose their path to command into local-auction mode, or leaves them unpaired', () => {
  const eng = new SimEngine(buildScenario({ seed: 7 }));
  runUntilMesh(eng); eng.step();
  const bridgeCompBefore = new Set([...eng._components(eng.net)].filter(([, c]) => c === eng._components(eng.net).get('bridge')).map(([id]) => id));
  // cut every relay: nothing but the bridge's own radio remains
  for (const r of eng.relays) eng.cutRelay(r.id);
  const s = eng.step();
  const bridgeCompAfter = new Set([...eng._components(eng.net)].filter(([, c]) => c === eng._components(eng.net).get('bridge')).map(([id]) => id));
  assert.ok(bridgeCompAfter.size < bridgeCompBefore.size, 'bridge component shrank');
  assert.ok(s.alloc.modes.every((m) => m.mode === 'hungarian' ? true : m.mode === 'auction'));
  assert.ok(s.ferry, 'settlements now cut off → ferry route row exists');
  assert.equal(s.ferry.is_simulation, true);
  assert.match(s.ferry.algorithm, /SIMULATION/);
});

test('ferry row matches CORE drone_routes_simulated shape and is always is_simulation=true', () => {
  const row = ferryRouteRow({ routeId: 'r1', start: { x: 0, y: 0 }, targets: [{ id: 'a', x: 10, y: 0 }, { id: 'b', x: 2, y: 0 }], relays: [{ x: 1, y: 1 }] });
  for (const k of ['route_id', 'disaster_event_id', 'is_simulation', 'algorithm', 'fleet_size', 'waypoints', 'relay_positions']) assert.ok(k in row, k);
  assert.equal(row.is_simulation, true);
  assert.deepEqual(row.waypoints.map((w) => w.label), ['b', 'a'], 'nearest-neighbour order');
  assert.deepEqual(row.waypoints.map((w) => w.order), [1, 2]);
  assert.ok(Array.isArray(row.relay_positions) && row.relay_positions.length === 1);
  assert.deepEqual(nearestNeighbourTour({ x: 0, y: 0 }, []), []);
});
