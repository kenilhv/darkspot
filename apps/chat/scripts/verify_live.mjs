// Live verification of the four tools against CORE's local stack (docker compose in ../darkspot-core:
// ClickHouse :8124, Postgres :5433). Inserts "[CHAT-VERIFY-FIXTURE]" rows for the real event, asserts
// tool output for an anonymous caller AND for an authorized principal (D-14) AND for a spoofed token,
// then cleans up: ClickHouse event partition dropped on all four tables (same method as CORE's
// verify_clickhouse_views.py), Postgres fixture principal/org/grant deleted. Run with the tool server up:
//   CLICKHOUSE_URL=http://localhost:8124 CLICKHOUSE_USER=darkspot CLICKHOUSE_PASSWORD=darkspot CLICKHOUSE_DB=darkspot \
//   DATABASE_URL=postgres://darkspot:darkspot@localhost:5433/darkspot BRIDGE_PUBKEY_HEX=<64 hex> TOOLS_SHARED_SECRET=<s> node tools/server.ts
//   TOOLS_SHARED_SECRET=<s> node scripts/verify_live.mjs <disaster_event_id> <settlement_pcode>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import pg from "pg";

const [EVT, PC] = process.argv.slice(2);
if (!EVT || !PC) {
  console.error("usage: node scripts/verify_live.mjs <disaster_event_id> <settlement_pcode>");
  process.exit(2);
}
const CH = process.env.CLICKHOUSE_URL ?? "http://localhost:8124";
const MCP = process.env.MCP_URL ?? "http://localhost:3311/mcp";
const PGURL = process.env.DATABASE_URL ?? "postgres://darkspot:darkspot@localhost:5433/darkspot";
const SECRET = process.env.TOOLS_SHARED_SECRET ?? "";
const FIX = "[CHAT-VERIFY-FIXTURE] ";
const SUBJECT = "librechat-user-verify-" + Date.now();
const HEX = (b) => b.repeat(32);

const ch = (sql) =>
  fetch(`${CH}/?database=${process.env.CLICKHOUSE_DB ?? "darkspot"}`, {
    method: "POST",
    headers: { "X-ClickHouse-User": process.env.CLICKHOUSE_USER ?? "darkspot", "X-ClickHouse-Key": process.env.CLICKHOUSE_PASSWORD ?? "darkspot" },
    body: sql,
  }).then(async (r) => {
    const t = await r.text();
    if (!r.ok) throw new Error(t);
    return t.trim();
  });

const before = await ch(`SELECT count() FROM mesh_events WHERE disaster_event_id = toUUID('${EVT}')`);
if (before !== "0") {
  console.error(`refusing: event ${EVT} already has ${before} mesh_events rows; partition-drop cleanup would destroy them`);
  process.exit(2);
}

const pgc = new pg.Client({ connectionString: PGURL });
await pgc.connect();
const connect = async (headers) => {
  const c = new Client({ name: "verify", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(MCP), { requestInit: { headers } }));
  return c;
};
const anon = await connect({});
const authed = await connect({ "X-DarkSpot-Subject": SUBJECT, "X-DarkSpot-Tools-Token": SECRET });
const spoof = await connect({ "X-DarkSpot-Subject": SUBJECT, "X-DarkSpot-Tools-Token": "wrong-token" });
const call = async (c, label, name, args) => {
  const r = await c.callTool({ name, arguments: args });
  console.log(`\n===== [${label}] ${name} ${JSON.stringify(args)}\n` + r.content[0].text);
  return r.content[0].text;
};

