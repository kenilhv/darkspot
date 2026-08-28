/**
 * DarkSpot guard proxy — an OpenAI-compatible /v1/chat/completions endpoint that
 * LibreChat is pointed at (librechat.yaml → endpoints.custom → baseURL).
 *
 * Why a proxy: LibreChat has no output hook, so "system prompt + hope" is not
 * enforcement. Here every assistant turn is (1) generated with the Rule 1
 * system prompt prepended and (2) checked by the deterministic guard before
 * the user sees it. A flagged answer is replaced with a fixed refusal — never
 * partially scrubbed (see guard/rule1.ts).
 *
 * Upstream: any OpenAI-compatible chat endpoint.
 *   UPSTREAM_BASE_URL  e.g. https://api.inference.net/v1 (inference.net, per §2)
 *                      or   https://api.anthropic.com/v1 (Anthropic's OpenAI-SDK-compat layer)
 *   UPSTREAM_API_KEY
 * Both unset → the proxy still boots and answers /v1/models, but completions
 * return 503 with an honest "no upstream configured" message. Nothing is faked.
 *
 * Streaming: clients may ask for stream=true; the proxy requests a non-streamed
 * completion upstream (the guard needs the whole text), then emits it as a
 * single SSE chunk. Tool calls pass through untouched — their arguments are
 * data for the tool server, and the tool server guards its own output.
 *
 * Zero LLM dependency for the guard itself (Rule 3 / D-4).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { enforceRule1 } from "../guard/rule1.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const SYSTEM_PROMPT = readFileSync(join(here, "..", "prompts", "coordinator.system.md"), "utf8");

export interface ProxyOptions {
  upstreamBaseUrl?: string;
  upstreamApiKey?: string;
  onGuardEvent?: (e: { blocked: boolean; violations: unknown[]; model: string }) => void;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Prepend the DarkSpot system prompt; keep any client system prompt after it. */
export function withSystemPrompt(messages: any[]): any[] {
  return [{ role: "system", content: SYSTEM_PROMPT }, ...messages];
}

/** Apply the guard to an OpenAI-shaped completion object, in place. Returns whether anything was blocked. */
export function guardCompletion(completion: any): { blocked: boolean; violations: unknown[] } {
  let blocked = false;
  const violations: unknown[] = [];
  for (const choice of completion.choices ?? []) {
    const msg = choice.message;
    if (!msg || typeof msg.content !== "string" || msg.content.length === 0) continue;
    const r = enforceRule1(msg.content);
    if (r.blocked) {
      blocked = true;
      violations.push(...r.result.violations);
      msg.content = r.text;
    }
  }
  return { blocked, violations };
}

export function createProxy(opts: ProxyOptions) {
  return createServer(async (req, res) => {
    const url = req.url ?? "/";
    if (req.method === "GET" && url === "/healthz") {
      return json(res, 200, { ok: true, upstream: Boolean(opts.upstreamBaseUrl && opts.upstreamApiKey) });
    }
    if (req.method === "GET" && url.endsWith("/models")) {
      // LibreChat may probe this; a configured model list lives in librechat.yaml, so this is informational only.
      return json(res, 200, { object: "list", data: [] });
    }
    if (req.method !== "POST" || !url.endsWith("/chat/completions")) {
      return json(res, 404, { error: { message: "not found" } });
    }
    let body: any;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: { message: "invalid JSON" } });
    }
    if (!opts.upstreamBaseUrl || !opts.upstreamApiKey) {
      return json(res, 503, {
        error: {
          message:
            "DarkSpot guard proxy: no upstream model configured (UPSTREAM_BASE_URL / UPSTREAM_API_KEY unset). " +
            "No answer is generated — this is unverified, not a stub.",
        },
      });
    }

    const wantStream = body.stream === true;
    const upstreamBody = { ...body, stream: false, messages: withSystemPrompt(body.messages ?? []) };
    delete upstreamBody.stream_options;

    let completion: any;
    try {
      const r = await fetch(`${opts.upstreamBaseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.upstreamApiKey}` },
        body: JSON.stringify(upstreamBody),
      });
      const text = await r.text();
      if (!r.ok) return json(res, r.status, { error: { message: `upstream ${r.status}: ${text.slice(0, 500)}` } });
      completion = JSON.parse(text);
    } catch (e) {
      return json(res, 502, { error: { message: `upstream unreachable: ${(e as Error).message}` } });
    }

    const g = guardCompletion(completion);
    opts.onGuardEvent?.({ blocked: g.blocked, violations: g.violations, model: String(body.model ?? "") });
    if (g.blocked) console.error("[rule1] blocked assistant turn:", JSON.stringify(g.violations));

    if (!wantStream) return json(res, 200, completion);

    // Re-emit as a single SSE chunk so streaming clients work unchanged.
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const chunk = {
      id: completion.id,
      object: "chat.completion.chunk",
      created: completion.created,
      model: completion.model,
      choices: (completion.choices ?? []).map((c: any) => ({
        index: c.index,
        delta: { role: "assistant", content: c.message?.content ?? null, tool_calls: c.message?.tool_calls },
        finish_reason: c.finish_reason ?? "stop",
      })),
      usage: completion.usage,
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 3312);
  createProxy({ upstreamBaseUrl: process.env.UPSTREAM_BASE_URL, upstreamApiKey: process.env.UPSTREAM_API_KEY }).listen(port, () => {
    console.log(`[darkspot-proxy] OpenAI-compatible guard proxy on http://0.0.0.0:${port}/v1  upstream=${process.env.UPSTREAM_BASE_URL ?? "unset (503 on completions)"}`);
  });
}
