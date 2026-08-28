/**
 * Adapter: CORE's `priority_rank` rows (+ admin_units centroids) → a SimEngine
 * scenario. This is where real settlement data enters the simulation.
 *
 * What is real here: settlement identity (HDX COD P-code, name), centroid
 * lat/lon (HDX COD-AB), CORE's silence_hours / population_used /
 * hazard_exposure / priority_score / rank exactly as its view computed them.
 *
 * What is still simulated / scenario parameters (stated, not hidden):
 *   - radio range `rangeKm`: NOT a measured figure. Mesh ranges vary by orders
 *     of magnitude with hardware and terrain; it is a knob whose value is shown
 *     on screen.
 *   - the bridge/command position (default: centroid of all units) and the
 *     field units' starting positions — there is no real deployment.
 *   - relays (PSO), routing, allocation, ferry tour — all simulation, as before.
 *
 * Projection: equirectangular about the mean latitude (km per degree lat =
 * 111.32; per degree lon = 111.32·cos(lat0)), uniformly scaled to fit the
 * canvas with padding. Exact enough at municipality scale for a 2D sim;
 * `unproject` is provided so ferry waypoints carry real lat/lon back out.
 */
const KM_PER_DEG = 111.32;

export function makeProjection(points, { width, height, pad = 48 }) {
  const lat0 = points.reduce((a, p) => a + p.centroid_lat, 0) / points.length;
  const kx = KM_PER_DEG * Math.cos((lat0 * Math.PI) / 180), ky = KM_PER_DEG;
  const xs = points.map((p) => p.centroid_lon * kx), ys = points.map((p) => p.centroid_lat * ky);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-6), spanY = Math.max(maxY - minY, 1e-6);
  const pxPerKm = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const ox = (width - spanX * pxPerKm) / 2, oy = (height - spanY * pxPerKm) / 2;
  const project = (lat, lon) => ({ x: ox + (lon * kx - minX) * pxPerKm, y: height - (oy + (lat * ky - minY) * pxPerKm) }); // north up
  const unproject = (x, y) => ({ lat: ((height - y - oy) / pxPerKm + minY) / ky, lon: ((x - ox) / pxPerKm + minX) / kx });
  return { project, unproject, pxPerKm, lat0, extentKm: { x: spanX, y: spanY } };
}

/**
 * @param rows  priority_rank rows joined with centroid_lat/centroid_lon
 * @returns scenario for SimEngine, plus `meta` describing what is real vs. parameter
 */
export function scenarioFromPriorityRank(rows, { width = 900, height = 560, rangeKm = 10, units = 4, relays = 5, maxSettlements = 40, seed = 7, bridgeLatLon = null } = {}) {
  const usable = rows.filter((r) => Number.isFinite(r.centroid_lat) && Number.isFinite(r.centroid_lon)).sort((a, b) => a.rank - b.rank).slice(0, maxSettlements);
  if (!usable.length) throw new Error('no rows with centroids');
  const proj = makeProjection(usable, { width, height });
  const maxScore = Math.max(...usable.map((r) => r.priority_score ?? 0), 1e-9);
  const settlements = usable.map((r) => {
    const { x, y } = proj.project(r.centroid_lat, r.centroid_lon);
    return {
      id: r.settlement_pcode, name: r.settlement_name, adminUnitId: r.settlement_pcode, x, y,
      lat: r.centroid_lat, lon: r.centroid_lon,
      silenceHours: r.silence_hours, neverHeard: !!r.never_heard, coverageBasis: r.coverage_basis ?? 'none', reportCount: r.report_count ?? 0, population: r.population_used, populationBasis: r.population_basis,
      hazard: r.hazard_exposure, rank: r.rank, priorityScore: r.priority_score,
      // allocation cost uses `priority` (cost = distance / priority): rescale CORE's score to (0, 10] so
      // the relative ordering is CORE's, and the magnitude is comparable across events
      priority: +Math.max(0.05, ((r.priority_score ?? 0) / maxScore) * 10).toFixed(3),
    };
  });
  const b = bridgeLatLon ? proj.project(bridgeLatLon.lat, bridgeLatLon.lon)
    : { x: settlements.reduce((a, s) => a + s.x, 0) / settlements.length, y: settlements.reduce((a, s) => a + s.y, 0) / settlements.length };
  const bridge = { id: 'bridge', x: b.x, y: b.y, ...proj.unproject(b.x, b.y) };
  const unitList = Array.from({ length: units }, (_, i) => ({ id: ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'][i] ?? `u${i}`, x: bridge.x + 26 + (i % 2) * 40, y: bridge.y + 26 + Math.floor(i / 2) * 26 }));
  return {
    seed, width, height, range: rangeKm * proj.pxPerKm, bridge, settlements, units: unitList, relayCount: relays,
    unproject: proj.unproject,
    meta: {
      source: 'CORE darkspot.priority_rank + admin_units centroids (HDX COD-AB)', rows: usable.length, of: rows.length,
      rangeKm, pxPerKm: proj.pxPerKm, extentKm: proj.extentKm,
      parameters: ['rangeKm (not a measured radio figure)', 'bridge position (no real deployment)', 'unit start positions', 'relays/routing/allocation/ferry are simulation'],
      disaster_event_id: usable[0].disaster_event_id ?? null,
    },
  };
}
