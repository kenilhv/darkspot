import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractReport, publicFields } from "./extract.ts";
import { newReport, storeReport } from "./store.ts";

test("no key → unverified-no-extraction, nothing inferred", async () => {
  const r = await extractReport("bridge gone at simaltal 3 hurt", {});
  assert.equal(r.status, "unverified-no-extraction");
  assert.equal(r.fields, null);
  assert.equal(r.provider, null);
});

test("with a (fake) upstream → extracted, restricted fields hidden from public view", async () => {
  const fakeFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.temperature, 0);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ settlement: "simaltal", hazard: "bridge collapse", needs: null, access_status: "bridge gone", people_mentioned: 3, casualty_count: 3, exact_location: null, urgency_tier: null, language: "en" }) } }],
      }),
      { status: 200 },
    );
  };
  const r = await extractReport("bridge gone at simaltal 3 hurt", { apiKey: "k", model: "m", baseUrl: "http://fake/v1", fetchImpl: fakeFetch });
  assert.equal(r.status, "extracted");
  assert.equal(r.fields?.casualty_count, 3);
  const pub = publicFields(r.fields) as any;
  assert.equal("casualty_count" in pub, false);
  assert.equal("exact_location" in pub, false);
  assert.equal("urgency_tier" in pub, false);
  assert.equal(pub.settlement, "simaltal");
});

test("upstream failure → failed-closed, raw text still stored", async () => {
  const r = await extractReport("x", { apiKey: "k", model: "m", baseUrl: "http://fake/v1", fetchImpl: async () => new Response("nope", { status: 500 }) });
  assert.equal(r.status, "failed-closed");
  assert.equal(r.fields, null);
});

test("store: outbox always written with raw text; mesh_events honestly 'not-available' without ClickHouse", async () => {
  const outbox = join(tmpdir(), `darkspot-outbox-${Date.now()}.jsonl`);
  const extraction = await extractReport("water rising fast at ward 4", {});
  const report = newReport({ disaster_event_id: "evt-1", device_pubkey: "dev-1", raw_text: "water rising fast at ward 4" }, extraction);
  const out = await storeReport(report, outbox, null);
  assert.equal(out.mesh_events, "not-available");
  assert.match(out.detail, /outbox only/);
  const line = JSON.parse(readFileSync(outbox, "utf8").trim());
  assert.equal(line.raw_text, "water rising fast at ward 4");
  assert.equal(line.synced, false);
  assert.equal(line.id, report.id);
  rmSync(outbox);
});
