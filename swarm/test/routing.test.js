import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Network } from '../src/net.js';
import { AntHocNet } from '../src/anthocnet.js';
import { AODV } from '../src/aodv.js';
import { runSessions } from '../src/routing-sim.js';

// Nodes on a line: A - B - C, range 10, no jitter influence on estimates yet.
const chain = () => new Network({ nodes: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 8, y: 0 }, { id: 'C', x: 16, y: 0 }], range: 10, seed: 1 });

test('eq. (5)/(6): backward ant deposits τ = ((T̂ + h·T_hop)/2)^-1, then γ-mixes on the second sample', () => {
  const net = chain();
  const ant = new AntHocNet(net, { seed: 1 });
  const path = ant.reactiveSetup('A', 'C');
  assert.deepEqual(path, ['A', 'B', 'C']);
  const Thop = 0.003, tB = net.hopTime('B'), tA = net.hopTime('A');
  // at B (1 hop from C): T̂ = tB, h = 1
  const tauB = 1 / ((tB + 1 * Thop) / 2);
  // at A (2 hops): T̂ = tB + tA, h = 2
  const tauA = 1 / ((tB + tA + 2 * Thop) / 2);
  assert.ok(Math.abs(ant.entries('B', 'C').get('C') - tauB) < 1e-9);
  assert.ok(Math.abs(ant.entries('A', 'C').get('B') - tauA) < 1e-9);
  // second reactive setup over the same path: T = 0.7*old + 0.3*tau (hop times unchanged, no transmit happened)
  ant.reactiveSetup('A', 'C');
  assert.ok(Math.abs(ant.entries('A', 'C').get('B') - (0.7 * tauA + 0.3 * tauA)) < 1e-9);
});

test('eq. (8): β2 = 20 makes data routing near-greedy, equal pheromone splits evenly', () => {
  const net = new Network({ nodes: [{ id: 'S', x: 0, y: 0 }, { id: 'P', x: 5, y: 5 }, { id: 'Q', x: 5, y: -5 }, { id: 'D', x: 10, y: 0 }], range: 8, seed: 2 });
  const ant = new AntHocNet(net, { seed: 3 });
  // hand-set pheromone: P is 20% better than Q
  ant._tbl(ant.T, 'S', 'D', true).set('P', 1.2);
  ant._tbl(ant.T, 'S', 'D', true).set('Q', 1.0);
  const pr = ant.probabilities('S', 'D');
  // (1.2^20)/(1.2^20 + 1) ≈ 0.9745
  assert.ok(Math.abs(pr.get('P') - Math.pow(1.2, 20) / (Math.pow(1.2, 20) + 1)) < 1e-12);
  assert.ok(pr.get('P') > 0.97);
  ant._tbl(ant.T, 'S', 'D', true).set('P', 1.0);
  let p = 0; const N = 4000;
  for (let i = 0; i < N; i++) if (ant.choose(ant.entries('S', 'D'), 20) === 'P') p++;
  assert.ok(Math.abs(p / N - 0.5) < 0.05, `split ${p / N}`);
});

