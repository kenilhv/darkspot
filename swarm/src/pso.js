/**
 * PSO-driven relay placement ("mesh formation").
 *
 * HONEST LABEL: swarm-intelligence-INSPIRED relay placement. This is the
 * academic WMN mesh-router node-placement formulation solved with particle
 * swarm optimisation. It is simulation-stage work in the literature and here;
 * it is NOT a proven self-organising field mesh. Relay positions this produces
 * are simulation output (is_simulation = true) — see COORDINATION.md §1a Rule 4.
 *
 * Formulation (Sakamoto, Barolli et al., "WMN-PSO" family of papers; e.g.
 * "Investigation of Fitness Function Weight-Coefficients for Optimization in
 * WMN-PSO Simulation System", Sakamoto/Oda/Ikeda/Barolli/Xhafa, 2016):
 *   - mesh routers (here: relays) with radio radius r are placed in a 2D area,
 *   - mesh clients (here: field mesh nodes / settlements) are fixed points,
 *   - fitness = w_sgc * SGC + w_ncmc * NCMC, where
 *       SGC  = Size of Giant Component of the router graph (connectivity),
 *       NCMC = Number of Covered Mesh Clients (clients within r of >=1 router).
 *     That paper (Sakamoto/Oda/Ikeda/Barolli/Xhafa/Woungang, CISIS 2016,
 *     pp. 224–229, doi:10.1109/CISIS.2016.55) reports 0.7 / 0.3 as the best
 *     SGC / NCMC weights; we default to those and normalise both terms to
 *     [0,1] (the paper reports them as percentages — equivalent).
 *   DarkSpot deviations (ours, NOT the paper's — verified by RESEARCH 13:38):
 *   (a) an optional `anchor` (the bridge/command node) is included in the
 *       router graph so the giant component is measured as "relays connected
 *       back to the bridge"; (b) NCMC here counts only clients covered by a
 *       router IN that giant/anchor component — the paper counts coverage by
 *       any router. Rationale: a relay with no path back to the bridge cannot
 *       relay anything, so coverage by it is not useful coverage for DarkSpot.
 *
 * PSO itself: Kennedy & Eberhart, "Particle Swarm Optimization", Proc. IEEE
 * ICNN 1995, with the inertia weight w of Shi & Eberhart, "A modified particle
 * swarm optimizer", IEEE ICEC 1998:
 *   v <- w*v + c1*r1*(pbest - x) + c2*r2*(gbest - x);  x <- x + v
 * A particle encodes the positions of all k relays (2k dimensions).
 */
import { makeRng } from './rng.js';
import { dist, radioAdjacency, components } from './geometry.js';

export function evaluatePlacement(relays, clients, range, { anchor = null, wSgc = 0.7, wNcmc = 0.3 } = {}) {
  const routers = anchor ? [anchor, ...relays] : relays.slice();
  const adj = radioAdjacency(routers, range);
  const comps = components(adj);
  let giant;
  if (anchor) giant = comps.find((c) => c.includes(0)); // component containing the bridge
  else giant = comps.reduce((a, b) => (b.length > a.length ? b : a), []);
  const giantRouters = giant.map((i) => routers[i]);
  let covered = 0;
  const coveredMask = clients.map((c) => {
    const ok = giantRouters.some((r) => dist(r, c) <= range);
    if (ok) covered++;
    return ok;
  });
  const sgc = giant.length - (anchor ? 1 : 0); // relays only, excluding the anchor itself
  const sgcNorm = relays.length ? sgc / relays.length : 1;
  const ncmcNorm = clients.length ? covered / clients.length : 1;
  return {
    fitness: wSgc * sgcNorm + wNcmc * ncmcNorm,
    sgc, ncmc: covered, sgcNorm, ncmcNorm, coveredMask,
    giantRelayIdx: giant.filter((i) => !anchor || i > 0).map((i) => (anchor ? i - 1 : i)),
  };
}

/**
 * Run PSO. Returns { relays: [{x,y}], fitness, history: [gbest fitness per iter], eval, is_simulation: true }.
 * `onIter(state)` (optional) lets a visualiser animate the swarm.
 */
