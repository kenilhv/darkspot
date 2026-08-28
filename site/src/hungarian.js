/**
 * Hungarian / Kuhn–Munkres algorithm for the linear assignment problem.
 *
 * Sources: H. W. Kuhn, "The Hungarian method for the assignment problem",
 * Naval Research Logistics Quarterly 2(1–2):83–97, 1955; J. Munkres,
 * "Algorithms for the assignment and transportation problems", J. SIAM
 * 5(1):32–38, 1957 (the O(n^3)-class refinement). This is the O(n^3)
 * potential/shortest-augmenting-path form (e.g. as presented in Burkard,
 * Dell'Amico, Zambelli, "Assignment Problems", SIAM 2009, ch. 4).
 *
 * Solves min Σ cost[i][j] over one-to-one assignments. Rectangular matrices
 * are handled by treating the smaller side as rows; unassigned columns are
 * left out. Returns { assignment: rowIndex -> colIndex (or -1), cost }.
 */
export function hungarian(costMatrix) {
  const nR = costMatrix.length;
  if (!nR) return { assignment: [], cost: 0 };
  const nC = costMatrix[0].length;
  const transpose = nR > nC;
  const cost = transpose
    ? Array.from({ length: nC }, (_, j) => costMatrix.map((row) => row[j]))
    : costMatrix;
  const n = cost.length, m = cost[0].length; // n <= m
  const INF = Number.POSITIVE_INFINITY;
  const u = new Float64Array(n + 1), v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1), way = new Int32Array(m + 1); // p[j] = row matched to column j (1-based)
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(INF);
    const used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const rowToCol = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) rowToCol[p[j] - 1] = j - 1;
  let total = 0;
  for (let i = 0; i < n; i++) if (rowToCol[i] >= 0) total += cost[i][rowToCol[i]];
  if (!transpose) return { assignment: rowToCol, cost: total };
  const assignment = new Array(nR).fill(-1);
  rowToCol.forEach((r, c) => { if (r >= 0) assignment[r] = c; });
  return { assignment, cost: total };
}
