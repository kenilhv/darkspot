/**
 * DarkSpot coordinator tool server — MCP over streamable HTTP, stateless.
 * LibreChat connects via librechat.yaml `mcpServers.darkspot.url`.
 *
 * Tools (§2 LibreChat section):
 *   get_priority_ranking(region)   ← ClickHouse mv_priority_rank (+ mv_corroboration, mv_staleness, mesh_events raw text)
 *   get_conflicts(settlement)      ← ClickHouse mv_conflicts (+ mesh_events raw text)
 *   get_route_plan(fleet_size)     ← Postgres drone_routes_simulated (is_simulation = true only)
 *
 * Zero LLM on this path (D-4 / Rule 3). Every query is DESCRIBE-checked
 * against tools/contract.ts and fails closed — "not available" — if a view or
 * column is missing. No fake rows, ever.
 *
 * Restricted fields (casualty_count, exact_location, urgency_tier, rescue_location)
 * are stripped unconditionally: CORE's access_roles gate doesn't exist yet, so
 * there is no way to prove a caller is a verified responder.
 *
 * Env: PORT (default 3311), CLICKHOUSE_URL/USER/PASSWORD/DB, DATABASE_URL (Postgres).
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import pg from "pg";
import { CONTRACT, type ChView } from "./contract.ts";
import { chColumns, chConfigFromEnv, chQuery, type ChConfig } from "./clickhouse.ts";
import { formatConflicts, formatPriorityRanking, formatRoutePlan, guardToolText, notAvailable, type ConflictRow, type RankRow, type RouteRow } from "./format.ts";

const PORT = Number(process.env.PORT ?? 3311);

// ---------- availability checks (fail closed) ----------

async function chViewReady(cfg: ChConfig | null, view: ChView): Promise<{ ok: true; cfg: ChConfig } | { ok: false; why: string }> {
  if (!cfg) return { ok: false, why: "CLICKHOUSE_URL is not set on the tool server." };
  let cols: string[] | null;
  try {
    cols = await chColumns(cfg, view);
  } catch (e) {
    return { ok: false, why: `ClickHouse unreachable: ${(e as Error).message}` };
  }
  if (!cols) return { ok: false, why: `ClickHouse view ${cfg.db}.${view} does not exist yet (CORE dependency, §5).` };
  const missing = CONTRACT.clickhouse[view].filter((c) => !cols!.includes(c));
  if (missing.length) return { ok: false, why: `${view} exists but lacks contract columns [${missing.join(", ")}] (tools/contract.ts).` };
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

const text = (t: string) => ({ content: [{ type: "text" as const, text: guardToolText(t) }] });

// ---------- tools ----------

function buildServer(): McpServer {
  const server = new McpServer({ name: "darkspot-coordinator-tools", version: "0.1.0" });

  server.registerTool(
    "get_priority_ranking",
    {
      title: "Priority ranking (silence x population x hazard)",
      description:
        "Evidence only: settlements in a region ranked by silence duration x population x hazard exposure, from ClickHouse mv_priority_rank. " +
        "Cites rows and quotes raw report text verbatim. Never a recommendation of where to go.",
      inputSchema: { region: z.string().min(1).describe("Region / admin-unit name or disaster_event_id"), limit: z.number().int().min(1).max(50).default(10) },
    },
    async ({ region, limit }) => {
      const cfg = chConfigFromEnv();
      const ready = await chViewReady(cfg, "mv_priority_rank");
      if (!ready.ok) return text(notAvailable("Priority ranking", ready.why));
      const rows = await chQuery<RankRow>(
        ready.cfg,
        `SELECT p.settlement_geohash, p.settlement_name, p.rank, p.silence_hours, p.population, p.hazard_exposure,
                c.confidence_tier, s.is_stale, s.last_confirmation_at
         FROM mv_priority_rank p
         LEFT JOIN mv_corroboration c ON c.settlement_geohash = p.settlement_geohash AND c.disaster_event_id = p.disaster_event_id
         LEFT JOIN mv_staleness s ON s.settlement_geohash = p.settlement_geohash AND s.disaster_event_id = p.disaster_event_id
         WHERE p.disaster_event_id = {region:String} OR p.settlement_name ILIKE concat('%', {region:String}, '%')
         ORDER BY p.rank ASC LIMIT {limit:UInt32}`,
        { region, limit },
      );
      // raw report text next to every extracted field
      if (rows.length && (await chViewReady(cfg, "mesh_events")).ok) {
        for (const r of rows) {
          r.raw_reports = await chQuery<{ id: string; raw_text: string }>(
            ready.cfg,
            "SELECT id, raw_text FROM mesh_events WHERE settlement_geohash = {g:String} ORDER BY received_at DESC LIMIT 3",
            { g: r.settlement_geohash },
          );
        }
      }
      return text(formatPriorityRanking(region, rows, `${ready.cfg.db}.mv_priority_rank`));
    },
  );

  server.registerTool(
    "get_conflicts",
    {
      title: "Conflicting reports for a settlement",
      description: "Evidence only: disagreeing reports for a settlement from ClickHouse mv_conflicts, shown side by side with raw text. Nothing is resolved.",
      inputSchema: { settlement: z.string().min(1).describe("Settlement name or geohash") },
    },
    async ({ settlement }) => {
      const cfg = chConfigFromEnv();
      const ready = await chViewReady(cfg, "mv_conflicts");
      if (!ready.ok) return text(notAvailable("Conflicts", ready.why));
      const rows = await chQuery<ConflictRow>(
        ready.cfg,
        `SELECT c.settlement_geohash, c.field, c.value_a, c.event_id_a, a.raw_text AS raw_a, c.value_b, c.event_id_b, b.raw_text AS raw_b
         FROM mv_conflicts c
         LEFT JOIN mesh_events a ON a.id = c.event_id_a
         LEFT JOIN mesh_events b ON b.id = c.event_id_b
         WHERE c.settlement_geohash = {s:String} LIMIT 50`,
        { s: settlement },
      );
      return text(formatConflicts(settlement, rows, `${ready.cfg.db}.mv_conflicts`));
    },
  );

  server.registerTool(
    "get_route_plan",
    {
      title: "Simulated relay/ferry route plan",
      description:
        "SIMULATION ONLY. Returns rows from drone_routes_simulated (is_simulation = true). No drone is flying; nothing here is deconflicted with an airspace authority.",
      inputSchema: { fleet_size: z.number().int().min(1).max(100).describe("Number of simulated relay units") },
    },
    async ({ fleet_size }) => {
      const ready = await pgTableReady("drone_routes_simulated");
      if (!ready.ok) return text(notAvailable("Simulated route plan", ready.why));
      try {
        const r = await ready.client.query(
          "SELECT id, is_simulation, waypoints, relay_positions, created_at FROM drone_routes_simulated WHERE is_simulation = true ORDER BY created_at DESC LIMIT $1",
          [fleet_size],
        );
        return text(formatRoutePlan(fleet_size, r.rows as RouteRow[], "postgres.drone_routes_simulated"));
      } finally {
        await ready.client.end();
      }
    },
  );

  return server;
}

// ---------- http ----------

const http = createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, clickhouse: Boolean(process.env.CLICKHOUSE_URL), postgres: Boolean(process.env.DATABASE_URL) }));
    return;
  }
  if (!req.url?.startsWith("/mcp")) {
    res.writeHead(404).end();
    return;
  }
  // Stateless: a fresh server+transport per request (SDK-recommended pattern for stateless streamable HTTP).
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

http.listen(PORT, () => {
  console.log(`[darkspot-tools] MCP on http://0.0.0.0:${PORT}/mcp  (instance ${randomUUID().slice(0, 8)})`);
  console.log(`[darkspot-tools] clickhouse=${process.env.CLICKHOUSE_URL ?? "unset"} postgres=${process.env.DATABASE_URL ? "set" : "unset"}`);
});