let ok = false;
let orgId = null;
try {
  // Postgres fixtures: org + principal + individual_pii grant for this event (D-14)
  orgId = (
    await pgc.query(
      "INSERT INTO authorized_orgs (disaster_event_id, org_name, org_type, contact_name, contact_channel, registered_by) VALUES ($1, $2, 'ngo', 'fixture', 'fixture', 'CHAT verify_live') RETURNING id",
      [EVT, FIX + "org " + SUBJECT],
    )
  ).rows[0].id;
  const pid = (
    await pgc.query("INSERT INTO principals (external_subject, display_name, authorized_org_id, role, issued_by) VALUES ($1, $2, $3, 'responder', 'CHAT verify_live') RETURNING id", [
      SUBJECT,
      FIX + "responder",
      orgId,
    ])
  ).rows[0].id;
  await pgc.query("INSERT INTO access_roles (disaster_event_id, principal_id, level, granted_by, granted_org_id) VALUES ($1, $2, 'individual_pii', 'CHAT verify_live', $3)", [EVT, pid, orgId]);

  const b = await call(anon, "anon", "get_priority_ranking", { region: PC, limit: 1 });
  await call(anon, "anon", "file_field_report", { raw_text: FIX + "bridge gone, need boats", disaster_event_id: EVT, device_pubkey_hex: HEX("aa"), settlement_pcode: PC });
  await ch(
    `INSERT INTO mesh_events (id, disaster_event_id, device_pubkey, bridge_pubkey, hop_count, reported_at, received_at, settlement_pcode, settlement_geohash, raw_text, extracted_status, extracted_people, extraction_model, extraction_confidence) VALUES
    (generateUUIDv4(), toUUID('${EVT}'), unhex('${HEX("bb")}'), unhex('${HEX("cd")}'), 1, now64(3) - INTERVAL 20 MINUTE, now64(3) - INTERVAL 10 MINUTE, '${PC}', '', '${FIX}all fine here', 'safe', NULL, 'fixture', 0.7),
    (generateUUIDv4(), toUUID('${EVT}'), unhex('${HEX("cc")}'), unhex('${HEX("cd")}'), 1, now64(3) - INTERVAL 15 MINUTE, now64(3) - INTERVAL 5 MINUTE, '${PC}', '', '${FIX}two hurt at the school, 5 people', 'casualties', 5, 'fixture', 0.9)`,
  );
  const t = await call(anon, "anon", "get_priority_ranking", { region: PC, limit: 1 });
  const cf = await call(anon, "anon", "get_conflicts", { settlement: PC });
  const rp = await call(anon, "anon", "get_route_plan", { fleet_size: 3 });
  const ta = await call(authed, "authorized", "get_priority_ranking", { region: PC, limit: 1 });
  const cfa = await call(authed, "authorized", "get_conflicts", { settlement: PC });
  const ts = await call(spoof, "spoofed-token", "get_priority_ranking", { region: PC, limit: 1 });

  const must = [
    [b, /never heard from since activation|no report for/],
    [b, new RegExp(`cited: .*priority_rank row settlement_pcode=${PC}`)],
    [t, /^> \[CHAT-VERIFY-FIXTURE\] bridge gone, need boats$/m],
    [t, /raw text withheld/],
    [t, /restricted \(casualty-related/],
    [t, /access: aggregate_only — (no authenticated caller identity|tools token missing\/invalid)/],
    [cf, /2 distinct statuses from 2 distinct devices/],
    [cf, /^> \[CHAT-VERIFY-FIXTURE\] all fine here$/m],
    [cf, /raw text withheld/],
    [rp, /simulation/i],
    [ta, /access: individual_pii — principal .* \(responder\) holds individual_pii/],
    [ta, /^> \[CHAT-VERIFY-FIXTURE\] two hurt at the school, 5 people$/m],
    [ta, /people stated=5/],
    [ta, /casualties: unverified-single-source/],
    [cfa, /^> \[CHAT-VERIFY-FIXTURE\] two hurt at the school, 5 people$/m],
    [cfa, /extracted_status=casualties:/],
    [ts, /access: aggregate_only — tools token missing\/invalid/],
    [ts, /raw text withheld/],
  ];
  const mustNot = [
    [t, /two hurt|5 people|extracted_people|status=casualties|undefined/],
    [cf, /two hurt|5 people|status=casualties|undefined/],
    [ts, /two hurt|5 people/],
  ];
  for (const [txt, re] of must) if (!re.test(txt)) throw new Error("MISSING " + re);
  for (const [txt, re] of mustNot) if (re.test(txt)) throw new Error("LEAK " + re);
  ok = true;
  console.log(`\nASSERTIONS PASS (${must.length} must, ${mustNot.length} must-not)`);
} finally {
  await Promise.all([anon.close(), authed.close(), spoof.close()]);
  for (const tb of ["mesh_events", "silence_state", "corroboration_state", "staleness_state"]) await ch(`ALTER TABLE ${tb} DROP PARTITION '${EVT}'`);
  const left = await ch(`SELECT count() FROM mesh_events WHERE disaster_event_id = toUUID('${EVT}')`);
  await pgc.query("DELETE FROM access_roles WHERE principal_id IN (SELECT id FROM principals WHERE external_subject = $1)", [SUBJECT]);
  await pgc.query("DELETE FROM principals WHERE external_subject = $1", [SUBJECT]);
  if (orgId) await pgc.query("DELETE FROM authorized_orgs WHERE id = $1", [orgId]);
  const pgLeft = (
    await pgc.query("SELECT (SELECT count(*) FROM principals WHERE external_subject = $1) + (SELECT count(*) FROM authorized_orgs WHERE org_name LIKE $2) AS n", [SUBJECT, FIX + "%"])
  ).rows[0].n;
  await pgc.end();
  console.log("cleanup: mesh_events rows left for event =", left, "; postgres fixture rows left =", pgLeft);
  if (left !== "0" || String(pgLeft) !== "0") ok = false;
}
process.exit(ok ? 0 : 1);
