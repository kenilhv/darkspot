/**
 * DOM-free simulation engine that the browser page (web/sim.js) renders and
 * the tests drive headlessly. Everything it produces is simulation output
 * (is_simulation = true); it never issues an instruction to anyone (Rule 1),
 * and contains no LLM call (Rule 3 / D-4).
 *
 * Phases:
 *   'placing'  — PSO relay placement replayed one iteration per tick (pso.js)
 *   'running'  — mesh formed; per tick: AntHocNet hello/proactive round, data
 *                packets on every session (AODV baseline runs in parallel on
 *                an identical network copy for comparison), then taskforce
 *                allocation re-solved (allocation.js) and diffed against the
 *                previous tick so the renderer can animate re-pairings.
 * Scenario events (`congest`, `cutRelay`, `bumpPriority`, `restore`) are the
 * user-triggerable perturbations the visualisation is meant to make legible.
 */
import { makeRng } from './rng.js';
import { dist, radioAdjacency, components } from './geometry.js';
import { psoRelayPlacement } from './pso.js';
import { Network } from './net.js';
import { AntHocNet } from './anthocnet.js';
import { AODV } from './aodv.js';
import { allocate } from './allocation.js';
import { ferryRouteRow } from './ferry.js';

export function buildScenario({ seed = 7, width = 900, height = 560, settlements = 18, units = 4, relays = 5, range = 150 } = {}) {
  const rng = makeRng(seed);
  const bridge = { id: 'bridge', x: 70, y: height / 2 };
  const setts = [];
  // three loose clusters so relays have real work to do, plus a couple of outliers
  const centers = [[300, 150], [520, 400], [760, 200]];
  for (let i = 0; i < settlements; i++) {
    const c = centers[i % centers.length];
    const spread = 110;
    const x = Math.min(width - 30, Math.max(30, c[0] + (rng() - 0.5) * 2 * spread));
    const y = Math.min(height - 30, Math.max(30, c[1] + (rng() - 0.5) * 2 * spread));
    const silenceHours = Math.round(rng() * 60);
    const population = Math.round(200 + rng() * 4800);
    const hazard = rng() < 0.4 ? 'high' : 'unknown';
    setts.push({ id: `S${i + 1}`, x, y, silenceHours, population, hazard,
      // priority rank surrogate: silence × population × hazard, same shape as §2 mv_priority_rank
      priority: +(((silenceHours + 1) / 24) * (population / 1000) * (hazard === 'high' ? 2 : 1)).toFixed(2) });
  }
  // outliers, far from everything, that a ferry would have to visit
  setts.push({ id: `S${settlements + 1}`, x: width - 60, y: height - 50, silenceHours: 70, population: 900, hazard: 'unknown', priority: 2.7 });
  const unitList = Array.from({ length: units }, (_, i) => ({ id: ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'][i] ?? `u${i}`, x: bridge.x + 46 + (i % 2) * 70, y: bridge.y + 64 + Math.floor(i / 2) * 34 }));
  return { seed, width, height, range, bridge, settlements: setts, units: unitList, relayCount: relays };
}

export class SimEngine {
  constructor(scenario) {
    this.sc = scenario;
    this.tick = 0;
    this.phase = 'placing';
    this.events = [];      // human-readable log lines (descriptive, never imperative)
    this.rng = makeRng(scenario.seed + 1);
    this._pso();
  }

  _pso() {
    const sc = this.sc;
    this.psoFrames = [];
    this.pso = psoRelayPlacement({
      clients: sc.settlements, k: sc.relayCount, range: sc.range,
      bounds: { xMin: 40, xMax: sc.width - 40, yMin: 40, yMax: sc.height - 40 },
      anchor: sc.bridge, particles: 24, iters: 120, seed: sc.seed,
      onIter: (f) => this.psoFrames.push({ iter: f.iter, gbest: f.gbest.map((p) => ({ ...p })), gbestFit: f.gbestFit, particles: f.particles.map((ps) => ps.map((p) => ({ ...p }))) }),
    });
    this.psoFrame = 0;
    this.relays = this.psoFrames.length ? this.psoFrames[0].gbest : this.pso.relays;
    this.log(`PSO relay placement started: ${sc.relayCount} relays, ${this.psoFrames.length} iterations (swarm-intelligence-inspired; simulation)`);
  }

  log(msg) { this.events.unshift({ tick: this.tick, msg }); if (this.events.length > 60) this.events.pop(); }

  /** Build mesh + protocols once PSO is done. */
  _formMesh() {
    const sc = this.sc;
    this.relays = this.pso.relays.map((p, i) => ({ id: `R${i + 1}`, x: p.x, y: p.y }));
    const nodes = [sc.bridge, ...this.relays, ...sc.settlements].map((n) => ({ id: n.id, x: n.x, y: n.y }));
    this.net = new Network({ nodes, range: sc.range, seed: sc.seed });
    this.netBaseline = new Network({ nodes: nodes.map((n) => ({ ...n })), range: sc.range, seed: sc.seed });
    this.ant = new AntHocNet(this.net, { seed: sc.seed });
    this.aodv = new AODV(this.netBaseline);
    // sessions: bridge <-> the 4 highest-priority settlements reachable on the mesh
    const comp = this._components(this.net);
    const bridgeComp = comp.get('bridge');
    this.sessions = sc.settlements.filter((s) => comp.get(s.id) === bridgeComp).sort((a, b) => b.priority - a.priority).slice(0, 4).map((s) => ({ s: 'bridge', d: s.id }));
    for (const { s, d } of this.sessions) { this.ant.reactiveSetup(s, d); this.aodv.discover(s, d); }
    this.units = sc.units.map((u) => ({ ...u, nodeId: this._nearestNode(u).id }));
    this.pairings = new Map();
    this.phase = 'running';
    this.log(`Mesh formed: ${this.relays.length} relays, ${this.sessions.length} sessions from the bridge. AntHocNet live; AODV baseline in parallel.`);
    this._ferry();
  }

  _components(net) {
    const ids = net.nodes.map((n) => n.id);
    const adj = ids.map((id) => new Set([...net.neighbors(id)].map((m) => ids.indexOf(m))));
    const comps = components(adj); const m = new Map();
    comps.forEach((c, ci) => c.forEach((i) => m.set(ids[i], ci)));
    return m;
  }
  _nearestNode(p) { let b = null, bd = Infinity; for (const n of this.net.nodes) { const d = dist(n, p); if (d < bd) { bd = d; b = n; } } return b; }

  _ferry() {
    const comp = this._components(this.net);
    const bc = comp.get('bridge');
    const cut = this.sc.settlements.filter((s) => comp.get(s.id) !== bc);
    const geo = this.sc.unproject ? this.relays.map((r) => ({ ...r, ...this.sc.unproject(r.x, r.y) })) : this.relays;
    this.ferry = cut.length ? ferryRouteRow({ routeId: `sim-${this.sc.seed}-${this.tick}`, disasterEventId: this.sc.meta?.disaster_event_id ?? null, start: this.sc.bridge, targets: cut, relays: geo }) : null;
    if (this.ferry) this.log(`${cut.length} settlement(s) have no mesh path to the bridge; a message-ferry tour is shown — SIMULATION, no aircraft involved.`);
  }

  meshGraph() {
    const nodeIds = this.net.nodes.map((n) => n.id);
    const adjacency = new Map(nodeIds.map((id) => [id, this.net.neighbors(id)]));
    return { nodeIds, adjacency };
  }

  /** Tasks = the settlements (their current priority) attached to their own mesh node. */
  tasks() { return this.sc.settlements.map((s) => ({ id: s.id, x: s.x, y: s.y, priority: s.priority, nodeId: s.id })); }

  step() {
    this.tick++;
    if (this.phase === 'placing') {
      this.psoFrame++;
      if (this.psoFrame < this.psoFrames.length) { this.relays = this.psoFrames[this.psoFrame].gbest; return this.snapshot(); }
      this._formMesh();
      return this.snapshot();
    }
    // routing round
    this.ant.helloRound();
    for (const { s, d } of this.sessions) this.ant.proactiveCheck(s, d);
    this.packets = [];
    let delivered = 0, delayAnt = 0, delayAodv = 0, deliveredAodv = 0;
    for (const { s, d } of this.sessions) {
      for (let p = 0; p < 2; p++) {
        const r = this.ant.sendData(s, d);
        this.packets.push({ proto: 'ant', path: r.path, delivered: r.delivered });
        if (r.delivered) { delivered++; delayAnt += r.delay; }
        const b = this.aodv.sendData(s, d);
        if (b.delivered) { deliveredAodv++; delayAodv += b.delay; }
        this.packets.push({ proto: 'aodv', path: b.path, delivered: b.delivered });
      }
    }
    const n = this.sessions.length * 2;
    this.metrics = {
      ant: { delivery: n ? delivered / n : 0, meanDelayMs: delivered ? (delayAnt / delivered) * 1000 : null },
      aodv: { delivery: n ? deliveredAodv / n : 0, meanDelayMs: deliveredAodv ? (delayAodv / deliveredAodv) * 1000 : null },
    };
    // allocation
    this.units.forEach((u) => { u.nodeId = this._nearestNode(u).id; });
    this.alloc = allocate({ units: this.units, tasks: this.tasks(), mesh: this.meshGraph(), commandNodeId: 'bridge' });
    const next = new Map(this.alloc.suggested_pairings.map((p) => [p.unitId, p]));
    this.changes = [];
    for (const [uid, p] of next) {
      const prev = this.pairings.get(uid);
      if (!prev || prev.taskId !== p.taskId || prev.mode !== p.mode) this.changes.push({ unitId: uid, from: prev ?? null, to: p });
    }
    for (const [uid, prev] of this.pairings) if (!next.has(uid)) this.changes.push({ unitId: uid, from: prev, to: null });
    for (const c of this.changes) {
      if (c.to && c.from && c.from.taskId !== c.to.taskId) this.log(`${c.unitId}: suggested pairing changed ${c.from.taskId} → ${c.to.taskId} (${c.to.mode})`);
      else if (c.to && c.from && c.from.mode !== c.to.mode) this.log(`${c.unitId}: allocation mode ${c.from.mode} → ${c.to.mode} (connectivity to command changed)`);
      else if (c.to && !c.from) this.log(`${c.unitId}: suggested pairing with ${c.to.taskId} (${c.to.mode})`);
      else if (!c.to) this.log(`${c.unitId}: no visible task in its mesh component`);
    }
    this.pairings = next;
    return this.snapshot();
  }

  // ---- scenario events ----------------------------------------------------
  congest(nodeId, q = 10) {
    if (!this.net) return;
    this.net.setQueue(nodeId, q); this.netBaseline.setQueue(nodeId, q);
    this.log(`${nodeId}: MAC queue set to ${q} (congestion injected)`);
  }
  cutRelay(relayId) {
    if (!this.net) return;
    for (const nb of [...this.net.neighbors(relayId)]) { this.net.cutLink(relayId, nb); this.netBaseline.cutLink(relayId, nb); }
    this.log(`${relayId}: all links cut (relay failure injected)`);
    this._ferry();
  }
  restore() {
    if (!this.net) return;
    for (const net of [this.net, this.netBaseline]) { net.cut.clear(); net.invalidate(); for (const n of net.nodes) n.queue = 0; }
    this.log('All links restored and queues cleared');
    this._ferry();
  }
  bumpPriority(settlementId, factor = 8) {
    const s = this.sc.settlements.find((x) => x.id === settlementId); if (!s) return;
    s.priority = +(s.priority * factor).toFixed(2);
    this.log(`${settlementId}: priority raised to ${s.priority} (e.g. new corroborated report)`);
  }

  snapshot() {
    return {
      tick: this.tick, phase: this.phase, relays: this.relays,
      psoFrame: this.psoFrames[Math.min(this.psoFrame, this.psoFrames.length - 1)] ?? null,
      psoFitness: this.pso.fitness, psoEval: this.pso.eval,
      sessions: this.sessions ?? [], packets: this.packets ?? [], metrics: this.metrics ?? null,
      alloc: this.alloc ?? null, changes: this.changes ?? [], units: this.units ?? [],
      ferry: this.ferry ?? null, events: this.events, is_simulation: true,
    };
  }
}
