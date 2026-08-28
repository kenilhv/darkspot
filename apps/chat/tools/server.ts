/**
 * DarkSpot coordinator tool server — MCP over streamable HTTP, stateless.
 * LibreChat connects via librechat.yaml `mcpServers.darkspot.url`.
 *
 * Tools (§2 LibreChat section), reading CORE's actual objects (tools/contract.ts):
 *   get_priority_ranking(region)   ← ClickHouse priority_rank + corroboration + staleness + mesh_events raw text
 *   get_conflicts(settlement)      ← ClickHouse conflicts (reports side by side, raw text)
 *   get_route_plan(fleet_size)     ← Postgres drone_routes_simulated (is_simulation = true only)
 *   file_field_report(...)         → local outbox always; mesh_events when it exists
 *
 * Zero LLM on this path (D-4 / Rule 3) except the optional extraction inside
 * file_field_report, which never gates storage. Every query is DESCRIBE-checked
 * and fails closed — "not available" — if a view or column is missing. No fake rows.
 *
 * Restricted data (extracted_people, status 'casualties') is never emitted:
 * CORE's access_roles gate has no caller identity wired yet, so every viewer
 * is treated as aggregate_only.
 *
 * Env: PORT (default 3311), CLICKHOUSE_URL/USER/PASSWORD/DB, DATABASE_URL,
 *      BRIDGE_PUBKEY_HEX (this node's 32-byte identity for mesh_events.bridge_pubkey), OUTBOX_PATH.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import pg from "pg";
import { CONTRACT, type ChView } from "./contract.ts";
import { chColumns, chConfigFromEnv, chQuery, type ChConfig } from "./clickhouse.ts";
import { extractOptionsFromEnv, extractReport, publicFields } from "../intake/extract.ts";
import { newReport, storeReport } from "../intake/store.ts";
import { getTracer } from "../trace/honeyhive.ts";
import { ANON, resolveAccess, viewerFromHeaders, type Authorization, type Viewer } from "./access.ts";
import { blockquote, formatConflicts, formatPriorityRanking, formatRoutePlan, guardToolText, notAvailable, type ConflictRow, type RankRow, type RouteRow } from "./format.ts";

const PORT = Number(process.env.PORT ?? 3311);
const tracer = await getTracer({ sessionName: process.env.HH_SESSION_NAME ?? "darkspot-tools" });

// ---------- availability checks (fail closed) ----------

async function chViewsReady(cfg: ChConfig | null, views: ChView[]): Promise<{ ok: true; cfg: ChConfig } | { ok: false; why: string }> {
  if (!cfg) return { ok: false, why: "CLICKHOUSE_URL is not set on the tool server." };
  for (const view of views) {
    let cols: string[] | null;
    try {
      cols = await chColumns(cfg, view);
    } catch (e) {
      return { ok: false, why: `ClickHouse unreachable: ${(e as Error).message}` };
    }
    if (!cols) return { ok: false, why: `ClickHouse object ${cfg.db}.${view} does not exist yet (CORE dependency, §5).` };
    const missing = CONTRACT.clickhouse[view].filter((c) => !cols!.includes(c));
    if (missing.length) return { ok: false, why: `${view} exists but lacks contract columns [${missing.join(", ")}] (tools/contract.ts).` };
  }
  return { ok: true, cfg };
}

async function pgTableReady(table: keyof typeof CONTRACT.postgres): Promise<{ ok: true; client: pg.Client } | { ok: false; why: string }> {
  const url = process.env.DATABASE_URL;
  if (!url) return { ok: false, why: "DATABASE_URL is not set on the tool server." };
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const r = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1", [table]);
    if (r.rowCount === 0) {
      await client.end();
      return { ok: false, why: `Postgres table ${table} does not exist yet (CORE dependency, §5).` };
    }
    const cols = r.rows.map((x) => x.column_name as string);
    const missing = CONTRACT.postgres[table].filter((c) => !cols.includes(c));
    if (missing.length) {
      await client.end();
      return { ok: false, why: `${table} exists but lacks contract columns [${missing.join(", ")}].` };
    }
    return { ok: true, client };
  } catch (e) {
    try { await client.end(); } catch {}
    return { ok: false, why: `Postgres unreachable: ${(e as Error).message}` };
  }
}

const text = (t: string) => {
  const guarded = guardToolText(t);
  tracer.enrich({ metadata: { rule1_withheld: guarded !== t, chars: guarded.length } });
  return { content: [{ type: "text" as const, text: guarded }] };
};

// ---------- tools ----------

/** Resolve the caller's access level for an event (D-14). Fails closed; the reason is printed in the tool output. */
async function authFor(viewer: Viewer, disasterEventId: string | null): Promise<Authorization> {
  const url = process.env.DATABASE_URL;
  if (!url || !viewer.subject) return resolveAccess(viewer, disasterEventId, null);
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    return await resolveAccess(viewer, disasterEventId, (sql, params) => client.query(sql, params as any[]));
  } catch (e) {
    return { ...ANON, reason: `principals lookup failed (${(e as Error).message}) — aggregate_only` };
  } finally {
    try { await client.end(); } catch {}
  }
}

