// Live verification of the four tools against CORE's local stack (docker compose in ../darkspot-core:
// ClickHouse :8124, Postgres :5433). Inserts "[CHAT-VERIFY-FIXTURE]" rows for the real event, asserts
// tool output, then drops the event partition on all four ClickHouse tables — the same cleanup CORE's
// scripts/verify_clickhouse_views.py uses. Run with the tool server up:
//   CLICKHOUSE_URL=http://localhost:8124 CLICKHOUSE_USER=darkspot CLICKHOUSE_PASSWORD=darkspot CLICKHOUSE_DB=darkspot \
//   DATABASE_URL=postgres://darkspot:darkspot@localhost:5433/darkspot BRIDGE_PUBKEY_HEX=<64 hex> node tools/server.ts
//   node scripts/verify_live.mjs <disaster_event_id> <settlement_pcode>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const [EVT, PC] = process.argv.slice(2);
if (!EVT || !PC) { console.error("usage: node scripts/verify_live.mjs <disaster_event_id> <settlement_pcode>"); process.exit(2); }
const CH = process.env.CLICKHOUSE_URL ?? "http://localhost:8124", MCP = process.env.MCP_URL ?? "http://localhost:3311/mcp", FIX = "[CHAT-VERIFY-FIXTURE] ";
const ch = (sql) => fetch(`${CH}/?database=${process.env.CLICKHOUSE_DB ?? "darkspot"}`, { method: "POST", headers: { "X-ClickHouse-User": process.env.CLICKHOUSE_USER ?? "darkspot", "X-ClickHouse-Key": process.env.CLICKHOUSE_PASSWORD ?? "darkspot" }, body: sql }).then(async r => { const t = await r.text(); if (!r.ok) throw new Error(t); return t.trim(); });
const before = await ch(`SELECT count() FROM mesh_events WHERE disaster_event_id = toUUID('${EVT}')`);
if (before !== "0") { console.error(`refusing: event ${EVT} already has ${before} mesh_events rows; partition-drop cleanup would destroy them`); process.exit(2); }
const c = new Client({ name: "verify", version: "0" });
await c.connect(new StreamableHTTPClientTransport(new URL(MCP)));
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args }); console.log(`\n===== ${name} ${JSON.stringify(args)}\n` + r.content[0].text); return r.content[0].text; };
let ok = false;
try {
  const b = await call("get_priority_ranking", { region: PC, limit: 1 });
  await call("file_field_report", { raw_text: FIX + "bridge gone, need boats", disaster_event_id: EVT, device_pubkey_hex: "aa".repeat(32), settlement_pcode: PC });
  await ch(`INSERT INTO mesh_events (id, disaster_event_id, device_pubkey, bridge_pubkey, hop_count, reported_at, received_at, settlement_pcode, settlement_geohash, raw_text, extracted_status, extracted_people, extraction_model, extraction_confidence) VALUES
    (generateUUIDv4(), toUUID('${EVT}'), unhex('${"bb".repeat(32)}'), unhex('${"cd".repeat(32)}'), 1, now64(3) - INTERVAL 20 MINUTE, now64(3) - INTERVAL 10 MINUTE, '${PC}', '', '${FIX}all fine here', 'safe', NULL, 'fixture', 0.7),
    (generateUUIDv4(), toUUID('${EVT}'), unhex('${"cc".repeat(32)}'), unhex('${"cd".repeat(32)}'), 1, now64(3) - INTERVAL 15 MINUTE, now64(3) - INTERVAL 5 MINUTE, '${PC}', '', '${FIX}two hurt at the school, 5 people', 'casualties', 5, 'fixture', 0.9)`);
  const t = await call("get_priority_ranking", { region: PC, limit: 1 });
  const cf = await call("get_conflicts", { settlement: PC });
  const rp = await call("get_route_plan", { fleet_size: 3 });
  const must = [[b, /never heard from since activation|no report for/], [b, new RegExp(`cited: .*priority_rank row settlement_pcode=${PC}`)], [t, /^> \[CHAT-VERIFY-FIXTURE\] bridge gone, need boats$/m], [t, /raw text withheld/], [t, /restricted \(casualty-related/], [cf, /2 distinct statuses from 2 distinct devices/], [cf, /^> \[CHAT-VERIFY-FIXTURE\] all fine here$/m], [cf, /raw text withheld/], [rp, /simulation/i]];
  const mustNot = [[t, /two hurt|5 people|extracted_people|status=casualties|undefined/], [cf, /two hurt|5 people|status=casualties|undefined/]];
  for (const [txt, re] of must) if (!re.test(txt)) throw new Error("MISSING " + re);
  for (const [txt, re] of mustNot) if (re.test(txt)) throw new Error("LEAK " + re);
  ok = true;
  console.log(`\nASSERTIONS PASS (${must.length} must, ${mustNot.length} must-not)`);
} finally {
  await c.close();
  for (const tb of ["mesh_events", "silence_state", "corroboration_state", "staleness_state"]) await ch(`ALTER TABLE ${tb} DROP PARTITION '${EVT}'`);
  const left = await ch(`SELECT count() FROM mesh_events WHERE disaster_event_id = toUUID('${EVT}')`);
  console.log("cleanup: mesh_events rows left for event =", left);
  if (left !== "0") ok = false;
}
process.exit(ok ? 0 : 1);
