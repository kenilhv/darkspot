import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hungarian } from '../src/hungarian.js';
import { ssiAuction } from '../src/auction.js';
import { allocate, defaultCost } from '../src/allocation.js';
import { makeRng } from '../src/rng.js';

const bruteForce = (M) => { // exhaustive optimum for small square matrices
  const n = M.length; let best = Infinity;
  const perm = (used, i, acc) => {
    if (i === n) { best = Math.min(best, acc); return; }
    for (let j = 0; j < n; j++) if (!used[j]) { used[j] = true; perm(used, i + 1, acc + M[i][j]); used[j] = false; }
  };
  perm(new Array(n).fill(false), 0, 0); return best;
};

test('hungarian: matches brute-force optimum on random square matrices', () => {
  const rng = makeRng(3);
  for (let trial = 0; trial < 30; trial++) {
    const n = 2 + rng.int(6);
    const M = Array.from({ length: n }, () => Array.from({ length: n }, () => Math.round(rng() * 100)));
    const { assignment, cost } = hungarian(M);
    assert.equal(new Set(assignment).size, n, 'one-to-one');
    assert.equal(cost, bruteForce(M));
  }
});

test('hungarian: rectangular (more tasks than units, and more units than tasks)', () => {
  // 2 units, 3 tasks: unit0 -> task2 (1), unit1 -> task0 (2) = 3
  const wide = [[5, 9, 1], [2, 8, 7]];
  const r1 = hungarian(wide);
  assert.deepEqual(r1.assignment, [2, 0]); assert.equal(r1.cost, 3);
  // 3 units, 2 tasks: transposed
  const tall = [[5, 2], [9, 8], [1, 7]];
  const r2 = hungarian(tall);
  assert.equal(r2.cost, 3); assert.deepEqual(r2.assignment, [1, -1, 0]);
});

test('ssi auction: each round awards the single lowest bid, winners drop out, one task per unit', () => {
  const units = [{ id: 'u1', x: 0, y: 0 }, { id: 'u2', x: 10, y: 0 }];
  const tasks = [{ id: 'tA', x: 1, y: 0, priority: 1 }, { id: 'tB', x: 9, y: 0, priority: 1 }, { id: 'tC', x: 5, y: 0, priority: 1 }];
  const r = ssiAuction(units, tasks, defaultCost);
  assert.equal(r.rounds.length, 2);
  assert.equal(r.rounds[0].bids.length, 6, 'round 1: 2 units × 3 tasks');
  assert.deepEqual(r.rounds[0].awarded, { unitId: 'u1', taskId: 'tA', bid: 1 });
  assert.equal(r.rounds[1].bids.length, 2, 'round 2: only u2 bids, on 2 remaining tasks');
  assert.deepEqual(r.pairings.map((p) => [p.unitId, p.taskId]), [['u1', 'tA'], ['u2', 'tB']]);
  assert.deepEqual(r.unassignedTasks, ['tC']);
});

test('ssi auction is never better than Hungarian, and measured gap is small on random instances', () => {
  const rng = makeRng(8);
  let worst = 0, sumRatio = 0, N = 200;
  for (let t = 0; t < N; t++) {
    const n = 3 + rng.int(5);
    const units = Array.from({ length: n }, (_, i) => ({ id: `u${i}`, x: rng() * 100, y: rng() * 100 }));
    const tasks = Array.from({ length: n }, (_, i) => ({ id: `t${i}`, x: rng() * 100, y: rng() * 100, priority: 1 }));
    const h = hungarian(units.map((u) => tasks.map((tk) => defaultCost(u, tk)))).cost;
    const a = ssiAuction(units, tasks, defaultCost).cost;
    assert.ok(a >= h - 1e-9);
    worst = Math.max(worst, a / h); sumRatio += a / h;
  }
  // Koenig et al. 2006 prove a constant-factor bound for SSI; we just record what we observe.
  assert.ok(sumRatio / N < 1.25, `mean auction/optimal ratio ${sumRatio / N}`);
  assert.ok(worst < 2.5, `worst ratio ${worst}`);
});