export function psoRelayPlacement({
  clients, k, range, bounds, anchor = null,
  particles = 30, iters = 200, w = 0.729, c1 = 1.49445, c2 = 1.49445,
  wSgc = 0.7, wNcmc = 0.3, seed = 1, onIter = null,
}) {
  // w=0.729, c1=c2=1.49445: Eberhart & Shi, "Comparing inertia weights and
  // constriction factors in particle swarm optimization", CEC 2000,
  // doi:10.1109/CEC.2000.870279 (the constriction-equivalent setting; Clerc &
  // Kennedy 2002 give χ=0.7298, c=1.49618 — close but not these numbers).
  const rng = makeRng(seed);
  const dims = 2 * k;
  const { xMin, xMax, yMin, yMax } = bounds;
  const vMax = 0.2 * Math.max(xMax - xMin, yMax - yMin);
  const decode = (pos) => Array.from({ length: k }, (_, i) => ({ x: pos[2 * i], y: pos[2 * i + 1] }));
  const fit = (pos) => evaluatePlacement(decode(pos), clients, range, { anchor, wSgc, wNcmc });

  const swarm = [];
  let gbest = null, gbestFit = -Infinity, gbestEval = null;
  for (let p = 0; p < particles; p++) {
    const x = new Float64Array(dims), v = new Float64Array(dims);
    for (let i = 0; i < k; i++) {
      // Seed half the swarm near clients (a common WMN-PSO initialisation
      // heuristic) and half uniformly, so the search has both exploitation and
      // exploration from the start.
      if (p % 2 === 0 && clients.length) {
        const c = rng.pick(clients);
        x[2 * i] = Math.min(xMax, Math.max(xMin, c.x + rng.range(-range, range)));
        x[2 * i + 1] = Math.min(yMax, Math.max(yMin, c.y + rng.range(-range, range)));
      } else {
        x[2 * i] = rng.range(xMin, xMax);
        x[2 * i + 1] = rng.range(yMin, yMax);
      }
      v[2 * i] = rng.range(-vMax, vMax) * 0.1;
      v[2 * i + 1] = rng.range(-vMax, vMax) * 0.1;
    }
    const e = fit(x);
    const part = { x, v, pbest: Float64Array.from(x), pbestFit: e.fitness };
    swarm.push(part);
    if (e.fitness > gbestFit) { gbestFit = e.fitness; gbest = Float64Array.from(x); gbestEval = e; }
  }

  const history = [gbestFit];
  for (let it = 0; it < iters; it++) {
    for (const part of swarm) {
      for (let d = 0; d < dims; d++) {
        const r1 = rng(), r2 = rng();
        let nv = w * part.v[d] + c1 * r1 * (part.pbest[d] - part.x[d]) + c2 * r2 * (gbest[d] - part.x[d]);
        if (nv > vMax) nv = vMax; else if (nv < -vMax) nv = -vMax;
        part.v[d] = nv;
        let nx = part.x[d] + nv;
        const lo = d % 2 === 0 ? xMin : yMin, hi = d % 2 === 0 ? xMax : yMax;
        if (nx < lo) { nx = lo; part.v[d] = 0; } else if (nx > hi) { nx = hi; part.v[d] = 0; }
        part.x[d] = nx;
      }
      const e = fit(part.x);
      if (e.fitness > part.pbestFit) { part.pbestFit = e.fitness; part.pbest.set(part.x); }
      if (e.fitness > gbestFit) { gbestFit = e.fitness; gbest = Float64Array.from(part.x); gbestEval = e; }
    }
    history.push(gbestFit);
    if (onIter) onIter({ iter: it, gbest: decode(gbest), gbestFit, particles: swarm.map((s) => decode(s.x)) });
    if (gbestFit >= wSgc + wNcmc - 1e-12) break; // both objectives saturated
  }
  return { relays: decode(gbest), fitness: gbestFit, eval: gbestEval, history, is_simulation: true };
}