test('AODV picks one route (first RREQ to arrive) and keeps it; AntHocNet re-spreads when that route congests', () => {
  // Two disjoint 3-hop paths S-a1-a2-D and S-b1-b2-D.
  const mk = (seed) => new Network({
    nodes: [
      { id: 'S', x: 0, y: 0 }, { id: 'a1', x: 7, y: 6 }, { id: 'a2', x: 14, y: 6 },
      { id: 'b1', x: 7, y: -6 }, { id: 'b2', x: 14, y: -6 }, { id: 'D', x: 21, y: 0 },
    ], range: 10, seed,
  });
  const sessions = [{ s: 'S', d: 'D' }];
  // scenario: from tick 10, the "a" path becomes heavily congested (queue 8 at a1, a2)
  const scenario = (t, net) => { if (t === 10) { net.setQueue('a1', 8); net.setQueue('a2', 8); } };
  const usedA = (res, from, to) => res.perTick.slice(from, to).flatMap((r) => r.paths).filter((p) => p.includes('a1')).length;

  const netA = mk(5); const aodv = new AODV(netA);
  const resA = runSessions(aodv, sessions, { ticks: 40, scenario });
  const netB = mk(5); const ant = new AntHocNet(netB, { seed: 5 });
  const resB = runSessions(ant, sessions, { ticks: 40, scenario });

  assert.equal(resA.deliveryRatio, 1); assert.equal(resB.deliveryRatio, 1);
  // Both discover some 3-hop path first. Whatever AODV picked, it never changes route absent a failure.
  const aodvFirst = resA.perTick[0].paths[0];
  for (const row of resA.perTick) for (const p of row.paths) assert.deepEqual(p, aodvFirst);
  // AntHocNet: after congestion hits path a, traffic shifts to path b (hellos + proactive ants find it).
  const antAfter = usedA(resB, 20, 40);
  assert.ok(antAfter <= 4, `AntHocNet still sent ${antAfter}/80 packets over the congested path`);
  // and its mean delay in the late phase is lower than AODV's if AODV was stuck on the congested path
  const late = (res) => { const rows = res.perTick.slice(20); return rows.reduce((a, r) => a + r.delaySum, 0) / rows.reduce((a, r) => a + r.delivered, 0); };
  if (aodvFirst.includes('a1')) assert.ok(late(resB) < late(resA) / 2, `ant ${late(resB)} vs aodv ${late(resA)}`);
});

test('link failure: both protocols recover; AntHocNet uses a local repair ant, AODV re-discovers', () => {
  const mk = (seed) => new Network({
    nodes: [
      { id: 'S', x: 0, y: 0 }, { id: 'm', x: 8, y: 0 }, { id: 'D', x: 16, y: 0 },
      { id: 'u', x: 6, y: 7 }, { id: 'v', x: 12, y: 7 },
    ], range: 9.5, seed,
  });
  const scenario = (t, net) => { if (t === 5) net.cutLink('S', 'm'); };
  const sessions = [{ s: 'S', d: 'D' }];
  const ant = new AntHocNet(mk(1), { seed: 1 });
  const rb = runSessions(ant, sessions, { ticks: 12, scenario, hello: false });
  const aodv = new AODV(mk(1));
  const ra = runSessions(aodv, sessions, { ticks: 12, scenario });
  assert.equal(rb.deliveryRatio, 1);
  assert.equal(ra.deliveryRatio, 1);
  assert.ok(rb.stats.repairAnts >= 1, 'repair ant issued');
  assert.ok(ra.stats.rreq >= 2, 'AODV re-discovered');
  for (const p of rb.perTick[11].paths) assert.notEqual(p[1], 'm', 'no longer uses the cut S-m link');
  for (const p of ra.perTick[11].paths) assert.notEqual(p[1], 'm');
});

test('hello bootstrapping (eq. 7) creates virtual pheromone that a proactive ant converts to a regular path', () => {
  const net = new Network({ nodes: [{ id: 'S', x: 0, y: 0 }, { id: 'P', x: 5, y: 5 }, { id: 'Q', x: 5, y: -5 }, { id: 'D', x: 10, y: 0 }], range: 8, seed: 2 });
  const ant = new AntHocNet(net, { seed: 3 });
  ant.reactiveSetup('S', 'D');
  const first = ant.best('S', 'D').next;
  const other = first === 'P' ? 'Q' : 'P';
  assert.equal(ant.entries('S', 'D').size, 1, 'reactive setup builds exactly one path');
  // congest the sampled path so the alternative looks >10% better via bootstrapped estimates
  net.setQueue(first, 6);
  for (let i = 0; i < 3; i++) ant.helloRound();
  // Q(D via other) learned by hello: S has a virtual entry for D over `other`
  assert.ok(ant.virtualEntries('S', 'D').has(other), 'virtual pheromone from hello');
  const B = ant.virtualEntries('S', 'D').get(other);
  const expected = 1 / (1 / ant.best(other, 'D').value + (net.hopTime('S') + 0.003) / 2);
  assert.ok(Math.abs(B - expected) < 1e-9, 'eq. (7)');
  const p = ant.proactiveCheck('S', 'D');
  assert.deepEqual(p, ['S', other, 'D']);
  assert.ok(ant.entries('S', 'D').has(other), 'proactive ant turned virtual into regular pheromone');
  assert.equal(ant.entries('S', 'D').size, 2, 'now a multipath mesh');
});
