/**
 * AODV — deterministic reactive baseline for comparison with AntHocNet.
 *
 * Source: C. Perkins, E. Belding-Royer, S. Das, "Ad hoc On-Demand Distance
 * Vector (AODV) Routing", RFC 3561, IETF, 2003 (originally Perkins & Royer,
 * IEEE WMCSA 1999). COORDINATION.md §2 rates AODV as a reasonable traditional
 * baseline under disaster-like mobility (Rani/Sharma/Sharma 2012,
 * arXiv:1209.5507 — see MON's C4 audit).
 *
 * Modelled: RREQ flood with per-(originator, RREQ-id) duplicate suppression
 * (RFC 3561 §6.5 — later copies are silently discarded, so the destination
 * answers the first-arriving RREQ), RREP unicast along the reverse path
 * installing a single next-hop per destination, data on that one route, and
 * RERR-style invalidation on link failure followed by re-discovery (§6.11).
 * Not modelled: sequence numbers, expanding-ring search, route lifetimes,
 * intermediate-node RREP, HELLO. Same network time model as AntHocNet
 * (src/net.js) so delays are comparable.
 */
export class AODV {
  constructor(net, { dataTtl = 32 } = {}) {
    this.net = net;
    this.dataTtl = dataTtl;
    this.routes = new Map(); // node -> dest -> {next, hops}
    this.stats = { rreq: 0, rrep: 0, rerr: 0 };
    this.lastEvent = null;
  }
  route(node, dest) { return this.routes.get(node)?.get(dest) ?? null; }
  _set(node, dest, next, hops) {
    let m = this.routes.get(node); if (!m) { m = new Map(); this.routes.set(node, m); }
    m.set(dest, { next, hops });
  }

  /** RREQ flood; the first copy to reach d (by simulated arrival time) wins. */
  discover(s, d) {
    const net = this.net;
    this.stats.rreq++;
    const seen = new Set([s]);
    let frontier = [{ node: s, path: [s], time: 0 }];
    while (frontier.length) {
      frontier.sort((a, b) => a.time - b.time);
      const req = frontier.shift();
      if (req.node === d) {
        // RREP back along the reverse path
        this.stats.rrep++;
        for (let i = req.path.length - 2; i >= 0; i--)
          this._set(req.path[i], d, req.path[i + 1], req.path.length - 1 - i);
        this.lastEvent = { type: 'rrep', path: req.path.slice() };
        return req.path;
      }
      const hop = net.hopTime(req.node);
      for (const n of net.neighbors(req.node)) {
        if (seen.has(n)) continue; // duplicate RREQ discarded
        seen.add(n);
        frontier.push({ node: n, path: [...req.path, n], time: req.time + hop });
      }
    }
    return null;
  }

  sendData(s, d) {
    const net = this.net;
    const path = [s]; let here = s, delay = 0;
    for (let hops = 0; hops < this.dataTtl; hops++) {
      if (here === d) return { delivered: true, path, delay, hops: path.length - 1 };
      let r = this.route(here, d);
      if (r && !net.neighbors(here).has(r.next)) { this.linkFailure(here, r.next); r = null; }
      if (!r) {
        if (!this.discover(here, d)) return { delivered: false, path, delay, hops: path.length - 1, reason: 'no-route' };
        r = this.route(here, d);
      }
      delay += net.transmit(here);
      path.push(r.next); here = r.next;
    }
    return { delivered: false, path, delay, hops: path.length - 1, reason: 'ttl' };
  }

  /** RERR: invalidate every route through `gone`, propagate to upstream users. */
  linkFailure(at, gone, depth = 0) {
    const m = this.routes.get(at); if (!m) return;
    const lost = [];
    for (const [d, r] of m) if (r.next === gone) { m.delete(d); lost.push(d); }
    if (!lost.length || depth > 8) return;
    this.stats.rerr++;
    for (const nb of this.net.neighbors(at)) {
      const nm = this.routes.get(nb); if (!nm) continue;
      if (lost.some((d) => nm.get(d)?.next === at)) this.linkFailure(nb, at, depth + 1);
    }
    this.lastEvent = { type: 'rerr', at, gone, lost };
  }
}