const accessLine = (a: Authorization) => `access: ${a.level} — ${a.reason}`;

export function buildServer(viewer: Viewer = { subject: null, trusted: true }): McpServer {
  const server = new McpServer({ name: "darkspot-coordinator-tools", version: "0.2.0" });

  server.registerTool(
    "get_priority_ranking",
    {
      title: "Priority ranking (silence x population x hazard)",
      description:
        "Evidence only: settlements ranked by silence_hours x population x hazard_weight from CORE's ClickHouse priority_rank view, with corroboration tier, staleness and verbatim raw reports. " +
        "region = disaster_events.id, a substring of the event's region label, or a settlement name. Never a recommendation of where to go.",
      inputSchema: { region: z.string().min(1).describe("disaster_events.id (UUID), event region text, or settlement name"), limit: z.number().int().min(1).max(50).default(10) },
    },
    tracer.wrap("tool", "get_priority_ranking", async ({ region, limit }) => {
      const cfg = chConfigFromEnv();
      const ready = await chViewsReady(cfg, ["priority_rank", "corroboration", "staleness", "mesh_events", "pg_disaster_events"]);
      if (!ready.ok) return text(notAvailable("Priority ranking", ready.why));
      const rows = await chQuery<RankRow>(
        ready.cfg,
        `SELECT toString(p.disaster_event_id) AS disaster_event_id, p.settlement_pcode AS settlement_pcode, p.settlement_name AS settlement_name, p.rank AS rank, p.silence_hours AS silence_hours, p.never_heard AS never_heard, p.report_count AS report_count,
                toString(p.last_report_at) AS last_report_at, p.population_used AS population_used, p.population_basis AS population_basis, p.hazard_exposure AS hazard_exposure, p.hazard_unknown AS hazard_unknown,
                c.corroboration AS corroboration, s.is_stale AS is_stale, s.effective_status AS effective_status, s.window_hours AS window_hours
         FROM priority_rank p
         INNER JOIN pg_disaster_events e ON e.id = p.disaster_event_id
         LEFT JOIN (
           SELECT disaster_event_id, settlement_pcode,
                  groupArray(map('extracted_status', extracted_status, 'confidence_tier', confidence_tier, 'distinct_devices', toString(distinct_devices))) AS corroboration
           FROM corroboration GROUP BY disaster_event_id, settlement_pcode
         ) c ON c.disaster_event_id = p.disaster_event_id AND c.settlement_pcode = p.settlement_pcode
         LEFT JOIN staleness s ON s.disaster_event_id = p.disaster_event_id AND s.settlement_pcode = p.settlement_pcode
         WHERE toString(p.disaster_event_id) = {region:String}
            OR p.settlement_pcode = {region:String}
            OR positionCaseInsensitive(e.region, {region:String}) > 0
            OR positionCaseInsensitive(p.settlement_name, {region:String}) > 0
         ORDER BY p.rank ASC LIMIT {limit:UInt32}`,
        { region, limit },
      );
      const auth = await authFor(viewer, rows.length ? String(rows[0].disaster_event_id) : null);
      for (const r of rows) {
        // groupArray(map) arrives as array of string maps; normalise
        r.corroboration = ((r.corroboration as any[]) ?? []).map((m: any) => ({ extracted_status: m.extracted_status, confidence_tier: m.confidence_tier, distinct_devices: Number(m.distinct_devices) }));
        if (Number(r.report_count) > 0) {
          r.raw_reports = await chQuery(
            ready.cfg,
            "SELECT toString(id) AS id, toString(received_at) AS received_at, extracted_status, raw_text, extracted_people FROM mesh_events WHERE settlement_pcode = {pc:String} ORDER BY received_at DESC LIMIT 3",
            { pc: r.settlement_pcode },
          );
        }
      }
      return text(formatPriorityRanking(region, rows, `${ready.cfg.db}.priority_rank`, auth.authorized) + "\n\n" + accessLine(auth));
    }),
  );

  server.registerTool(
    "get_conflicts",
    {
      title: "Conflicting reports for a settlement",
      description: "Evidence only: settlements where distinct devices reported different statuses inside the staleness window (CORE's ClickHouse conflicts view), shown side by side with raw text. Nothing is resolved.",
      inputSchema: { settlement: z.string().min(1).describe("Settlement P-code or name (substring)") },
    },
    tracer.wrap("tool", "get_conflicts", async ({ settlement }) => {
      const cfg = chConfigFromEnv();
      const ready = await chViewsReady(cfg, ["conflicts", "pg_admin_units"]);
      if (!ready.ok) return text(notAvailable("Conflicts", ready.why));
      const rows = await chQuery<ConflictRow>(
        ready.cfg,
        `SELECT toString(any(c.disaster_event_id)) AS disaster_event_id, c.settlement_pcode, any(au.name) AS settlement_name, any(c.distinct_statuses) AS distinct_statuses, any(c.distinct_devices) AS distinct_devices,
                any(arrayMap(x -> (x.1, x.2, toString(x.3), x.4, toString(x.5)), c.reports_side_by_side)) AS reports_side_by_side
         FROM conflicts c
         LEFT JOIN pg_admin_units au ON au.pcode = c.settlement_pcode
         WHERE c.settlement_pcode = {s:String} OR positionCaseInsensitive(au.name, {s:String}) > 0
         GROUP BY c.settlement_pcode LIMIT 50`,
        { s: settlement },
      );
      const auth = await authFor(viewer, rows.length ? String(rows[0].disaster_event_id) : null);
      return text(formatConflicts(settlement, rows, `${ready.cfg.db}.conflicts`, auth.authorized) + "\n\n" + accessLine(auth));
    }),
  );

  server.registerTool(
    "get_route_plan",
    {
      title: "Simulated relay/ferry route plan",
      description:
        "SIMULATION ONLY. Returns rows from Postgres drone_routes_simulated for the given fleet size (is_simulation = true, enforced by CHECK). No drone is flying; nothing here is deconflicted with an airspace authority.",
      inputSchema: { fleet_size: z.number().int().min(1).max(100).describe("Number of simulated relay units") },
    },
    tracer.wrap("tool", "get_route_plan", async ({ fleet_size }) => {
      const ready = await pgTableReady("drone_routes_simulated");
      if (!ready.ok) return text(notAvailable("Simulated route plan", ready.why));
      try {
        const r = await ready.client.query(
          "SELECT id, is_simulation, algorithm, fleet_size, waypoints, computed_at FROM drone_routes_simulated WHERE is_simulation = true AND fleet_size = $1 ORDER BY computed_at DESC LIMIT 10",
          [fleet_size],
        );
        return text(formatRoutePlan(fleet_size, r.rows as RouteRow[], "postgres.drone_routes_simulated"));
      } finally {
        await ready.client.end();
      }
    }),
  );

  server.registerTool(
    "file_field_report",
    {
      title: "File a field report (volunteer)",
      description:
        "Files a typed field report. Raw text is always kept verbatim (local outbox; CORE's mesh_events when reachable). " +
        "Extraction (safe / needs_help / casualties / unknown) runs via inference.net when configured, otherwise the report is stored as 'unextracted' and marked unverified. " +
        "Nothing is inferred. Restricted extracted values are not echoed back.",
      inputSchema: {
        raw_text: z.string().min(1).max(4000).describe("The report exactly as typed by the volunteer"),
        disaster_event_id: z.string().min(1).describe("disaster_events.id (UUID)"),
        device_pubkey_hex: z.string().min(1).describe("Reporting device's 32-byte Noise static key as 64 hex chars"),
        settlement_pcode: z.string().optional().describe("HDX COD P-code of the settlement, if known"),
        settlement_geohash: z.string().optional().describe("Settlement geohash, if known"),
      },
    },
    tracer.wrap("tool", "file_field_report", async ({ raw_text, disaster_event_id, device_pubkey_hex, settlement_pcode, settlement_geohash }) => {
      const extraction = await extractReport(raw_text, extractOptionsFromEnv());
      const report = newReport({ disaster_event_id, device_pubkey_hex, raw_text, settlement_pcode, settlement_geohash }, extraction);
      const outcome = await storeReport(report, process.env.OUTBOX_PATH ?? "data/outbox.jsonl", chConfigFromEnv(), process.env.BRIDGE_PUBKEY_HEX);
      const pub = publicFields(extraction.fields);
      const lines = [
        `Report filed, id=${report.id} (received ${report.received_at}).`,
        `Raw text (verbatim, never discarded):`,
        blockquote(raw_text),
        `Storage: local outbox ${outcome.outbox}; mesh_events: ${outcome.mesh_events} — ${outcome.detail}`,
        `Extraction: ${extraction.status}${extraction.model ? " via " + extraction.model : ""} — ${extraction.note}`,
      ];
      if (pub) lines.push(`Extracted (non-restricted values only; check against the raw text above): ${JSON.stringify(pub)}`);
      if (!settlement_pcode) lines.push("No settlement_pcode given: this report is stored but cannot contribute to silence/priority views until a P-code is attached.");
      lines.push("Confidence tier for this single report: unverified-single-source.");
      return text(lines.join("\n"));
    }),
  );

  return server;
}

