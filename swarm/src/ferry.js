/**
 * UAV message-ferry route — SIMULATION ONLY (COORDINATION.md §1a Rule 4).
 *
 * Concept: W. Zhao, M. Ammar, E. Zegura, "A Message Ferrying Approach for Data
 * Delivery in Sparse Mobile Ad Hoc Networks", ACM MobiHoc 2004 — a mobile node
 * physically carries messages between partitions of a sparse network. Here the
 * partitions are mesh components with no path to the bridge.
 *
 * The tour itself is a plain nearest-neighbour heuristic over the visit points
 * (DarkSpot's choice, not from the paper; a TSP heuristic is enough for a
 * simulation whose only purpose is to show which settlements a ferry *would*
 * have to visit). Nothing here is an airspace-deconflicted flight plan, and
 * every row produced carries is_simulation = true — the Postgres table
 * `drone_routes_simulated` also CHECKs that column (CORE, 001_schema.sql +
 * 004_drone_routes_relay_positions.sql).
 */
import { dist } from './geometry.js';

export function nearestNeighbourTour(start, points) {
  const left = points.slice();
  const tour = [];
  let here = start;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((p, i) => { const d = dist(here, p); if (d < bd) { bd = d; bi = i; } });
    here = left.splice(bi, 1)[0];
    tour.push(here);
  }
  return tour;
}

/**
 * Build one row in the exact shape of CORE's `drone_routes_simulated`
 * (columns: disaster_event_id, is_simulation, algorithm, fleet_size,
 * waypoints jsonb, relay_positions jsonb, route_id). lat/lon are null in the
 * synthetic scenario; the canvas x/y are carried under `sim_xy` so the row is
 * honest about what it contains.
 */
export function ferryRouteRow({ disasterEventId = null, routeId, start, targets, relays = [], fleetSize = 1 }) {
  const tour = nearestNeighbourTour(start, targets);
  return {
    route_id: routeId,
    disaster_event_id: disasterEventId,
    is_simulation: true,
    algorithm: 'message-ferry (Zhao, Ammar & Zegura, MobiHoc 2004) + nearest-neighbour tour — SIMULATION',
    fleet_size: fleetSize,
    waypoints: tour.map((p, i) => ({ admin_unit_id: p.adminUnitId ?? null, lat: p.lat ?? null, lon: p.lon ?? null, order: i + 1, sim_xy: [p.x, p.y], label: p.id ?? null })),
    relay_positions: relays.map((r, i) => ({ order: i + 1, lat: r.lat ?? null, lon: r.lon ?? null, sim_xy: [r.x, r.y] })),
  };
}
