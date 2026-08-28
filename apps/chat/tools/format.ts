/**
 * Pure formatters for tool responses. No DB, no LLM (D-4 / Rule 3).
 * Every response:
 *   - cites the rows it came from (view + settlement_pcode / mesh_events id),
 *   - quotes raw report text verbatim as a markdown blockquote next to any
 *     extracted field,
 *   - carries confidence tier / staleness exactly as CORE's views compute them,
 *   - never contains restricted data (see contract.ts) — aggregate-only until
 *     an access_roles check exists,
 *   - is itself checked by the Rule 1 guard before being returned.
 */
import { RESTRICTED_COLUMNS, RESTRICTED_STATUS, RESTRICTED_STATUS_LABEL } from "./contract.ts";
import { checkRule1 } from "../guard/rule1.ts";

export type Row = Record<string, unknown>;

export function stripRestricted<T extends Row>(row: T): Omit<T, (typeof RESTRICTED_COLUMNS)[number]> {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if ((RESTRICTED_COLUMNS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return out as Omit<T, (typeof RESTRICTED_COLUMNS)[number]>;
}

/** CORE's extracted_status values, with the casualty value redacted for non-authorized viewers. */
export function publicStatus(status: unknown): string {
  const s = String(status ?? "");
  if (s === RESTRICTED_STATUS) return RESTRICTED_STATUS_LABEL;
  return s || "unextracted";
}

export const RAW_WITHHELD = "raw text withheld: this report is casualty-related; readable only via a signed-off escalation (§1a Rule 2)";

/** Raw text is the record and is normally quoted verbatim — except casualty-status reports, whose words ARE the restricted data. */
export function rawOrWithheld(status: unknown, raw: string): string {
  return String(status ?? "") === RESTRICTED_STATUS ? `> [${RAW_WITHHELD}]` : blockquote(raw);
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

const h = (x: unknown) => (x == null ? "?" : Number(x).toFixed(1));

// ---------- priority ranking ----------

export interface RankRow extends Row {
  settlement_pcode: string;
  settlement_name: string;
  granularity_level?: number;
  rank: number;
  silence_hours: number;
  never_heard?: number | boolean;
  report_count?: number;
  last_report_at?: string | null;
  population_used?: number | null;
  population_basis?: string;
  hazard_exposure?: string | null;
  hazard_unknown?: number | boolean;
  corroboration?: { extracted_status: string; confidence_tier: string; distinct_devices: number }[];
  is_stale?: number | boolean | null;
  effective_status?: string | null;
  window_hours?: number | null;
  raw_reports?: { id: string; received_at: string; extracted_status: string; raw_text: string }[];
}

export function formatPriorityRanking(region: string, rows: RankRow[], source: string): string {
  if (rows.length === 0) return `Priority ranking for "${region}": ${source} has no rows matching this region (event id, event region text, or settlement name).`;
  const lines = [
    `Priority ranking for "${region}" — ${rows.length} settlement(s), source ${source}.`,
    `priority_score = silence_hours x population x hazard_weight (CORE view). Silence is time since any report — for never-heard settlements the clock runs from event activation — not an anomaly score.`,
    ``,
  ];
  for (const r0 of rows) {
    const r = stripRestricted(r0);
    const pop = r.population_used == null ? "population unknown" : `population ~${r.population_used}` + (r.population_basis === "parent" ? " (parent unit figure — no unit-level census)" : "");
    const haz = !r.hazard_exposure || r.hazard_exposure === "unknown" ? "hazard exposure unknown" : `hazard exposure ${r.hazard_exposure}`;
    const heard = r.never_heard ? `never heard from since activation (${h(r.silence_hours)}h)` : `no report for ${h(r.silence_hours)}h (${r.report_count ?? "?"} report(s), last ${r.last_report_at ?? "?"})`;
    const stale = r.is_stale ? ` — STALE: last extracted status is past the ${r.window_hours ?? "?"}h window; effective status "${r.effective_status ?? "unknown, needs re-verification"}"` : "";
    lines.push(`${r.rank}. ${r.settlement_name} (pcode ${r.settlement_pcode}${r.granularity_level != null ? `, adm${r.granularity_level}` : ""}): ${heard}; ${pop}; ${haz}${stale}.`);
    const corr = (r.corroboration ?? []).map((c) => `${publicStatus(c.extracted_status)}: ${c.confidence_tier} (${c.distinct_devices} distinct device(s))`);
    lines.push(`   confidence: ${corr.length ? corr.join("; ") : "no extracted reports — unverified"}`);
    lines.push(`   cited: ${source} row settlement_pcode=${r.settlement_pcode}`);
    for (const rep of r.raw_reports ?? []) {
      lines.push(`   raw report (mesh_events id=${rep.id}, received ${rep.received_at}, extracted_status=${publicStatus(rep.extracted_status)}), verbatim:`);
      lines.push(rawOrWithheld(rep.extracted_status, rep.raw_text));
    }
  }
  return lines.join("\n");
}

// ---------- conflicts ----------

/** CORE's conflicts.reports_side_by_side tuple: (extracted_status, device_pubkey_hex, received_at, raw_text, id) */
export type SideBySide = [string, string, string, string, string];

export interface ConflictRow extends Row {
  settlement_pcode: string;
  settlement_name?: string;
  distinct_statuses: number;
  distinct_devices: number;
  reports_side_by_side: SideBySide[];
}

export function formatConflicts(settlement: string, rows: ConflictRow[], source: string): string {
  if (rows.length === 0) return `Conflicts for "${settlement}": ${source} has no disagreeing reports (distinct statuses from distinct devices inside the staleness window) for this settlement.`;
  const lines = [
    `Conflicting reports for "${settlement}" — ${rows.length} settlement(s) with disagreement, source ${source}. Shown side by side; nothing is resolved here.`,
    ``,
  ];
  for (const r of rows) {
    lines.push(`- ${r.settlement_name ?? r.settlement_pcode} (pcode ${r.settlement_pcode}): ${r.distinct_statuses} distinct statuses from ${r.distinct_devices} distinct devices.`);
    for (const [status, dev, at, raw, id] of r.reports_side_by_side) {
      lines.push(`  - mesh_events id=${id} at ${at}, device ${String(dev).slice(0, 8)}…, extracted_status=${publicStatus(status)}:`);
      lines.push(rawOrWithheld(status, raw));
    }
  }
  return lines.join("\n");
}

// ---------- route plan ----------

export interface RouteRow extends Row {
  id: string;
  is_simulation: boolean;
  algorithm: string;
  fleet_size: number;
  waypoints: unknown;
  computed_at?: string;
}

export function formatRoutePlan(fleetSize: number, rows: RouteRow[], source: string): string {
  const header =
    `SIMULATION ONLY — the following route plan for a fleet of ${fleetSize} is a simulation (is_simulation = true in ${source}, enforced by CHECK constraint). ` +
    `No drone is flying. It has not been deconflicted with any airspace authority (§1a Rule 4).`;
  if (rows.length === 0) return `${header}\n\nNo simulated routes exist in ${source} for fleet_size = ${fleetSize}.`;
  const bad = rows.filter((r) => r.is_simulation !== true);
  if (bad.length) {
    return `${header}\n\nRefusing to show ${bad.length} row(s) whose is_simulation flag is not true (ids ${bad.map((b) => b.id).join(", ")}). This violates the schema guarantee in §5a D-3; logged.`;
  }
  const lines = [header, ""];
  for (const r of rows) {
    lines.push(`- simulation route id=${r.id}${r.computed_at ? ` (computed ${r.computed_at})` : ""}, algorithm "${r.algorithm}": waypoints ${JSON.stringify(r.waypoints)}`);
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