// ---------- http ----------

const http = createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, clickhouse: Boolean(process.env.CLICKHOUSE_URL), postgres: Boolean(process.env.DATABASE_URL), bridge_identity: Boolean(process.env.BRIDGE_PUBKEY_HEX), tracing: tracer.mode, identity_headers: "X-DarkSpot-Subject (+ X-DarkSpot-Tools-Token" + (process.env.TOOLS_SHARED_SECRET ? " required)" : " not enforced: TOOLS_SHARED_SECRET unset)") }));
    return;
  }
  if (!req.url?.startsWith("/mcp")) {
    res.writeHead(404).end();
    return;
  }
  // Stateless: a fresh server+transport per request (SDK-recommended pattern for stateless streamable HTTP).
  const viewer = viewerFromHeaders(req.headers as any, process.env.TOOLS_SHARED_SECRET);
  const server = buildServer(viewer);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

http.listen(PORT, () => {
  const port = (http.address() as { port: number }).port;
  console.log(`[darkspot-tools] MCP on http://0.0.0.0:${port}/mcp  (instance ${randomUUID().slice(0, 8)})`);
  console.log(`[darkspot-tools] clickhouse=${process.env.CLICKHOUSE_URL ?? "unset"} postgres=${process.env.DATABASE_URL ? "set" : "unset"} bridge_identity=${process.env.BRIDGE_PUBKEY_HEX ? "set" : "unset"}`);
});
