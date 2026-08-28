# DarkSpot — demo runbook

## Pre-flight (one command, run it ~5 min before)

```bash
cd D:/hackathons/darkspot && bash scripts/demo-up.sh
```

Rebuilds the site, starts anything that is down, checks every URL, and prints the live
ClickHouse row count and current rank-1 settlement. **Every line must be green.** If one is not,
that is the thing to fix — not something to discover on stage.

## The one URL

**http://localhost:5200** — everything is reachable from here.

| | Where | What it proves |
|---|---|---|
| Landing | `/` | The idea in three sentences, and the honesty framing up front |
| Coordinator view | `/coordinator/` | Real HDX + Copernicus/HOT data, ranked, every factor shown |
| Swarm simulation | `/sim/` | PSO placement → AntHocNet routing → Hungarian/auction allocation |
| Tool server proof | `bash scripts/demo-tool-call.sh` | Real cited data from the same MCP path the guard/chat design uses |
| SQL console | ClickHouse Cloud → database **`darkspot`** | The live query, run in front of them |

> ⚠️ **Do not free-chat with LibreChat in front of the judges.** Found late in prep: LibreChat's
> agent layer isn't reliably invoking the real tools — it answered a test question with a fully
> fabricated, confident-sounding citation (a `mesh_events` row that doesn't exist, a made-up
> timestamp, a made-up population figure). The tool server itself is real and correct; use
> `scripts/demo-tool-call.sh` to prove that instead. Full detail in "Known gaps" below.

---

## The arc (~5 min)

### 1. The turn (30s) — landing page

> "Every disaster dashboard ranks the places that are *reporting*. But the places most at risk
> are usually the ones that have gone completely silent — their connectivity was already marginal
> before the disaster, and it's gone after it. So we rank the silence."

Then, immediately, before anyone has to ask:

> "And the honest part first — no DarkSpot device has ever been in the field. So silence here
> means we have no data, not that a village went quiet. The system says that on every screen."

Saying the limitation *first* is the whole credibility play with this panel. Three of these
judges work on getting AI systems from prototype to production; they will find it anyway.

### 2. The evidence (60s) — `/coordinator/`

61 settlements, ranked. Point at one card:

> "Every factor that produced this rank is printed on the card — silence, population, hazard, and
> where each number came from. The rank is a sort order, not a risk score. And this card says
> its population is a parent-district figure, because Nepal's census doesn't publish at this level.
> We show the seam instead of smoothing it over."

### 3. It's actually live (45s) — ClickHouse Cloud console

Run it in front of them, twice:

```sql
SELECT settlement_name, silence_hours, population_used, hazard_exposure, priority_score, rank
FROM darkspot.priority_rank ORDER BY rank LIMIT 5
```

> "Run it again — the silence clock has moved. Nothing is precomputed. That view is ClickHouse
> reading Postgres live over a cross-database bridge, recomputing on every query: Postgres holds
> canonical state and human decisions, ClickHouse does the ranking."

That second run is the strongest 10 seconds in the demo. **Don't skip it.**

### 4. The swarm layer (90s) — `/sim/`

Press **Run**. Let the mesh form.

> "Relay placement by particle-swarm optimisation, routing by an AntHocNet-inspired ant-colony
> protocol with an AODV baseline running beside it, and task allocation two ways — Hungarian when
> a unit can reach command, decentralised auction when it can't. That last part matters: the whole
> premise is that central connectivity fails, so the allocator can't assume it either."

Then scroll the right-hand panel:

> "Every algorithm here cites the paper it came from, on the page. And every route is labelled a
> simulation — no drone is flying, and nothing here has been deconflicted with any airspace
> authority. Uncoordinated drones ground real rescue aircraft; that's not a detail we get to skip."

### 5. The guard, shown as code and a real call — not live chat

> "The design: a proxy sits between any model and the user, checks every response, and blocks an
> imperative before it's ever shown — not a system prompt hoping for good behaviour. And every tool
> call cites the exact row it came from."

Run this — it's a real call through the same MCP tool the guard/chat design is built on, no UI in the way:

```bash
bash scripts/demo-tool-call.sh Trishuli
```

Real cited settlements come back, same as the coordinator view. Then, plainly, no hedging:

