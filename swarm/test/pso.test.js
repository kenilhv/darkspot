import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psoRelayPlacement, evaluatePlacement } from '../src/pso.js';
import { makeRng } from '../src/rng.js';

const bounds = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };

test('fitness: SGC counts only relays connected to the anchor; NCMC counts clients covered by that component', () => {
  const anchor = { x: 0, y: 0 };
  const clients = [{ x: 9, y: 0 }, { x: 90, y: 90 }];
  // relay A connected to anchor, relay B isolated near far client
  const e = evaluatePlacement([{ x: 8, y: 0 }, { x: 88, y: 90 }], clients, 10, { anchor });
  assert.equal(e.sgc, 1);
  assert.equal(e.ncmc, 1); // far client is covered by B, but B is not in the anchor's component
  assert.deepEqual(e.coveredMask, [true, false]);
  assert.ok(Math.abs(e.fitness - (0.7 * 0.5 + 0.3 * 0.5)) < 1e-12);
});

test('gbest fitness is monotonically non-decreasing (basic PSO invariant)', () => {
  const rng = makeRng(7);
  const clients = Array.from({ length: 20 }, () => ({ x: rng.range(0, 100), y: rng.range(0, 100) }));
  const r = psoRelayPlacement({ clients, k: 5, range: 20, bounds, anchor: { x: 0, y: 0 }, iters: 60, seed: 3 });
  for (let i = 1; i < r.history.length; i++) assert.ok(r.history[i] >= r.history[i - 1]);
  assert.equal(r.is_simulation, true);
});

test('bridges a gap: two client clusters far apart, anchor at one end -> PSO chains relays across', () => {
  // Clusters at x~10 and x~90, radio range 25: needs a chain of relays across a 60-unit gap.
  const rng = makeRng(11);
  const clients = [];
  for (let i = 0; i < 8; i++) clients.push({ x: rng.range(5, 15), y: rng.range(40, 60) });
  for (let i = 0; i < 8; i++) clients.push({ x: rng.range(85, 95), y: rng.range(40, 60) });
  const anchor = { x: 5, y: 50 };
  const r = psoRelayPlacement({ clients, k: 4, range: 25, bounds, anchor, particles: 40, iters: 300, seed: 5 });
  assert.equal(r.eval.sgc, 4, 'all relays connected back to the anchor');
  assert.equal(r.eval.ncmc, 16, 'every client covered');
});

test('beats random placement on the same scenario (same evaluation budget)', () => {
  const rng = makeRng(99);
  const clients = Array.from({ length: 25 }, () => ({ x: rng.range(0, 100), y: rng.range(0, 100) }));
  const anchor = { x: 50, y: 50 };
  const k = 5, range = 22;
  const r = psoRelayPlacement({ clients, k, range, bounds, anchor, particles: 30, iters: 100, seed: 1 });
  // random search with the same number of evaluations
  let best = -Infinity;
  for (let i = 0; i < 30 * 101; i++) {
    const relays = Array.from({ length: k }, () => ({ x: rng.range(0, 100), y: rng.range(0, 100) }));
    best = Math.max(best, evaluatePlacement(relays, clients, range, { anchor }).fitness);
  }
  assert.ok(r.fitness >= best, `pso ${r.fitness} vs random ${best}`);
});

test('deterministic under a fixed seed', () => {
  const clients = [{ x: 30, y: 30 }, { x: 70, y: 70 }];
  const a = psoRelayPlacement({ clients, k: 2, range: 20, bounds, iters: 20, seed: 42 });
  const b = psoRelayPlacement({ clients, k: 2, range: 20, bounds, iters: 20, seed: 42 });
  assert.deepEqual(a.relays, b.relays);
});
