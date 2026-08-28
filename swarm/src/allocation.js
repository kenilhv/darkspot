/**
 * Taskforce allocation — BOTH halves of the design tension in COORDINATION.md §2:
 *
 *   - units that currently have a mesh path back to command are assigned
 *     centrally and optimally with the Hungarian algorithm (Kuhn 1955 /
 *     Munkres 1957), re-solved every replanning tick;
 *   - units in a mesh component WITHOUT command run a local sequential
 *     single-item auction among themselves (Dias et al. 2006) over the tasks
 *     they can see.
 *
 * Problem class: ST-SR-IA per Gerkey & Matarić, "A Formal Analysis and
 * Taxonomy of Task Allocation in Multi-Robot Systems", IJRR 23(9):939–954,
 * 2004 — single-task units, single-unit tasks, instantaneous assignment.
 *
 * Cost model (DarkSpot's, not from a paper — stated so nobody mistakes it):
 *   cost(u, t) = distance(u, t) / priority(t), priority > 0. A higher-priority
 *   task is "cheaper" to serve, so when tasks outnumber units the assignment
 *   prefers them; when priorities change, the optimal pairing changes, which is
 *   what the visualisation is meant to show. Priority here is CORE's
 *   mv_priority_rank value (silence × population × hazard) or a scenario value.
 *
 * Rule 1: the output is a set of *suggested pairings* with the evidence behind
 * each (mode, cost, component). No field is named or shaped like a dispatch
 * order; nothing here tells anyone to go anywhere. Rule 4: is_simulation=true.
 * Rule 3: no LLM anywhere in this module (D-4).
 */
import { hungarian } from './hungarian.js';
import { ssiAuction } from './auction.js';
import { components } from './geometry.js';

export const defaultCost = (u, t) => Math.hypot(u.x - t.x, u.y - t.y) / Math.max(t.priority ?? 1, 1e-9);

/**
 * @param units   [{id, x, y, nodeId}]  nodeId = the mesh node the unit is at/attached to
 * @param tasks   [{id, x, y, priority, nodeId}] nodeId = mesh node that reported / is nearest the task
 * @param mesh    { nodeIds: [...], adjacency: Map nodeId -> Set nodeId } current link graph
 * @param commandNodeId the bridge/command node id
 */
export function allocate({ units, tasks, mesh, commandNodeId, costFn = defaultCost }) {
  // 1. mesh components
  const ids = mesh.nodeIds;
  const idx = new Map(ids.map((n, i) => [n, i]));
  const adj = ids.map((n) => new Set([...(mesh.adjacency.get(n) ?? [])].map((m) => idx.get(m)).filter((x) => x !== undefined)));
  const comps = components(adj);
  const compOf = new Map();
  comps.forEach((c, ci) => c.forEach((i) => compOf.set(ids[i], ci)));
  const commandComp = compOf.get(commandNodeId);

  const pairings = [];
  const byComp = new Map();
  const groupInto = (arr, kind) => {
    for (const x of arr) {
      const c = compOf.get(x.nodeId);
      if (c === undefined) continue; // not on the mesh at all: invisible to everyone
      let g = byComp.get(c); if (!g) { g = { units: [], tasks: [] }; byComp.set(c, g); }
      g[kind].push(x);
    }
  };
  groupInto(units, 'units'); groupInto(tasks, 'tasks');

  const modes = [];
  for (const [c, g] of byComp) {
    if (!g.units.length || !g.tasks.length) { modes.push({ component: c, mode: c === commandComp ? 'hungarian' : 'auction', units: g.units.length, tasks: g.tasks.length, idle: true }); continue; }
    if (c === commandComp) {
      // centralised, optimal: command sees every unit and task in its component
      const M = g.units.map((u) => g.tasks.map((t) => costFn(u, t)));
      const { assignment, cost } = hungarian(M);
      assignment.forEach((j, i) => { if (j >= 0) pairings.push({ unitId: g.units[i].id, taskId: g.tasks[j].id, cost: M[i][j], mode: 'hungarian', component: c }); });
      modes.push({ component: c, mode: 'hungarian', units: g.units.length, tasks: g.tasks.length, cost });
    } else {
      // disconnected from command: local auction among what this component can see
      const { pairings: pp, cost, rounds } = ssiAuction(g.units, g.tasks, costFn);
      for (const p of pp) pairings.push({ ...p, mode: 'auction', component: c });
      modes.push({ component: c, mode: 'auction', units: g.units.length, tasks: g.tasks.length, cost, rounds: rounds.length });
    }
  }
  const assignedTasks = new Set(pairings.map((p) => p.taskId));
  return {
    suggested_pairings: pairings,      // advisory evidence, never an order (Rule 1)
    modes,
    unassignedTasks: tasks.filter((t) => !assignedTasks.has(t.id)).map((t) => t.id),
    unitsWithoutCommand: units.filter((u) => compOf.get(u.nodeId) !== commandComp).map((u) => u.id),
    is_simulation: true,
    note: 'Suggested unit/task pairings from a simulation. Not a dispatch order; requires human review before any action.',
  };
}
