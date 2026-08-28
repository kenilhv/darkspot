import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractReport, publicFields } from "./extract.ts";
import { newReport, storeReport } from "./store.ts";

const DEV = "ab".repeat(32);
const BRIDGE = "cd".repeat(32);
const EVT = "11111111-2222-4333-8444-555555555555";

test("no key → unverified-no-extraction, model '' (matches mesh_events.extraction_model default), nothing inferred", async () => {
  const r = await extractReport("bridge gone at simaltal 3 hurt", {});
  assert.equal(r.status, "unverified-no-extraction");
  assert.equal(r.fields, null);
  assert.equal(r.model, "");
});

test("with a (fake) upstream → CORE-shaped fields; casualty status and headcount hidden from public view", async () => {
  const fakeFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.temperature, 0);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ extracted_status: "casualties", extracted_people: 3, settlement_mentioned: "simaltal", language: "en", confidence: 0.8 }) } }] }), { status: 200 });
  };
  const r = await extractReport("bridge gone at simaltal 3 hurt", { apiKey: "k", model: "m", baseUrl: "http://fake/v1", fetchImpl: fakeFetch });
  assert.equal(r.status, "extracted");
  assert.equal(r.fields?.extracted_status, "casualties");
  assert.equal(r.fields?.extracted_people, 3);
  const pub = publicFields(r.fields) as any;
  assert.equal("extracted_people" in pub, false);
  assert.match(pub.extracted_status, /restricted/);
  assert.equal(pub.settlement_mentioned, "simaltal");
});

test("schema-violating model output → failed-closed", async () => {
  const r = await extractReport("x", { apiKey: "k", model: "m", baseUrl: "http://fake/v1", fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ extracted_status: "dead", extracted_people: -1 }) } }] }), { status: 200 }) });
  assert.equal(r.status, "failed-closed");
  assert.equal(r.fields, null);
});

test("upstream failure → failed-closed", async () => {
  const r = await extractReport("x", { apiKey: "k", model: "m", baseUrl: "http://fake/v1", fetchImpl: async () => new Response("nope", { status: 500 }) });
  assert.equal(r.status, "failed-closed");
});

test("store: outbox always written with raw text; mesh_events honestly 'not-available' for each precondition", async () => {
  const outbox = join(tmpdir(), `darkspot-outbox-${Date.now()}.jsonl`);
  const extraction = await extractReport("water rising fast at ward 4", {});
  const ch = { url: "http://localhost:1", user: "", password: "", db: "darkspot" };

  let out = await storeReport(newReport({ disaster_event_id: EVT, device_pubkey_hex: DEV, raw_text: "water rising fast at ward 4" }, extraction), outbox, null, BRIDGE);
  assert.equal(out.mesh_events, "not-available");
  assert.match(out.detail, /CLICKHOUSE_URL not set/);

  out = await storeReport(newReport({ disaster_event_id: EVT, device_pubkey_hex: DEV, raw_text: "x" }, extraction), outbox, ch, undefined);
  assert.match(out.detail, /BRIDGE_PUBKEY_HEX/);

  out = await storeReport(newReport({ disaster_event_id: EVT, device_pubkey_hex: "volunteer-7", raw_text: "x" }, extraction), outbox, ch, BRIDGE);
  assert.match(out.detail, /64 hex chars/);

  out = await storeReport(newReport({ disaster_event_id: "evt-1", device_pubkey_hex: DEV, raw_text: "x" }, extraction), outbox, ch, BRIDGE);
  assert.match(out.detail, /must be a UUID/);

  out = await storeReport(newReport({ disaster_event_id: EVT, device_pubkey_hex: DEV, raw_text: "x" }, extraction), outbox, ch, BRIDGE);
  assert.match(out.detail, /ClickHouse error/);

  const lines = readFileSync(outbox, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 5);
  assert.equal(lines[0].raw_text, "water rising fast at ward 4");
  assert.ok(lines.every((l) => l.synced === false));
  rmSync(outbox);
});
