/**
 * AntHocNet-inspired adaptive routing.
 *
 * HONEST LABEL: a "simulation-proven academic technique we're adapting"
 * (COORDINATION.md §2). No swarm routing protocol has real-world disaster
 * field testing. This is a faithful-as-practical re-implementation of the
 * published algorithm on a simplified network model (src/net.js), NOT a
 * network stack.
 *
 * Source: F. Ducatelle, G. Di Caro, L. M. Gambardella, "Using ant agents to
 * combine reactive and proactive strategies for routing in mobile ad-hoc
 * networks", Int. J. Computational Intelligence and Applications 5(2):169–184,
 * 2005 (doi:10.1142/S1469026805001556); same algorithm as Di Caro, Ducatelle,
 * Gambardella, "AntHocNet: an adaptive nature-inspired algorithm for routing in
 * mobile ad hoc networks", European Trans. on Telecommunications 16(5), 2005.
 * Equation numbers below refer to the IJCIA paper.
 *
 *   (1) ant next hop:      P_nd = (T^i_nd)^β1 / Σ_j (T^i_jd)^β1,  β1 = 1
 *   (2) delay estimate:    T̂^i_d = Σ_{i≤j<d} T̂^j_{j+1}
 *   (3),(4) hop time / MAC running average — implemented in net.js
 *   (5) pheromone sample:  τ^i_d = ((T̂^i_d + h·T_hop) / 2)^-1,   T_hop = 3 ms
 *   (6) update:            T^i_nd = γ T^i_nd + (1-γ) τ^i_d,      γ = 0.7
 *   (7) bootstrapped:      B^i_nd = ((T^n_m*d)^-1 + (T̂^i_n + T_hop)/2)^-1
 *   (8) data next hop:     same as (1) with β2 = 20
 * Reactive setup: forward ants broadcast where no pheromone exists, only the
 * first ant of a generation is accepted at the destination, the backward ant
 * retraces the path and deposits pheromone. Proactive: hello messages every
 * t_hello carry each node's best pheromone for ≤k destinations; receivers
 * refresh sampled entries directly and store unknown ones as *virtual*
 * pheromone; a source sends a proactive ant when best virtual ≥ 1.1 × best
 * regular. Link failure: drop entries, notify neighbours, local repair ant
 * with ≤2 broadcasts for data. All as described in §3.1–3.4 of the paper.
 *
 * Not modelled: MAC-level packet loss, real hello timers (we use ticks), ant
 * packet sizes. Documented so nobody mistakes this for the ns-2 evaluation.
 */
import { makeRng } from './rng.js';

const MIN_PH = 1e-12;

export class AntHocNet {
  constructor(net, {
    beta1 = 1, beta2 = 20, gamma = 0.7, Thop = 0.003, helloK = 10,
    proactiveThreshold = 1.1, repairBroadcasts = 2, dataTtl = 32, seed = 1,
  } = {}) {
    this.net = net;
    Object.assign(this, { beta1, beta2, gamma, Thop, helloK, proactiveThreshold, repairBroadcasts, dataTtl });
    this.rng = makeRng(seed);
    this.T = new Map(); // node -> dest -> next -> pheromone (regular, ant-sampled)
    this.V = new Map(); // node -> dest -> next -> virtual pheromone (bootstrapped only)
    this.stats = { forwardAnts: 0, backwardAnts: 0, proactiveAnts: 0, repairAnts: 0, hellos: 0, failureNotices: 0 };
    this.lastEvent = null; // for the visualiser
  }

  // ---- table helpers -------------------------------------------------------
  _tbl(map, node, dest, create = false) {
    let a = map.get(node); if (!a) { if (!create) return null; a = new Map(); map.set(node, a); }
    let b = a.get(dest); if (!b) { if (!create) return null; b = new Map(); a.set(dest, b); }
    return b;
  }
  entries(node, dest) { return this._tbl(this.T, node, dest) ?? new Map(); }
  virtualEntries(node, dest) { return this._tbl(this.V, node, dest) ?? new Map(); }
  best(node, dest, map = this.T) {
    const t = this._tbl(map, node, dest); if (!t || !t.size) return null;
    let bn = null, bv = -Infinity;
    for (const [n, v] of t) if (v > bv) { bv = v; bn = n; }
    return { next: bn, value: bv };
  }

