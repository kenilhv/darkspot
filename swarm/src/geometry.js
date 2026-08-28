export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Undirected adjacency (array of Sets) for points within `range` of each other. */
export function radioAdjacency(points, range) {
  const adj = points.map(() => new Set());
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      if (dist(points[i], points[j]) <= range) { adj[i].add(j); adj[j].add(i); }
  return adj;
}

/** Connected components of an adjacency list; returns array of index arrays. */
export function components(adj) {
  const seen = new Array(adj.length).fill(false);
  const out = [];
  for (let s = 0; s < adj.length; s++) {
    if (seen[s]) continue;
    const comp = [];
    const stack = [s];
    seen[s] = true;
    while (stack.length) {
      const u = stack.pop();
      comp.push(u);
      for (const v of adj[u]) if (!seen[v]) { seen[v] = true; stack.push(v); }
    }
    out.push(comp);
  }
  return out;
}