> "One honest thing we found in the last hour of prep: LibreChat's own chat layer isn't reliably
> calling this tool yet — in one test it answered with a fabricated citation instead of a real one.
> The tool server and the guard logic are both real and independently verified, which is what you're
> seeing here. Wiring them fully into the chat UI is unfinished, and I'd rather tell you that than
> paper over it with a demo that might do the same thing again in front of you."

Judges from HoneyHive and Requesty specifically will respect this more than a live chat that might
misfire — it's exactly the kind of failure they design their own products to catch.

### 6. Close (20s)

> "This is a prototype, and it stays one until there's an authorised partner organisation, airspace
> integration, and field validation. What we're claiming is narrower than 'this saves lives': it's
> that ranking silence is the right signal, that it can be computed honestly from real public data,
> and that the failure modes were designed for first."

---

## The four rules (if asked what makes it safe)

1. **No dispatch action exists in the data model.** It can say what is known; it cannot say where to go.
2. **No casualty/location/urgency field is actionable without a named human** — a `NOT NULL` column, not a UI convention.
3. **The safety-critical core runs with no LLM.** The model only narrates a result that already exists.
4. **Every UAV route is a labelled simulation** until deconflicted with a real airspace authority.

---

## Likely questions

**"Is this actually live or a mock?"** → Run the SQL twice, show the clock move. 1,440 real admin
units from HDX, hazard extent from Copernicus/HOT, both cited per row.

**"What happens when your model provider goes down?"** *(Requesty's angle)* → Nothing important.
Ranking and allocation are deterministic ClickHouse and plain algorithms. The model only narrates.

**"How do you know the agent isn't making things up?"** *(HoneyHive's angle)* → Every tool response
cites the exact row it came from, and shows raw report text beside anything extracted. The guard is
a deterministic check in a proxy, with an 18-prompt adversarial eval.

**"What about spoofed reports?"** → Corroboration counts *distinct device identities*, not messages,
which stops replay. It does **not** stop Sybil — someone can mint keys. Trust tiers are in the schema;
gating on them is next. (Say this plainly — our own review caught it, that's the answer.)

**"Why should a coordinator trust this over what they have?"** → They shouldn't replace anything.
It's an ingestion and corroboration layer that exports into Ushahidi/Sahana/CrisisCleanup — none of
which have offline mesh collection. That gap is the reason this exists.

**"Does it work outside Nepal?"** → Every source is a pluggable connector; the loader was proven on a
second country (Bangladesh, 580 units) specifically to show nothing is hardcoded.

---

## Known gaps — say these before you're asked

- **LibreChat's agent layer does not reliably call the real tools.** Found live during prep: asked
  it a grounded question, it answered fluently with a specific-looking citation — a `mesh_events`
  row id, a timestamp, a population figure — none of which exist in the real data. The guard proxy
  and tool server were both checked during the same test and received **zero requests** for that
  turn, so the model invented the entire answer, formatted to look like a real tool result. Root
  cause not fully found — most likely LibreChat needs the MCP tool explicitly attached to an Agent
  record, not just declared reachable in config. **Do not run free-form chat live in front of
  judges.** Use `scripts/demo-tool-call.sh` instead — same tool, called directly, real data.
- No mesh hardware has ever run in the field. The transport is bitchat's published protocol; our
  implementation of it is not field-tested.
- LibreChat and the tool server are local, not deployed.
- HoneyHive tracing is wired but unverified — no API key, so spans go to a local file.
- Population is parent-district for every row (Nepal's census doesn't publish finer), which lets
  population dominate the ranking. Known, visible on every card, fix identified.

## If something breaks

- **A page won't load** → re-run `bash scripts/demo-up.sh`; it restarts whatever is down.
- **Sim looks blank** → you're at the site root of the old standalone server; use `localhost:5200/sim/`.
- **SQL console shows no tables** → the database dropdown is on `default`; switch it to **`darkspot`**.
- **`demo-tool-call.sh` errors** → check `docker ps` shows `librechat-darkspot-tools-1` running;
  restart with `docker compose -f ../darkspot-chat/apps/chat/librechat/docker-compose.yml up -d darkspot-tools`.
- **Everything is down** → the coordinator view and sim are static files under `site/`; open
  `site/index.html` directly in the browser and the two main surfaces still work.
