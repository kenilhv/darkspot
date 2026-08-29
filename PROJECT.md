# DarkSpot — the complete project explainer

This is the one document that explains everything: the problem, the idea, every piece of the
architecture in plain language, what's real vs. simulated, how it was built, and what's still
broken. Read this before talking to judges — the [README](README.md) is the polished GitHub-facing
version and [DEMO.md](DEMO.md) is the live-demo script; this is the "understand it well enough to
answer anything" version.

---

## 1. The problem, in one paragraph

After a disaster, every dashboard ranks the places that are **reporting in**. That sounds
reasonable until you notice the flaw: the places most at risk are usually the ones that have gone
**completely silent** — their phone/internet connectivity was already weak before the disaster,
and it's gone entirely after it. A system that ranks by report volume doesn't rank those places
low. It doesn't rank them at all. They just disappear from view, exactly when they need attention
most.

DarkSpot's whole idea is to flip that: **rank silence itself**, not reports. How long has each
place gone without any confirmation, weighted by how many people live there and whether a hazard
is known to have reached them.

## 2. Where this came from

This started as a response to a real, current event: a **glacial lake outburst flood in the
Trishuli river basin, Nepal, on 26 August 2026** — 389+ confirmed dead, 900-1,500+ missing at the
time. That event is why the demo data is Nepal-specific. But the system itself was deliberately
built to be **region- and hazard-agnostic** — nothing is hardcoded to Nepal or to floods. Every
data source is a "connector" that could point at a different country or a different disaster type,
and the loader was specifically tested against a second country (Bangladesh, 580 real
administrative units) just to prove that claim rather than assert it.

## 3. What DarkSpot actually does, end to end

1. **Collects data from places with zero connectivity.** Phones relay messages to each other over
   Bluetooth, hop by hop, with no cell tower or wifi involved at all, until a message reaches one
   point that has real connectivity (the "bridge").
2. **Ranks silence.** A database layer computes, for every real settlement: how long since any
   confirmation, how many people live there, whether a hazard is known to have reached it — and
   combines those into a sort order.
3. **Hands the result to a human.** Never an instruction. Never a "go here." Just cited evidence,
   shown to whoever has actual authority on the ground.

That's the whole product, described without any jargon. Everything below is *how*.

---

## 4. The mesh layer — how data gets out of a place with no signal

### The core idea: relays

Imagine passing a note across a classroom by handing it to your neighbor, who hands it to their
neighbor, and so on until it reaches the front. Each kid in that chain didn't write the note and
doesn't need to read it — their only job is "received it, pass it toward the destination." That's
a **relay**, in full.

In a real disaster, two phones sitting near each other can usually still talk over Bluetooth even
with zero cell signal or wifi. But Bluetooth's range is short — maybe 50-100 meters in the open,
much less through buildings or rubble. So a message has to **hop**: villager's phone → nearest
neighboring phone → next phone → ... → the one point that has real connectivity.

**What's real here:** the actual hop-by-hop mechanism is built on a real, published, open-source
protocol called **[bitchat](https://github.com/permissionlesstech/bitchat)** (public domain,
legally forkable — verified by reading its own whitepaper, not assumed). It handles things like
not re-sending the same message forever, storing a message locally if no path exists yet and
trying again later, and basic encryption between devices.

**What's simulated:** *where* to place extra relay devices to best cover an area. That's a separate
optimization problem, described next.

### Relay placement — swarm intelligence, piece 1: PSO

