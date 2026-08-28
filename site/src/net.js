/**
 * Minimal mesh network model shared by the routing protocols (AntHocNet-inspired
 * and AODV baseline) so they are compared on identical assumptions.
 *
 * Time model follows AntHocNet's own delay estimate (Ducatelle, Di Caro,
 * Gambardella, "Using ant agents to combine reactive and proactive strategies
 * for routing in mobile ad-hoc networks", IJCIA 5(2), 2005, eqs. 3–4):
 *   hop time from node i          T^i_{i+1} = (Q^i_mac + 1) * T̂^i_mac      (eq. 3)
 *   MAC send-time running average T̂^i_mac  = α T̂^i_mac + (1-α) t^i_mac     (eq. 4)
 * where Q^i_mac is the number of packets queued at i and t^i_mac the measured
 * time of the last transmission. Here t^i_mac is drawn as a per-node base time
 * with small seeded jitter — this is a simulation, not a radio model.
 *
 * Links: two nodes are neighbours iff within `range` (unit disk). Node moves
 * and link failures are injected by scenarios (`moveNode`, `cutLink`).
 */
import { makeRng } from './rng.js';
import { dist } from './geometry.js';

export class Network {
  constructor({ nodes, range, baseMac = 0.003, alpha = 0.7, seed = 1 }) {
    // nodes: [{id, x, y, queue?}]
    this.range = range;
    this.alpha = alpha;
    this.rng = makeRng(seed);
    this.nodes = nodes.map((n, idx) => ({
      id: n.id ?? idx, x: n.x, y: n.y,
      queue: n.queue ?? 0,        // Q_mac: packets waiting at the MAC layer (scenario-controlled load)
      tMacEst: n.baseMac ?? baseMac, // T̂_mac
      baseMac: n.baseMac ?? baseMac,
    }));
    this.index = new Map(this.nodes.map((n, i) => [n.id, i]));
    this.cut = new Set(); // explicitly failed links "a|b" (a<b)
    this._adj = null;
    this.time = 0;
  }

  idx(id) { const i = this.index.get(id); if (i === undefined) throw new Error(`unknown node ${id}`); return i; }
  node(id) { return this.nodes[this.idx(id)]; }
  key(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

  neighbors(id) {
    if (!this._adj) this._rebuild();
    return this._adj.get(id);
  }
  linked(a, b) { return this.neighbors(a).has(b); }
  _rebuild() {
    this._adj = new Map(this.nodes.map((n) => [n.id, new Set()]));
    for (let i = 0; i < this.nodes.length; i++)
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i], b = this.nodes[j];
        if (dist(a, b) <= this.range && !this.cut.has(this.key(a.id, b.id))) {
          this._adj.get(a.id).add(b.id); this._adj.get(b.id).add(a.id);
        }
      }
  }
  invalidate() { this._adj = null; }
  moveNode(id, x, y) { const n = this.node(id); n.x = x; n.y = y; this.invalidate(); }
  cutLink(a, b) { this.cut.add(this.key(a, b)); this.invalidate(); }
  restoreLink(a, b) { this.cut.delete(this.key(a, b)); this.invalidate(); }
  setQueue(id, q) { this.node(id).queue = q; }

  /** Estimated time for node i to push one packet to a neighbour (eq. 3). */
  hopTime(id) { const n = this.node(id); return (n.queue + 1) * n.tMacEst; }

  /**
   * Actually transmit one packet from `id`: sample t_mac, update T̂_mac (eq. 4),
   * return the time the hop took under the current queue.
   */
  transmit(id) {
    const n = this.node(id);
    const tMac = n.baseMac * (1 + 0.1 * (this.rng() - 0.5)); // ±5% jitter
    n.tMacEst = this.alpha * n.tMacEst + (1 - this.alpha) * tMac;
    const t = (n.queue + 1) * n.tMacEst;
    this.time += t;
    return t;
  }
}
