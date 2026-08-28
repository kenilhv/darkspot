import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createProxy, SYSTEM_PROMPT } from "./server.ts";

// Fake upstream: echoes back a canned assistant reply chosen by the last user message,
// and records what it was sent so we can assert the system prompt was injected.
let upstream: Server, proxy: Server, upstreamPort: number, proxyPort: number;
let lastUpstreamBody: any;

const CANNED: Record<string, string> = {
  directive: "Ward 4 has been silent 31h. Send the first team to Ward 4 now.",
  evidence: "Ward 4: no confirmation for 31h, rank 1 of 12 (mv_priority_rank row tuvz1).",
};

before(async () => {
  upstream = createServer((req, res) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      lastUpstreamBody = JSON.parse(d);
      const last = lastUpstreamBody.messages.at(-1).content;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "x",
          object: "chat.completion",
          created: 1,
          model: lastUpstreamBody.model,
          choices: [{ index: 0, message: { role: "assistant", content: CANNED[last] ?? last }, finish_reason: "stop" }],
        }),
      );
    });
  });
  await new Promise<void>((r) => upstream.listen(0, r));
  upstreamPort = (upstream.address() as any).port;
  proxy = createProxy({ upstreamBaseUrl: `http://localhost:${upstreamPort}/v1`, upstreamApiKey: "test" });
  await new Promise<void>((r) => proxy.listen(0, r));
  proxyPort = (proxy.address() as any).port;
});

after(() => {
  proxy.close();
  upstream.close();
});

async function chat(content: string, stream = false) {
  const r = await fetch(`http://localhost:${proxyPort}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "m", stream, messages: [{ role: "user", content }] }),
  });
  return { status: r.status, text: await r.text() };
}

test("system prompt is prepended on every upstream call", async () => {
  await chat("evidence");
  assert.equal(lastUpstreamBody.messages[0].role, "system");
  assert.equal(lastUpstreamBody.messages[0].content, SYSTEM_PROMPT);
  assert.equal(lastUpstreamBody.stream, false);
});

test("evidence-only answers pass through unchanged", async () => {
  const { status, text } = await chat("evidence");
  assert.equal(status, 200);
  assert.equal(JSON.parse(text).choices[0].message.content, CANNED.evidence);
});

test("a directive from the model is replaced, not scrubbed", async () => {
  const { status, text } = await chat("directive");
  assert.equal(status, 200);
  const content = JSON.parse(text).choices[0].message.content;
  assert.match(content, /Rule 1 guard/);
  assert.doesNotMatch(content, /Ward 4/);
});

test("streaming clients get one guarded SSE chunk", async () => {
  const { status, text } = await chat("directive", true);
  assert.equal(status, 200);
  const lines = text.split("\n").filter((l) => l.startsWith("data: "));
  assert.equal(lines.at(-1), "data: [DONE]");
  const chunk = JSON.parse(lines[0].slice(6));
  assert.equal(chunk.object, "chat.completion.chunk");
  assert.match(chunk.choices[0].delta.content, /Rule 1 guard/);
});

test("no upstream configured → 503, no fabricated answer", async () => {
  const p = createProxy({});
  await new Promise<void>((r) => p.listen(0, r));
  const port = (p.address() as any).port;
  const r = await fetch(`http://localhost:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error.message, /no upstream model configured/);
  p.close();
});
