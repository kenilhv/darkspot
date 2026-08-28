import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const here = dirname(fileURLToPath(import.meta.url));

test("tool server boots and exposes exactly the four contract tools; all fail closed without DBs", async () => {
  const child = spawn(process.execPath, [join(here, "server.ts")], { env: { ...process.env, PORT: "0", CLICKHOUSE_URL: "", DATABASE_URL: "" } });
  const port = await new Promise<number>((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const m = out.match(/:(\d+)\/mcp/);
      if (m) resolve(Number(m[1]));
    });
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) => reject(new Error(`server exited ${code}: ${out}`)));
  });
  try {
    const c = new Client({ name: "test", version: "0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`)));
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["file_field_report", "get_conflicts", "get_priority_ranking", "get_route_plan"]);
    for (const [name, args] of [
      ["get_priority_ranking", { region: "x" }],
      ["get_conflicts", { settlement: "x" }],
      ["get_route_plan", { fleet_size: 1 }],
    ] as const) {
      const r: any = await c.callTool({ name, arguments: args });
      assert.match(r.content[0].text, /not available/);
      assert.match(r.content[0].text, /this is not an empty result/);
    }
    const route: any = await c.callTool({ name: "get_route_plan", arguments: { fleet_size: 1 } });
    assert.match(route.content[0].text, /simulat/i);
    await c.close();
  } finally {
    child.kill();
  }
});

test("numeric args arriving as strings (as Llama-3.3 emits them via the proxy) are coerced, not rejected", async () => {
  const child = spawn(process.execPath, [join(here, "server.ts")], { env: { ...process.env, PORT: "0", CLICKHOUSE_URL: "", DATABASE_URL: "" } });
  const port = await new Promise<number>((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (d) => { out += d; const m = out.match(/:(\d+)\/mcp/); if (m) resolve(Number(m[1])); });
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) => reject(new Error(`server exited ${code}: ${out}`)));
  });
  try {
    const c = new Client({ name: "test", version: "0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`)));
    const a: any = await c.callTool({ name: "get_priority_ranking", arguments: { region: "x", limit: "12" } });
    assert.notEqual(a.isError, true);
    assert.match(a.content[0].text, /not available/);
    const b: any = await c.callTool({ name: "get_route_plan", arguments: { fleet_size: "3" } });
    assert.notEqual(b.isError, true);
    assert.match(b.content[0].text, /simulat/i);
    await c.close();
  } finally {
    child.kill();
  }
});