  /** Eq. (1)/(8): stochastic next-hop choice among candidate entries. */
  choose(cands, beta, exclude = new Set()) {
    let sum = 0; const opts = [];
    for (const [n, v] of cands) {
      if (exclude.has(n)) continue;
      const w = Math.pow(Math.max(v, MIN_PH), beta);
      opts.push([n, w]); sum += w;
    }
    if (!opts.length) return null;
    let r = this.rng() * sum;
    for (const [n, w] of opts) { r -= w; if (r <= 0) return n; }
    return opts[opts.length - 1][0];
  }
  /** Probability vector (for tests / visualiser). */
  probabilities(node, dest, beta = this.beta2) {
    const t = this.entries(node, dest); const out = new Map(); let sum = 0;
    for (const [n, v] of t) { const w = Math.pow(Math.max(v, MIN_PH), beta); out.set(n, w); sum += w; }
    for (const [n, w] of out) out.set(n, w / sum);
    return out;
  }

  // ---- reactive path setup (§3.1) -----------------------------------------
  /**
   * Flood a forward-ant generation from s to d. Ant instances are processed
   * in order of simulated arrival time (a priority queue over hop-time sums),
   * so the first instance to reach d is the one that travelled the currently
   * fastest path. Returns the path or null.
   */
  reactiveSetup(s, d, { maxBroadcasts = Infinity, count = 'forwardAnts' } = {}) {
    const net = this.net;
    this.stats[count]++;
    const visited = new Set([s]);
    // heap-free ordered list: small graphs, fine
    let frontier = [{ node: s, path: [s], time: 0, broadcasts: 0 }];
    while (frontier.length) {
      frontier.sort((a, b) => a.time - b.time);
      const ant = frontier.shift();
      if (ant.node === d) { this._backwardAnt(ant.path); return ant.path; }
      const here = ant.node;
      const nbrs = net.neighbors(here);
      const ph = this.entries(here, d);
      let nexts;
      const knownNext = [...ph.keys()].filter((n) => nbrs.has(n) && !ant.path.includes(n));
      if (knownNext.length) {
        // unicast per eq. (1) with β1
        const n = this.choose(new Map(knownNext.map((k) => [k, ph.get(k)])), this.beta1);
        nexts = [n];
      } else {
        if (ant.broadcasts >= maxBroadcasts) continue; // repair ants have a broadcast budget
        nexts = [...nbrs].filter((n) => !ant.path.includes(n));
        ant.broadcasts++;
      }
      const hop = net.hopTime(here);
      for (const n of nexts) {
        if (visited.has(n) && n !== d) continue; // an ant of this generation already got there: discard
        visited.add(n);
        frontier.push({ node: n, path: [...ant.path, n], time: ant.time + hop, broadcasts: ant.broadcasts });
      }
    }
    return null;
  }

  /** Backward ant retracing `path` (s..d), eqs. (2),(5),(6). */
  _backwardAnt(path) {
    const net = this.net, d = path[path.length - 1];
    this.stats.backwardAnts++;
    let That = 0; // eq. (2), accumulated from the destination side
    for (let i = path.length - 2; i >= 0; i--) {
      const node = path[i], next = path[i + 1];
      That += net.hopTime(node);        // T̂^i_{i+1} = (Q+1)·T̂_mac
      const h = path.length - 1 - i;
      const tau = 1 / ((That + h * this.Thop) / 2);   // eq. (5)
      const tbl = this._tbl(this.T, node, d, true);
      const old = tbl.get(next);
      tbl.set(next, old === undefined ? tau : this.gamma * old + (1 - this.gamma) * tau); // eq. (6)
      // a sampled path supersedes any virtual guess for the same entry
      const v = this._tbl(this.V, node, d); if (v) v.delete(next);
    }
    this.lastEvent = { type: 'backward', path: path.slice() };
  }