If you wanted to drop a handful of dedicated relay devices into a valley to extend coverage (not
just rely on random villagers' phones), where should they go to cover the most people with the
fewest devices? That's a real, published optimization problem, solved here with **Particle Swarm
Optimization (PSO)** — an algorithm that works like a flock of particles exploring a space,
each one nudged by its own best-found position and the swarm's best-found position, converging on
a good (not perfect, but good) placement.

- **Code:** [`swarm/src/pso.js`](https://github.com/kenilhv/darkspot/blob/agent/swarm/swarm/src/pso.js), branch `agent/swarm`
- **Source:** Sakamoto, Oda, Ikeda, Barolli, Xhafa & Woungang, *"Investigation of Fitness Function
  Weight-Coefficients for Optimization in WMN-PSO Simulation System"*, CISIS 2016 — a real academic
  formulation for wireless mesh router placement, not something invented for this project.
- **Honest label:** this is simulation-stage academic work. It's real math solving a real
  formulation, but it has never placed a physical relay in a real field.
- **Important clarification:** the placement algorithm doesn't know or specify *what kind of
  device* goes at the point it picks — a phone, a repeater box, a parked vehicle, or in principle a
  hovering drone would all work. It only decides "put something here." (See §5 for why this is
  a different mechanism from the UAV drone route.)

### Routing — swarm intelligence, piece 2: AntHocNet vs. AODV

Once relays exist, how does a specific message decide *which path* through the mesh to take?
Two algorithms run side by side here, on purpose:

**AntHocNet** — inspired by how ant colonies find efficient trails to food. Small "ant" probe
packets explore the mesh; whichever paths actually deliver data fast get their "pheromone" trail
reinforced, so future packets naturally lean toward routes that are currently working. If a link
breaks, the pheromone on that path fades and the mesh reroutes — no central map required.

- **Code:** [`swarm/src/anthocnet.js`](https://github.com/kenilhv/darkspot/blob/agent/swarm/swarm/src/anthocnet.js) (249 lines)
- **Source:** Ducatelle, Di Caro & Gambardella, *International Journal of Computational
  Intelligence and Applications* 5(2), 2005 — the implementation was checked constant-by-constant
  against the authors' own paper, with the paper's equation numbers cited directly next to the
  matching code.

**AODV (Ad hoc On-Demand Distance Vector)** — the older, simpler, genuinely-used-in-the-real-world
alternative (RFC 3561). No pheromones, no continuous adaptation — a route request floods outward,
whichever reply arrives first becomes the fixed path until it breaks.

- **Code:** [`swarm/src/aodv.js`](https://github.com/kenilhv/darkspot/blob/agent/swarm/swarm/src/aodv.js) (90 lines)
- **Why it's there:** as an honest baseline, so the claim "AntHocNet performs better" is something
  we can actually show side-by-side, not just assert.
- **Neither has real disaster field testing.** Said plainly, everywhere this comes up.

### Taskforce allocation — swarm intelligence, piece 3: the interesting design call

Once you know which settlements need attention (from the silence ranking) and which response units
exist, someone has to decide who goes where. Two methods, used **based on connectivity**:

- **Hungarian algorithm** (Kuhn 1955 / Munkres 1957) — a real, well-known, decades-old algorithm
  that finds the mathematically *optimal* set of pairings, minimizing total cost across everyone at
  once. Used when a unit has a live connection back to command, so command can see the whole board.
- **Sequential single-item auction** (Dias et al., 2006) — used when a unit is cut off. Units that
  *can* see each other bid on nearby tasks themselves — "I'm closest, I'll take it" — with no
  central authority involved, since none is reachable.

**Why this is the sharpest design decision in the whole build:** the textbook-correct answer is
"just always use Hungarian, it's provably optimal." But that requires a central coordinator that
can reach every unit — the exact assumption this entire project exists to reject. So both are
implemented, and the system switches automatically based on real connectivity, rather than picking
one algorithm and hoping the assumption holds. Same philosophy as staleness decaying to "unknown"
instead of trusting old data, or the safety-critical core running with zero LLM dependency:
**degrade gracefully instead of breaking.**

- **Code:** [`swarm/src/allocation.js`](https://github.com/kenilhv/darkspot/blob/agent/swarm/swarm/src/allocation.js), `hungarian.js`, `auction.js`
- **Cost formula (ours, not from a paper, stated honestly):** `cost = distance / priority` — closer
  is cheaper, and a higher-priority settlement is also cheaper, so it wins ties when tasks outnumber units.
- **Rule 1, enforced here too:** the output is a *suggested pairing with the reasoning shown* —
  nothing is shaped like a dispatch order.

### The UAV message-ferry — a different mechanism entirely, not "the relays"

This is a real point of confusion worth being precise about (it came up directly in prep): the
orange relay triangles and the magenta "UAV ferry route" line are **two separate mechanisms**, not
the same thing wearing different colors.

- **Relays** (above) are modeled as *stationary points* in a continuous mesh chain.
- **Message ferrying** is for when two parts of the mesh have **no chain connecting them at all** —
  too far apart, nothing to bridge the gap. Instead of trying to place a relay in between, a drone
  physically **flies over, picks up the accumulated messages, and flies them back** — more like a
  courier than a link in a chain.

- **Code:** [`swarm/src/ferry.js`](https://github.com/kenilhv/darkspot/blob/agent/swarm/swarm/src/ferry.js)
- **Source:** Zhao, Ammar & Zegura, *"A Message Ferrying Approach for Data Delivery in Sparse
  Mobile Ad Hoc Networks"*, ACM MobiHoc 2004 — a real, established delay-tolerant-networking concept.
- **This is the only place a UAV appears in the system**, and every route it produces is forced
  `is_simulation = true` at the database level (see §7, Rule 4). No aircraft is flying, and nothing
  here has been deconflicted with any real airspace authority — said explicitly because
  uncoordinated drones are a documented real hazard to manned rescue aircraft.

---

## 5. The data layer — Postgres and ClickHouse, and what each actually answers

### The division of labor, plainly

**Postgres (OLTP — transactional)** is where the answer has to be **exact and defensible** — the
things where you cannot have a fuzzy or approximate answer.

| Table | The exact question it answers |
|---|---|
| `authorized_orgs` | Is any real organization actually registered to operate here? (If no: the system is inert for this region — the deployment gate.) |
| `admin_units` | What are the real settlements, exactly, per official UN boundary data? |
| `hazard_exposure` | Does an official source (Copernicus/HOT) say this place was actually hit? |
| `devices` / `device_sightings` | Which mesh devices exist, and was one ever physically near this settlement? |
| `reports_human_review` | Did a real human look at this report, and what did they decide? |
| `escalations` | Who, by name, approved treating this as urgent? (Schema-enforced: cannot exist without a real name.) |
| `access_roles` / `principals` | Who is this viewer, and are they allowed to see restricted fields? |
| `drone_routes_simulated` | Was this route ever really flown? (Schema-forced: always `false`.) |

**ClickHouse (OLAP — analytical)** doesn't hold its own separate truth — it reaches *live* into
those same Postgres tables and asks a completely different kind of question: not "what's true
about one row" but **"how does this row compare against all 1,440 of them, right now."**

| ClickHouse view | Built from (via live bridge into Postgres) | The question it answers |
|---|---|---|
| `silence_duration` | hazard_exposure + disaster_events + admin_units + device_sightings + reports_human_review + mesh_events | For every settlement: how long since any confirmation, and was a device even near enough to confirm it? |
| `priority_rank` | silence_duration + admin_units | Sort all in-scope settlements by silence × population × hazard |
| `corroboration` | mesh_events + devices (trust tier) | How many *distinct* devices reported the same thing? |
| `staleness` | mesh_events + disaster_events | Has this settlement's last known status aged past the point we should still trust it? |
| `conflicts` | mesh_events + disaster_events | Do two reports about the same place actually disagree? |

### How the two are actually wired together

ClickHouse has a built-in `PostgreSQL` table engine — you write
`ENGINE = PostgreSQL(host, database, table, user, password)` and that ClickHouse table becomes a
**live window** into the real Postgres table. No sync job, no copy, no staleness. We built five of
these "bridge" tables (`pg_admin_units`, `pg_hazard_exposure`, `pg_disaster_events`,
`pg_device_sightings`, `pg_reports_human_review`), and the `silence_duration`/`priority_rank`
views are joins on top of those bridge tables.

**The proof this is genuinely live, not cached:** run the exact same query twice —

```sql
SELECT settlement_name, silence_hours, rank FROM darkspot.priority_rank ORDER BY rank LIMIT 5
```

— and the `silence_hours` number is different the second time. As of writing this, rank 1
(Ichchha Kamana) reads **91.2 hours** — it was 71.6 hours a few hours earlier in this same
session, because it's recomputing against real elapsed time on every single query, not reading a
snapshot.

The `mesh_events` table (raw report log, append-only, never edited) is the other half of
ClickHouse's job — it's the right engine for a write-heavy, ever-growing log that gets scanned and
aggregated, which is exactly what ClickHouse is built to do fast, while Postgres stays focused on
the smaller set of rows that genuinely need transactional guarantees.

---

## 6. The AI/chat layer — what's proven and what isn't

### The guard architecture (real, verified)

LibreChat has no output hook, so "write a good system prompt and hope" isn't real enforcement.
Instead, a **guard proxy** sits between any model and the user: every response is generated *and
then checked* by a deterministic guard before the user ever sees it. A flagged answer is replaced
wholesale — never partially edited, which could leave a dangerous fragment behind.

- **Code:** [`apps/chat/guard/rule1.ts`](https://github.com/kenilhv/darkspot/blob/agent/chat/apps/chat/guard), tested with an 18-prompt adversarial eval trying to trick it into giving orders.
- **Tool server:** [`apps/chat/tools/server.ts`](https://github.com/kenilhv/darkspot/blob/agent/chat/apps/chat/tools/server.ts) — every tool response cites the exact ClickHouse row it came from and shows the original raw report text beside anything the model extracted from it.
- **Model:** Nebius Token Factory (Llama-3.3-70B-Instruct), any OpenAI-compatible provider works — the guard doesn't care which model sits behind it.

### The gap — found during rehearsal, not hidden

Asking LibreChat's own chat UI a grounded question produced a **fully fabricated but
confident-sounding answer** — a citation to a `mesh_events` row that doesn't exist, a made-up
timestamp, a made-up population figure. Checking both the guard proxy and the tool server's logs
for that exact moment: **zero requests reached either one.** The model invented the entire answer
in the shape of a real tool response.

Two real bugs were found and fixed on the way (LibreChat doesn't substitute `${VAR}`-style
placeholders in its config file — two places silently broke because of this), but fixing those did
**not** fix the underlying issue. Root cause not yet confirmed — most likely LibreChat's Agent
system needs the MCP tool explicitly attached to an Agent record, not just declared reachable in
config.

**Decision: live free-form chat is not demoed.** Instead, `scripts/demo-tool-call.sh` calls the
real tool server directly — same code, same guard design, no unproven orchestration layer — and
returns real cited data. That's the honest live proof.

---

## 7. The four rules nothing in this codebase is allowed to break

| # | Rule | Enforced how |
|---|---|---|
| 1 | No dispatch action exists in the data model. Can say what's known, never where to go. | No dispatch-shaped table/field anywhere. Guard blocks imperatives in model output. |
| 2 | No casualty/location/urgency field is actionable without a named human. | `escalations.authorized_by` is `NOT NULL` with a non-blank `CHECK` — a database constraint, not a UI convention. |
| 3 | The safety-critical core runs with zero LLM dependency. | Ranking, routing, allocation are all deterministic math. The model only narrates a result that already exists without it. |
| 4 | Every UAV route is a labelled simulation until deconflicted with a real airspace authority. | `drone_routes_simulated.is_simulation` is `BOOLEAN NOT NULL DEFAULT true CHECK (is_simulation)` — cannot be flipped. |

**Why rule 2 exists:** NAMI's Board resolution (30 May 2026) holds AI systems shouldn't substitute
for crisis support and should route people to humans — our rule is stricter than their statement,
deliberately.

**Why rule 4 exists:** the US Forest Service documented ≥20 unauthorized drone flights over
wildfires in 2019 alone that shut down aerial firefighting operations nine separate times. This is
the easiest rule to accidentally break in a pitch, because the drone layer is the flashiest part.

---

## 8. Real data — what's actually cited, what isn't

| Data | Source | Reality check |
|---|---|---|
| Administrative units + population | HDX/OCHA Common Operational Datasets | 1,440 real units loaded — 860 Nepal, 580 Bangladesh (proves the connector isn't hardcoded) |
| Hazard extent | Copernicus EMS activation + Humanitarian OpenStreetMap Team (ODbL) | 61 in-scope units for the actual Trishuli event; `unknown` where no activation exists, never assumed |
| Population granularity | Nepal's census only publishes to district level | Every row flagged `population_basis='parent'` — shown, not hidden |
| Field reports (mesh) | The mesh network itself | **Zero.** No device has ever been deployed. `coverage_basis='none'` on every single row, surfaced everywhere it's used |

That last row matters more than any other fact in this document: **"silence" currently means "we
have no data," not "a settlement went quiet."** The system says this in the database schema, in
every tool response, and on every card in the UI — not as a disclaimer bolted on, but as the actual
computed value.

---

## 9. How this was actually built

Six AI agents in parallel git worktrees, one shared coordination document, one human supervisor.
Each agent looped every ~10 minutes: re-read shared state, pick the smallest real unit of work,
implement, **verify**, commit, log.

Two disciplines did most of the real work:

- **No claim without a citation.** A dedicated research agent audited every technical assertion
  against primary sources — it withdrew one citation that turned out not to exist (a supposed
  drone-flight-trial paper), corrected a license misattribution (bitchat is Unlicense/public
  domain, not MIT as first assumed), and downgraded a "strongest baseline" claim to "reasonable
  baseline" after checking the actual underlying study. *"Verified in an earlier conversation" was
  explicitly ruled out as a citation.*
- **Verification is always the last step, never skipped.** This is also how the LibreChat
  fabrication bug got caught — by actually running the thing and checking logs, not by trusting
  that "the port responds" meant "the feature works."

**Current real numbers** (re-verified, not carried from memory): 27/27 swarm algorithm tests pass,
34/34 chat tool-server tests pass, 114/114 WCAG contrast pairs pass, 1,440 real settlement rows
loaded across two countries, 61 rows live-ranked on ClickHouse Cloud right now.

---

## 10. What's proven vs. not — the complete honest ledger

| | Status |
|---|---|
| Postgres schema + rule constraints | ✅ verifier passes |
| ClickHouse views (ranking, staleness, corroboration) | ✅ verifier passes |
| HDX loader, 2 countries | ✅ 1,440 units, provenance per row |
| Swarm algorithms vs. published papers | ✅ AntHocNet checked constant-by-constant against the authors' PDF |
| Chat tool server, direct call | ✅ verified live against ClickHouse Cloud |
| Rule 1 guard (deterministic layer) | ✅ tested, 18-prompt adversarial eval |
| Design system contrast (light + dark) | ✅ 114 WCAG pairs |
| **LibreChat reliably invoking real tools in live chat** | ❌ found fabricating citations, root cause not yet fixed |
| HoneyHive tracing | ⚠️ wired with the real SDK, unverified — no API key, spans go to a local file |
| Mesh transport in the actual field | ❌ never run on real hardware |
| Deployment | ❌ runs locally; `render.yaml` is committed, nothing is deployed |

---

## 11. Where things live in the repo (branch : path)

| Piece | Branch | Path |
|---|---|---|
| Postgres schema (8 migrations) | `agent/core` | `db/postgres/001..008*.sql` |
| ClickHouse views | `agent/core` | `db/clickhouse/*.sql` |
| HDX / Copernicus connectors | `agent/core` | `connectors/hdx_cod.py`, `connectors/copernicus_ems.py` |
| PSO relay placement | `agent/swarm` | `swarm/src/pso.js` |
| AntHocNet routing | `agent/swarm` | `swarm/src/anthocnet.js` |
| AODV baseline | `agent/swarm` | `swarm/src/aodv.js` |
| Taskforce allocation | `agent/swarm` | `swarm/src/allocation.js`, `hungarian.js`, `auction.js` |
| UAV message ferry | `agent/swarm` | `swarm/src/ferry.js` |
| Canvas simulation UI | `agent/swarm` | `swarm/web/sim.js` |
| Rule 1 guard proxy | `agent/chat` | `apps/chat/proxy/server.ts`, `apps/chat/guard/rule1.ts` |
| MCP tool server | `agent/chat` | `apps/chat/tools/server.ts` |
| LibreChat config | `agent/chat` | `apps/chat/librechat/librechat.yaml` |
| `@darkspot/ui` design system | `agent/design-system` | `packages/ui/src/` |
| Coordinator view | `agent/design-system` | `packages/ui/demo/coordinator.tsx` |
| Unified demo site | `main` | `site/`, `scripts/build-site.mjs` |
| Demo scripts | `main` | `scripts/demo-up.sh`, `scripts/demo-tool-call.sh` |

---

## 12. Future goals, three horizons

**Near term:** gate corroboration on device trust tier (currently defeats replay, not Sybil —
someone can mint fake device keys); use a finer, properly-licensed population layer instead of
parent-district figures; re-order the priority formula so hazard tier is checked before population
can dominate; get HoneyHive tracing actually verified with a real key; fix the LibreChat
tool-invocation gap.

**Medium term:** find one real partner organization (the `authorized_orgs` gate means the system is
inert until this happens — not a technicality, the actual design); build an export path into
Ushahidi/Sahana Eden/CrisisCleanup (established platforms with real users, none of which have
offline mesh collection — that gap is the actual reason to build this rather than another
dashboard); field-test the mesh transport on real hardware; get an independent security review of
the mesh cryptography.

**Longer term:** real airspace deconfliction with an actual authority before any UAV route is
anything but a simulation; physical flight-dynamics simulation for the drone layer specifically
(NVIDIA Isaac Sim + the Pegasus extension is the right tool for that one piece — and the wrong tool
for everything else here, since it has no capability for simulating wireless mesh networks at all,
which is what most of this project actually is); open-source release under a permissive license,
because a tool asking to be trusted in a life-safety context should be auditable by the people
being asked to trust it.

---

## 13. The one sentence to lead with, if you only get one

**"Every disaster dashboard ranks the places that are loudest — DarkSpot ranks the places that
have gone silent, because those are usually the ones connectivity failed first, and we built it to
show exactly what it doesn't know, not just what it does."**
