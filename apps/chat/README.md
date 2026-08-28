# DarkSpot CHAT — LibreChat integration

Evidence-only chat over CORE's data. No dispatch. Nothing here decides where anyone goes (COORDINATION.md §1a Rule 1).

## What's here

| Dir | What | Enforces |
|---|---|---|
| `guard/` | `rule1.ts` deterministic directive detector (zero-LLM); `rule1.eval.ts` 18-prompt adversarial eval | Rule 1, Rule 3 |
| `prompts/` | `coordinator.system.md` — the agent's actual instructions | Rule 1, 2, 4 |
| `proxy/` | OpenAI-compatible endpoint LibreChat talks to: injects the system prompt, runs the guard on every assistant turn, 503 (not a stub) without an upstream | Rule 1 at runtime |
| `tools/` | MCP server: `get_priority_ranking`, `get_conflicts`, `get_route_plan`, `file_field_report`; `contract.ts` = columns required from CORE, DESCRIBE-checked, fail closed | Rule 2 (redaction), Rule 4 ("simulation" in the text) |
| `intake/` | extraction (inference.net, strict JSON schema, CORE's status enum) + outbox/mesh_events store | raw text never discarded |
| `librechat/` | compose stack: LibreChat + Mongo + tools + proxy; `librechat.yaml` wires both | — |
| `scripts/verify_live.mjs` | end-to-end check against CORE's running stack, self-cleaning fixtures | — |

## Run

```sh
cd apps/chat && npm ci && npm test                 # 22 unit tests, no network, no keys
node guard/rule1.eval.ts                           # live-model layer runs only with INFERENCE_API_KEY+INFERENCE_MODEL or ANTHROPIC_API_KEY; otherwise reports UNVERIFIED
cd librechat && cp .env.example .env               # fill secrets; DBs default to ../darkspot-core's local compose
docker compose up -d --build                       # http://localhost:3080 ; LibreChat log must say "[MCP] Initialized with 1 configured server and 4 tools"
```

Live verification (CORE's stack up in `../darkspot-core`, tool server running with the env in `.env.example`):

```sh
node scripts/verify_live.mjs <disaster_events.id> <settlement_pcode>
```

It refuses to run if the event already has `mesh_events` rows, because its cleanup drops the event partition (same method as CORE's `verify_clickhouse_views.py`).

## Honest status

- Rule 1 guard: tested (unit) and enforced at runtime by the proxy and by the tool server on its own output. The live-model half of the eval is **unverified** until a model key exists (§4).
- Extraction: **unverified** — no inference.net key; reports are stored as `extracted_status='unextracted'`, never guessed.
- Access control: CORE's `access_roles` exists but no caller identity is wired, so every viewer is `aggregate_only`: `extracted_people` is never shown, status `casualties` is a restricted marker, and the raw text of casualty-status reports is withheld (§6 decision).
- HoneyHive tracing: wired with the real `honeyhive` SDK (`trace/honeyhive.ts`: tool, model and chain spans over extraction → ranking → route → chat turn) but **unverified** — no HH_API_KEY, so spans go to `data/trace.jsonl` marked "NOT sent". Known gap: LibreChat does not propagate a conversation id to MCP tools or to the proxy, so proxy and tool spans land in separate sessions until that exists.
- Route plans: read from `drone_routes_simulated` only; every response says "simulation" in prose.