  // ---- proactive maintenance & exploration (§3.2) --------------------------
  /** One hello round for every node. */
  helloRound() {
    const net = this.net;
    for (const n of net.nodes) {
      this.stats.hellos++;
      const dests = [...(this.T.get(n.id)?.keys() ?? [])];
      const vdests = [...(this.V.get(n.id)?.keys() ?? [])];
      const pick = (arr) => (arr.length <= this.helloK ? arr : arr.slice().sort(() => this.rng() - 0.5).slice(0, this.helloK));
      const hello = [];
      for (const d of pick(dests)) { const b = this.best(n.id, d); if (b) hello.push({ d, value: b.value, virtual: false }); }
      for (const d of pick(vdests)) if (!this.T.get(n.id)?.has(d)) { const b = this.best(n.id, d, this.V); if (b) hello.push({ d, value: b.value, virtual: true }); }
      for (const i of net.neighbors(n.id)) {
        // one-hop route to the neighbour itself
        const oneHop = 1 / ((net.hopTime(i) + this.Thop) / 2);
        this._tbl(this.T, i, n.id, true).set(n.id, oneHop);
        for (const { d, value, virtual } of hello) {
          if (d === i) continue;
          const B = 1 / (1 / value + (net.hopTime(i) + this.Thop) / 2);   // eq. (7)
          const reg = this._tbl(this.T, i, d);
          if (!virtual && reg && reg.has(n.id)) reg.set(n.id, B);         // maintenance: refresh sampled path
          else if (!(reg && reg.has(n.id))) this._tbl(this.V, i, d, true).set(n.id, B); // exploration: virtual
        }
      }
    }
  }

  /** Source-side check: send a proactive ant if virtual looks ≥ threshold better. */
  proactiveCheck(s, d) {
    const bv = this.best(s, d, this.V), br = this.best(s, d);
    if (!bv) return null;
    if (br && bv.value < this.proactiveThreshold * br.value) return null;
    this.stats.proactiveAnts++;
    // unicast with β2 over regular ∪ virtual; discarded where no pheromone
    const path = [s]; let here = s;
    for (let hops = 0; hops < this.dataTtl; hops++) {
      if (here === d) { this._backwardAnt(path); this.lastEvent = { type: 'proactive', path: path.slice() }; return path; }
      const cands = new Map([...this.entries(here, d), ...this.virtualEntries(here, d)].filter(([n]) => this.net.neighbors(here).has(n)));
      const n = this.choose(cands, this.beta2, new Set(path));
      if (n === null) return null;
      path.push(n); here = n;
    }
    return null;
  }

  // ---- data forwarding (§3.3) and failures (§3.4) --------------------------
  /**
   * Forward one data packet s→d hop by hop. Returns {delivered, path, delay, hops}.
   * Link failures are discovered at unicast time (the chosen neighbour is gone).
   */
  sendData(s, d) {
    const net = this.net;
    const path = [s]; let here = s, delay = 0;
    for (let hops = 0; hops < this.dataTtl; hops++) {
      if (here === d) return { delivered: true, path, delay, hops: path.length - 1 };
      let ph = this.entries(here, d);
      // purge entries whose neighbour has vanished (link failure detection)
      for (const n of [...ph.keys()]) if (!net.neighbors(here).has(n)) this.linkFailure(here, n);
      ph = this.entries(here, d);
      let n = this.choose(ph, this.beta2, new Set(path));   // eq. (8)
      if (n === null) {
        // no route: local repair ant with a broadcast budget (§3.4)
        const rp = this.reactiveSetup(here, d, { maxBroadcasts: this.repairBroadcasts, count: 'repairAnts' });
        if (!rp) return { delivered: false, path, delay, hops: path.length - 1, reason: 'no-route' };
        n = rp[1];
      }
      delay += net.transmit(here);
      path.push(n); here = n;
    }
    return { delivered: false, path, delay, hops: path.length - 1, reason: 'ttl' };
  }

  /** Node `at` lost neighbour `gone`: drop entries, notify upstream (§3.4). */
  linkFailure(at, gone, depth = 0) {
    const lost = [];
    for (const map of [this.T, this.V]) {
      const byDest = map.get(at); if (!byDest) continue;
      for (const [d, tbl] of byDest) {
        if (!tbl.has(gone)) continue;
        const wasBest = this.best(at, d, map)?.next === gone;
        tbl.delete(gone);
        if (!tbl.size) byDest.delete(d);
        if (map === this.T && wasBest) lost.push(d);
      }
    }
    if (!lost.length || depth > 8) return;
    this.stats.failureNotices++;
    // neighbours that routed to those destinations via `at` re-estimate or drop
    for (const nb of this.net.neighbors(at)) {
      for (const d of lost) {
        const tbl = this._tbl(this.T, nb, d); if (!tbl || !tbl.has(at)) continue;
        const nb_best = this.best(at, d);
        if (nb_best) tbl.set(at, 1 / (1 / nb_best.value + (this.net.hopTime(nb) + this.Thop) / 2));
        else this.linkFailure(nb, at, depth + 1);
      }
    }
    this.lastEvent = { type: 'failure', at, gone, lost };
  }
}