// A small mesh: command C — n1 — n2 ; n3 — n4 (separate island)
const mesh = (cutN1N2 = false) => {
  const adjacency = new Map([['C', new Set(['n1'])], ['n1', new Set(['C', 'n2'])], ['n2', new Set(['n1'])], ['n3', new Set(['n4'])], ['n4', new Set(['n3'])]]);
  if (cutN1N2) { adjacency.get('n1').delete('n2'); adjacency.get('n2').delete('n1'); }
  return { nodeIds: ['C', 'n1', 'n2', 'n3', 'n4'], adjacency };
};
const units = [
  { id: 'alpha', x: 0, y: 0, nodeId: 'n1' }, { id: 'bravo', x: 10, y: 0, nodeId: 'n2' },
  { id: 'charlie', x: 50, y: 50, nodeId: 'n3' },
];
const tasks = [
  { id: 'T1', x: 1, y: 0, priority: 1, nodeId: 'n1' }, { id: 'T2', x: 11, y: 0, priority: 1, nodeId: 'n2' },
  { id: 'T3', x: 52, y: 50, priority: 1, nodeId: 'n4' }, { id: 'T4', x: 60, y: 50, priority: 1, nodeId: 'n3' },
];

test('allocation: units with a path to command get Hungarian; an island runs a local auction on what it can see', () => {
  const r = allocate({ units, tasks, mesh: mesh(), commandNodeId: 'C' });
  const byUnit = Object.fromEntries(r.suggested_pairings.map((p) => [p.unitId, p]));
  assert.equal(byUnit.alpha.mode, 'hungarian'); assert.equal(byUnit.alpha.taskId, 'T1');
  assert.equal(byUnit.bravo.mode, 'hungarian'); assert.equal(byUnit.bravo.taskId, 'T2');
  assert.equal(byUnit.charlie.mode, 'auction'); assert.equal(byUnit.charlie.taskId, 'T3');
  assert.deepEqual(r.unitsWithoutCommand, ['charlie']);
  assert.deepEqual(r.unassignedTasks, ['T4']);
  assert.equal(r.is_simulation, true);
  const keys = new Set(); JSON.stringify(r, (k, v) => { keys.add(k.toLowerCase()); return v; });
  for (const k of keys) assert.ok(!/dispatch|order|go_to|send/.test(k), `Rule 1: no dispatch-shaped field, found "${k}"`);
  assert.match(r.note, /Not a dispatch order/);
});

test('allocation: losing the link to command flips a unit from Hungarian to local auction (same tick, no central input)', () => {
  const r = allocate({ units, tasks, mesh: mesh(true), commandNodeId: 'C' });
  const bravo = r.suggested_pairings.find((p) => p.unitId === 'bravo');
  assert.equal(bravo.mode, 'auction');
  assert.equal(bravo.taskId, 'T2', 'still pairs with the task its own node can see');
  assert.ok(r.unitsWithoutCommand.includes('bravo'));
  // alpha, alone with command, is still solved centrally — but now only sees T1
  const alpha = r.suggested_pairings.find((p) => p.unitId === 'alpha');
  assert.equal(alpha.mode, 'hungarian'); assert.equal(alpha.taskId, 'T1');
});

test('allocation: raising a task priority visibly reassigns units (the thing the visualisation must show)', () => {
  // command component has alpha (0,0), bravo (10,0); tasks T1 (1,0), T2 (11,0), plus a far T5 (30,0)
  const tasks2 = [...tasks.slice(0, 2), { id: 'T5', x: 30, y: 0, priority: 1, nodeId: 'n2' }];
  const before = allocate({ units, tasks: tasks2, mesh: mesh(), commandNodeId: 'C' });
  assert.deepEqual(before.unassignedTasks, ['T5', ]);
  const bumped = tasks2.map((t) => (t.id === 'T5' ? { ...t, priority: 40 } : t));
  const after = allocate({ units, tasks: bumped, mesh: mesh(), commandNodeId: 'C' });
  const bravo = after.suggested_pairings.find((p) => p.unitId === 'bravo');
  assert.equal(bravo.taskId, 'T5', 'bravo re-pairs to the now-high-priority task');
  assert.ok(after.unassignedTasks.includes('T2'));
});
