/**
 * HoneyHive tracing for the multi-step trajectory (§2):
 *   extraction (model) → ranking query (tool) → route query (tool) → chat answer (model/chain).
 *
 * Uses the real `honeyhive` SDK (HoneyHiveTracer.init / traceTool / traceModel /
 * traceChain / enrichSpan — verified against honeyhive@1.0.45 type declarations)
 * when HH_API_KEY is set. The SDK throws without a key, so without one this
 * module falls back to a LOCAL trace log (JSONL, TRACE_LOG_PATH) that records the
 * same spans and says, in every line, that nothing was sent to HoneyHive. The
 * fallback exists so the trajectory is still inspectable; it is not a substitute
 * for the real thing and is reported as "unverified" in /healthz.
 *
 * Tracing never changes behaviour: a span wrapper returns exactly what the
 * wrapped function returns and rethrows exactly what it throws (Rule 3 — the
 * safety-critical path does not depend on an observability vendor being up).
 *
 * Env: HH_API_KEY, HH_PROJECT (default "darkspot"), HH_SOURCE (default "darkspot-chat"),
 *      HH_SERVER_URL (optional), TRACE_LOG_PATH (fallback JSONL, default data/trace.jsonl).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type SpanKind = "tool" | "model" | "chain";

export interface SpanRecord {
  ts: string;
  session: string;
  kind: SpanKind;
  name: string;
  ms: number;
  ok: boolean;
  error?: string;
  inputs?: unknown;
  outputs?: unknown;
  metadata?: Record<string, unknown>;
  sent_to_honeyhive: boolean;
}

export interface Tracer {
  readonly mode: "honeyhive" | "local-unverified";
  readonly session: string;
  wrap<F extends (...args: any[]) => any>(kind: SpanKind, name: string, fn: F, metadata?: Record<string, unknown>): F;
  /** Attach evidence to the current span (guard verdicts, row counts, tiers). */
  enrich(params: { metadata?: Record<string, unknown>; inputs?: unknown; outputs?: unknown; error?: string | null }): void;
  flush(): Promise<void>;
}

// ---------- local fallback ----------

function localTracer(logPath: string, session: string, sink?: (r: SpanRecord) => void): Tracer {
  let pending: Record<string, unknown> = {};
  const write = (r: SpanRecord) => {
    if (sink) return sink(r);
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify(r) + "\n");
  };
  return {
    mode: "local-unverified",
    session,
    wrap(kind, name, fn, metadata) {
      return (async (...args: any[]) => {
        const t0 = Date.now();
        const base = { ts: new Date().toISOString(), session, kind, name, sent_to_honeyhive: false, metadata: { ...metadata, note: "HH_API_KEY unset — span recorded locally only, NOT sent to HoneyHive" } };
        try {
          const out = await fn(...args);
          write({ ...base, ms: Date.now() - t0, ok: true, inputs: args, outputs: summarize(out), metadata: { ...base.metadata, ...pending } });
          pending = {};
          return out;
        } catch (e) {
          write({ ...base, ms: Date.now() - t0, ok: false, error: String((e as Error)?.message ?? e), inputs: args, metadata: { ...base.metadata, ...pending } });
          pending = {};
          throw e;
        }
      }) as any;
    },
    enrich(p) {
      pending = { ...pending, ...(p.metadata ?? {}), ...(p.error ? { error: p.error } : {}) };
    },
    async flush() {},
  };
}

/** Keep local records small: tool text is long, so store length + head. */
function summarize(out: unknown): unknown {
  if (typeof out === "string") return { length: out.length, head: out.slice(0, 200) };
  if (out && typeof out === "object" && "content" in (out as any)) {
    const t = (out as any).content?.[0]?.text;
    return typeof t === "string" ? { length: t.length, head: t.slice(0, 200) } : out;
  }
  return out;
}

// ---------- real SDK ----------

async function honeyhiveTracer(session: string): Promise<Tracer> {
  const hh = await import("honeyhive");
  const tracer = await hh.HoneyHiveTracer.init({
    apiKey: process.env.HH_API_KEY,
    project: process.env.HH_PROJECT ?? "darkspot",
    source: process.env.HH_SOURCE ?? "darkspot-chat",
    sessionName: session,
    ...(process.env.HH_SERVER_URL ? { serverUrl: process.env.HH_SERVER_URL } : {}),
  });
  const pick = { tool: tracer.traceTool.bind(tracer), model: tracer.traceModel.bind(tracer), chain: tracer.traceChain.bind(tracer) };
  return {
    mode: "honeyhive",
    session: tracer.sessionId ?? session,
    wrap(kind, name, fn, metadata) {
      return pick[kind](fn, { eventName: name, metadata }) as any;
    },
    enrich(p) {
      hh.enrichSpan({ metadata: p.metadata, inputs: p.inputs as any, outputs: p.outputs as any, error: p.error ?? undefined });
    },
    // An observability outage must never surface as an application error (Rule 3).
    flush: () => hh.HoneyHiveTracer.flush().catch((e: unknown) => console.error(`[trace] HoneyHive flush failed: ${(e as Error)?.message ?? e}`)),
  };
}

// ---------- factory ----------

let current: Tracer | null = null;

export async function getTracer(opts: { sessionName?: string; logPath?: string; sink?: (r: SpanRecord) => void } = {}): Promise<Tracer> {
  if (current) return current;
  const session = opts.sessionName ?? `darkspot-chat-${randomUUID().slice(0, 8)}`;
  if (process.env.HH_API_KEY) {
    try {
      current = await honeyhiveTracer(session);
      console.log(`[trace] HoneyHive tracing on (project=${process.env.HH_PROJECT ?? "darkspot"}, session=${current.session})`);
      return current;
    } catch (e) {
      console.error(`[trace] HoneyHive init failed (${(e as Error).message}); falling back to local log — UNVERIFIED`);
    }
  }
  current = localTracer(opts.logPath ?? process.env.TRACE_LOG_PATH ?? "data/trace.jsonl", session, opts.sink);
  console.log(`[trace] HH_API_KEY unset — spans go to ${opts.logPath ?? process.env.TRACE_LOG_PATH ?? "data/trace.jsonl"} only (NOT sent to HoneyHive; tracing unverified)`);
  return current;
}

/** Test hook. */
export function _resetTracer() {
  current = null;
}
