/**
 * Pure formatters for tool responses. No DB, no LLM (D-4 / Rule 3).
 * Every response:
 *   - cites the raw rows it came from (table + row id),
 *   - quotes raw report text verbatim as a markdown blockquote next to any
 *     extracted field,
 *   - carries the confidence tier / staleness exactly as stored,
 *   - never contains a restricted field (stripped unconditionally until
 *     CORE's access_roles gate exists — see contract.ts),
 *   - is itself checked by the Rule 1 guard before being returned.
 */
import { RESTRICTED_FIELDS } from "./contract.ts";
import { checkRule1 } from "../guard/rule1.ts";

export type Row = Record<string, unknown>;

export function stripRestricted<T extends Row>(row: T): Omit<T, (typeof RESTRICTED_FIELDS)[number]> {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if ((RESTRICTED_FIELDS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return out as Omit<T, (typeof RESTRICTED_FIELDS)[number]>;
}

export function blockquote(text: string): string {
  return String(text)
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join("\n");
}

export function notAvailable(what: string, detail: string): string {
  return `${what}: not available. ${detail} No data is shown because none exists — this is not an empty result.`;
}

export interface RankRow extends Row {
  settlement_geohash: string;
  settlement_name?: string;
  rank: number;
  silence_hours: number;
  population?: number | null;
  hazard_exposure?: string | null;
  confidence_tier?: string;
  is_stale?: boolean | number;
  last_confirmation_at?: string | null;
  raw_reports?: { id: string | number; raw_text: string }[];
}

export function formatPriorityRanking(region: string, rows: RankRow[], source: string): string {
  if (rows.length === 0) return `Priority ranking for "${region}": ${source} contains no rows for this region.`;
  const lines = [
    `Priority ranking for "${region}" — ${rows.length} settlement(s), source ${source}.`,
    `Rank = silence x population x hazard exposure (§2). Silence is time since any confirmation, not an anomaly score.`,
    ``,
  ];
  for (const r0 of rows) {
    const r = stripRestricted(r0);
    const name = r.settlement_name ?? r.settlement_geohash;
    const pop = r.population == null ? "population unknown" : `population ~${r.population}`;
    const haz = r.hazard_exposure == null || r.hazard_exposure === "" ? "hazard exposure unknown" : `hazard exposure ${r.hazard_exposure}`;
    const tier = r.confidence_tier ?? "confidence tier not reported";
    const stale = r.is_stale ? " — STALE: past the re-verification window; status is unknown until re-verified" : "";
    lines.push(`${r.rank}. ${name} (geohash ${r.settlement_geohash}): no confirmation for ${r.silence_hours}h; ${pop}; ${haz}; ${tier}${stale}.`);
    lines.push(`   cited: ${source} row settlement_geohash=${r.settlement_geohash}` + (r.last_confirmation_at ? `, last_confirmation_at=${r.last_confirmation_at}` : ""));
    for (const rep of r.raw_reports ?? []) {
      lines.push(`   raw report (mesh_events id=${rep.id}, verbatim):`);
      lines.push(blockquote(rep.raw_text));
    }
  }
  return lines.join("\n");
}

export interface ConflictRow extends Row {
  settlement_geohash: string;
  field: string;
  value_a: string;
  event_id_a: string | number;
  raw_a?: string;
  value_b: string;
  event_id_b: string | number;
  raw_b?: string;
}

export function formatConflicts(settlement: string, rows: ConflictRow[], source: string): string {
  if (rows.length === 0) return `Conflicts for "${settlement}": ${source} has no disagreeing reports for this settlement.`;
  const lines = [
    `Conflicting reports for "${settlement}" — ${rows.length} disagreement(s), source ${source}. Shown side by side; nothing is resolved here.`,
    ``,
  ];
  for (const r0 of rows) {
    const r = stripRestricted(r0);
    if ((RESTRICTED_FIELDS as readonly string[]).includes(r.field)) {
      lines.push(`- field "${r.field}": conflict exists but this field is restricted (requires a signed-off escalation to view). Rows mesh_events id=${r.event_id_a} vs id=${r.event_id_b}.`);
      continue;
    }
    lines.push(`- field "${r.field}":`);
    lines.push(`  A (mesh_events id=${r.event_id_a}): extracted "${r.value_a}"`);
    if (r.raw_a != null) lines.push(blockquote(r.raw_a));
    lines.push(`  B (mesh_events id=${r.event_id_b}): extracted "${r.value_b}"`);
    if (r.raw_b != null) lines.push(blockquote(r.raw_b));
  }
  return lines.join("\n");
}

export interface RouteRow extends Row {
  id: string | number;
  is_simulation: boolean;
  waypoints: unknown;
  relay_positions?: unknown;
  created_at?: string;
}

export function formatRoutePlan(fleetSize: number, rows: RouteRow[], source: string): string {
  const header =
    `SIMULATION ONLY — the following route plan for a fleet of ${fleetSize} is a simulation (is_simulation = true in ${source}). ` +
    `No drone is flying. It has not been deconflicted with any airspace authority (§1a Rule 4).`;
  if (rows.length === 0) return `${header}\n\nNo simulated routes exist in ${source} for this fleet size.`;
  const bad = rows.filter((r) => r.is_simulation !== true);
  if (bad.length) {
    return `${header}\n\nRefusing to show ${bad.length} row(s) whose is_simulation flag is not true (ids ${bad.map((b) => b.id).join(", ")}). This violates the schema guarantee in §5a D-3; logged.`;
  }
  const lines = [header, ""];
  for (const r of rows) {
    lines.push(`- simulation route id=${r.id}${r.created_at ? ` (created ${r.created_at})` : ""}: waypoints ${JSON.stringify(r.waypoints)}` + (r.relay_positions != null ? `; relay positions ${JSON.stringify(r.relay_positions)}` : ""));
  }
  lines.push("", `cited: ${source} rows id in (${rows.map((r) => r.id).join(", ")}). Every route above is a simulation.`);
  return lines.join("\n");
}

/** Final gate: any tool text that itself contains a directive is withheld. */
export function guardToolText(text: string): string {
  const g = checkRule1(text);
  if (g.ok) return text;
  console.error("[rule1] withheld tool text:", JSON.stringify(g.violations));
  return `Tool output withheld by the Rule 1 guard (${g.violations.length} directive sentence(s) detected in generated text). This is a bug in the formatter, not in the data; see server log.`;
}
