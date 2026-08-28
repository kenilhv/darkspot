import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getTracer, _resetTracer, type SpanRecord } from "./honeyhive.ts";

beforeEach(() => {
  _resetTracer();
  delete process.env.HH_API_KEY;
});

test("without HH_API_KEY: local-unverified mode, spans recorded and explicitly marked not sent", async () => {
  const spans: SpanRecord[] = [];
  const t = await getTracer({ sessionName: "s1", sink: (r) => spans.push(r) });
  assert.equal(t.mode, "local-unverified");
  const ranking = t.wrap("tool", "get_priority_ranking", async (region: string) => `ranking for ${region}`);
  const answer = t.wrap("chain", "chat_turn", async (q: string) => {
    const r = await ranking("Trishuli");
    t.enrich({ metadata: { guard_blocked: false } });
    return `answer: ${r}`;
  });
  assert.equal(await answer("what is silent?"), "answer: ranking for Trishuli");
  assert.deepEqual(spans.map((s) => s.name), ["get_priority_ranking", "chat_turn"]);
  assert.ok(spans.every((s) => s.sent_to_honeyhive === false && s.session === "s1" && s.ok));
  assert.match(String(spans[0].metadata?.note), /NOT sent to HoneyHive/);
  assert.equal(spans[1].metadata?.guard_blocked, false);
  assert.deepEqual(spans[0].inputs, ["Trishuli"]);
});

test("wrapping never changes behaviour: return value identical, errors rethrown and recorded", async () => {
  const spans: SpanRecord[] = [];
  const t = await getTracer({ sink: (r) => spans.push(r) });
  const obj = { content: [{ type: "text", text: "x".repeat(500) }] };
  const f = t.wrap("tool", "obj", async () => obj);
  assert.equal(await f(), obj);
  const boom = t.wrap("model", "extract", async () => {
    throw new Error("upstream 500");
  });
  await assert.rejects(boom(), /upstream 500/);
  assert.equal(spans[1].ok, false);
  assert.equal(spans[1].error, "upstream 500");
  // outputs are summarised, not dumped
  assert.equal((spans[0].outputs as any).length, 500);
});

test("with a bogus HH_API_KEY the real SDK is attempted; on failure we fall back rather than crash", async () => {
  process.env.HH_API_KEY = "not-a-real-key";
  process.env.HH_SERVER_URL = "http://127.0.0.1:9"; // nothing listens here
  const t = await getTracer({ sink: () => {} });
  assert.ok(t.mode === "honeyhive" || t.mode === "local-unverified");
  const f = t.wrap("tool", "noop", async (x: number) => x + 1);
  assert.equal(await f(1), 2);
  await t.flush();
  delete process.env.HH_SERVER_URL;
});
