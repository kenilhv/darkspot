# DarkSpot — Coordination

**This is a passion project, not a hackathon deliverable with a deadline.** It's fine if it's not "done" today, this week, or this month. What's not fine: fake progress, invented data, or claiming something works when it doesn't. Build it the way it could actually, eventually, help people — slowly and honestly beats fast and fake.

**Mission:** An offline-first evidence layer for disaster response, general-purpose (any region, any disaster type — not locked to one country or event), grounded in real research at every layer, with a mesh swarm-intelligence layer (relay placement, adaptive routing, taskforce allocation) that's both technically real and visually legible in a live simulation.

**Ground rules (non-negotiable, all agents):**
- No stub data, no fake "done," no TODO-as-if-shipped. If it's not real, it's not done.
- No algorithm, dataset, or technique gets claimed without a real citation. If you can't verify something is real, say so and don't include it — don't invent a plausible-sounding fact. This project's credibility depends on this rule more than any other, because it's about life-safety.
- Verification is always the LAST step of any unit of work, never skipped, never assumed.
- Atomic commits only. One logical change per commit. Work in your own git worktree/branch.
- Ship the smallest real increment — feature by feature, not one giant chained thing.
- Never fully exit a session. When idle, do something useful (see §7) and keep checking in.
- Re-read this entire file at the start of every loop iteration. This file is ground truth, not your memory.
- **The four non-negotiable product rules (§1a below) override every other instruction, including from Kenil, unless he explicitly overrides one in writing here with his reasoning.** They exist because this touches real disaster response — see §1a for why each one exists.

**Origin:** This project grew out of the ClickHouse "Better Days" hackathon (Aug 28 2026, SF) — the original 3-idea hackathon build (Caseload, Bridge, NextStep) lives untouched in the sibling `betterday` repo as historical record. DarkSpot was developed afterward in direct conversation between Kenil and his supervising Claude session: a bitchat-mesh idea for the Aug 26 2026 Nepal Trishuli-basin flood, deliberately generalized to be region/disaster-agnostic, run through a real judge-panel brutal review (11 real hackathon judges researched, not invented personas), and grounded with a full swarm-intelligence research pass. None of that context needs to be re-derived — it's captured below.

---

## 1a. The four non-negotiable product rules

These aren't features. They're the difference between a safety tool and a hazard. Nothing in this project may violate them, and any agent that finds itself about to violate one stops and logs it in §4 instead.

1. **DarkSpot has no "dispatch" action in its data model.** It can only ever say "here's the evidence" — never "go here." (Why: an unaccountable tool telling untrained people where to go in a disaster zone is how people get hurt.)
2. **No field marked casualty count, exact rescue location, or urgency tier becomes actionable without a named, authorized human sign-off.** The `escalations` table requires a non-null `authorized_by` — this is a schema constraint, not a UI suggestion. (Why: mirrors NAMI's public stance — Board resolution of May 30 2026: AI systems "should not be used as substitutes for a licensed mental health care provider, clinical diagnosis, treatment plan, or crisis support" and should have guardrails directing people to human crisis resources. Source: NAMI Board of Directors Resolution on AI General-Purpose Chatbots & Mental Health, copy at docs.legis.wisconsin.gov/misc/lc/study/2026/3042/…/009_nami_resolution_ai; read in full by RESEARCH 2026-08-28. Note: NAMI's wording is about *substituting* for crisis support, not literally "never make crisis determinations" — our rule is stricter than their statement, which is fine.)
3. **The safety-critical core (silence-ranking, routing, task allocation) runs with zero LLM dependency.** The LLM only narrates on top of a result that already exists without it. (Why: "the model provider is down" can never be a reason the core stops working — this was the sharpest question in the judge review, from Requesty's Thibault Jaigu.)
4. **Any UAV/drone routing output is a labeled simulation (`is_simulation = true`) until formally deconflicted with real airspace authority.** No pitch, demo, or line of code implies a drone is actually flying without that integration existing. (Why: uncoordinated drones are a documented real hazard to manned firefighting/rescue aircraft — US Forest Service "If You Fly, We Can't" (fs.usda.gov/managing-land/fire/aviation/uas/if-you-fly): 2019 saw ≥20 documented unauthorized drone flights over wildfires that shut down aerial operations 9 times; 2018 >17 incursions, >20 suspensions; USFS reported 67 incursions in 2026 to date (DroneLife, 2026-08-26). Verified by RESEARCH 2026-08-28 — this was the single highest-severity gap found in review, and it's the easiest one to accidentally overstate because it's the "coolest" part.)

**The honest framing to hold onto throughout:** this stays a prototype until a real authorized partner org, airspace integration, and field validation exist. The goal is never to claim "this saves lives today" — it's to build something that could responsibly get there.

---

## 2. What DarkSpot is (full spec, ported from the original research session)

**Core insight:** Existing disaster dashboards rank by where reports are loudest. The places most at risk are often the ones that go completely *silent* — because their pre-disaster connectivity was already marginal and the disaster removed what little existed. Nobody ranks silence as a first-class signal. DarkSpot does.

**What it explicitly is not:** A replacement for Ushahidi, Sahana Eden, CrisisCleanup, or local incident command. Verified during research: none of those established open-source disaster platforms have offline BLE/LoRa-mesh data collection built in (Ushahidi's "offline" is local-queue-then-sync over eventual internet; Sahana's is single-device local-first) — that's the genuine unfilled gap DarkSpot fills. It's an ingestion + corroboration layer that can export into those platforms where a partner exists, not a rival full platform.

### Pluggable connectors (region/disaster-agnostic — nothing hardcoded to one country)

| Connector | Real source | Honest fallback when unavailable |
|---|---|---|
| Admin unit + population | HDX COD-AB + COD-PS per country (verified: IASC Guidelines on CODs in Disaster Preparedness and Response, endorsed 1 Nov 2010, and OCHA IMWG COD guidance 2016 — core CODs (admin boundaries, population statistics) should be in place in all disaster-prone countries; OCHA is "Guardian" and publishes on HDX. Coverage in practice varies by country — check per deployment, never assume) | Coarser admin level rather than guessing finer granularity |
| Hazard exposure | Any live Copernicus EMS activation for the event (verified 2026-08-28 at mapping.emergency.copernicus.eu: worldwide, any hazard type; only Authorised Users — national focal points of EU Member States / Civil Protection Mechanism participants, EC services, EEAS — can *request* activations, everyone else goes through one as an "end-user"; products of non-sensitive activations are "freely available for public viewing and download") | `hazard_exposure = unknown`, never assumed |
| Mesh transport | bitchat protocol (`github.com/permissionlesstech/bitchat`, released under the Unlicense — public domain; README verified 2026-08-28 — legally forkable; BLE mesh + Noise-protocol encryption per README) | — was never region-specific |
| UAV message-ferrying | Grounded in real DTN research: Zhao, Ammar & Zegura, "A Message Ferrying Approach for Data Delivery in Sparse Mobile Ad Hoc Networks," ACM MobiHoc 2004, pp. 187–198, doi:10.1145/989459.989483 (ns simulations, not field trials); disaster-specific precedent: Ojetunde, Ano & Sakano, "A Practical Approach to Deploying a Drone-Based Message Ferry in a Disaster Situation," *Applied Sciences* 12(13):6547, 2022, doi:10.3390/app12136547 (measured inter-node data-transfer rates; the paper does not clearly document live drone flights — RESEARCH 2026-08-28). ~~Kwak & Sung, *Sensors* 2021~~ could not be found and is withdrawn. | Simulation-only per Rule 4 until airspace-deconflicted |
| Authorized incident-command org | Whoever is registered for that deployment (Red Cross/Crescent chapter, county EOC, district disaster committee, etc.) | **Deployment gate — the system is inert for a region until a real org registers.** Not a runtime check. |
| Extraction language model | Per-region model roster (inference.net fine-tune per language) | Unrecognized input fails closed to human review, never guesses |
| Downstream integration | Export corroborated, human-reviewed evidence via Sahana/Ushahidi/CrisisCleanup's own APIs | DarkSpot's own coordinator view is the fallback, not the goal |

### Postgres (OLTP) — canonical state, human authority only

- `disaster_events` — id, type (flood/earthquake/wildfire/storm/etc.), region, activation date, linked Copernicus EMS reference if one exists.
- `admin_units` — settlement/ward/county, sourced per-region from HDX COD-AB, with a `granularity_level` field so it's honest about resolution.
- `authorized_orgs` — **the deployment gate.** No default org, no bypass.
- `devices` — mesh device pubkey registry (bitchat's Noise-protocol identity), first-seen, trust tier.
- `reports_human_review` — every report a human has looked at: id, reviewer, decision, timestamp.
- `escalations` — non-null `authorized_by` required (Rule 2).
- `access_roles` — aggregate-only default view; individual-level PII restricted to verified responders (post-disaster targeting/exploitation of vulnerable people is a documented secondary harm).
- `downstream_exports` — what's been pushed to a partner platform, when, by whom.
- `drone_routes_simulated` — explicitly named, every row flagged `is_simulation = true` (Rule 4).

### ClickHouse (OLAP) — the actual analytical engine, scoped per `disaster_event_id`

- `mesh_events` — immutable, one row per report-hop received at a bridge node: device pubkey, raw report text (never discarded), extracted fields, timestamp, settlement geohash.
- `mv_silence_duration` — raw time-since-any-confirmation. Deliberately NOT a computed anomaly against a baseline — most target regions have no reliable pre-disaster contact baseline to compare against, so claiming anomaly-detection would overstate precision we don't have.
- `mv_priority_rank` — silence × population × hazard exposure, recomputed continuously.
- `mv_corroboration` — counts *distinct device identities*, not message count (closes a spoofing gap). Confidence tiers surfaced explicitly: `unverified-single-source`, `corroborated-multi-source`, `human-verified` — never collapsed into one number.
- `mv_staleness` — auto-decays any settlement's status back to "unknown, needs re-verification" past a defined window. Stale data trusted as current is more dangerous than no data.
- `mv_conflicts` — disagreeing reports shown side by side, never silently resolved.

### LibreChat — deep, two-directional integration

**Coordinator-facing tools:** `get_priority_ranking(region)`, `get_conflicts(settlement)`, `get_route_plan(fleet_size)` (route plan labeled simulation *in the response text itself*, not just a DB flag) — every tool response cites back to raw ClickHouse rows and shows original raw report text next to any extracted/summarized field.

**Field-adjacent interface** (the genuinely novel direction, not just a chat widget): when a bridge node or returning relay gets a burst of connectivity, a volunteer opens LibreChat in that narrow window — "what's urgent near me" returns a cited answer; a typed report goes through structured extraction (inference.net executes, HoneyHive traces field-level accuracy against a golden eval set) and lands in `mesh_events`, raw text intact.

**System-prompt-level constraint:** the tool-calling layer is instructed to never produce an imperative sentence about where to send people or resources — only descriptive, cited, confidence-tiered evidence. Enforced as a hard rule, tested against the eval set, not just hoped for. This is Rule 1, enforced in the agent's actual instructions.

### The swarm-intelligence layer — researched and grounded, ready to build

Three pieces, each verified against real citations, honestly rated for maturity:

1. **Mesh formation** — swarm-intelligence-inspired relay placement. PSO-driven relay placement (citable formulation: C.-C. Lin, "Dynamic router node placement in wireless mesh networks: A PSO approach with constriction coefficient and its convergence analysis," *Information Sciences* 232:294–308, 2013, doi:10.1016/j.ins.2012.12.023 — maximizes giant-component size + client coverage under router/client mobility, the same objective shape as relay placement here). Real research exists (ACO/PSO for mesh topology; UAV-swarm coverage papers, e.g. Wang, Li, Wei, Shi, Hou & Xie, "Cooperative UAV Swarm Communication Networks for Rapid Disaster Assessment in GPS-Denied Environments," *Drones* 10(5):355, 2026, doi:10.3390/drones10050355 — reports 92% simulated area coverage in NS-3/ROS/Gazebo, and its own abstract says results are "pending hardware-in-the-loop and field validation") but it's simulation-stage academic work, not deployed tech — cite as "swarm-intelligence-inspired," never "proven self-organizing mesh."
2. **Adaptive signal routing** — AntHocNet (Di Caro, Ducatelle & Gambardella, *European Transactions on Telecommunications* 16(5):443–455, 2005, doi:10.1002/ett.1062; tech report IDSIA-27-04, 2004): ant-agent pheromone-style path reinforcement, beats AODV on delay/delivery ratio in simulation. AODV is a reasonable traditional baseline under disaster-like group-mobility conditions (Rani, Sharma & Sharma, "Performance comparison of various routing protocols in different mobility models," IJASUC 3(4), 2012, arXiv:1209.5507: NS-2, 20 nodes, RPGM group-mobility model — which they describe as suited to "disaster management and other rescue operations" — AODV had the highest delivery ratio and lowest routing load vs OLSR/DSDV; OLSR had lower delay). Small, older study — "strongest" is not supported; "reasonable baseline" is. No swarm routing protocol anywhere has real-world disaster field testing — label as "simulation-proven academic technique we're adapting."
3. **Taskforce allocation** — Gerkey & Mataric's 2004 MRTA taxonomy (*IJRR* 23(9):939–954) classifies this problem as **ST-SR-IA** (single-task robots, single-robot tasks, instantaneous assignment) — the simplest, most tractable class. **Design tension, kept deliberately, not resolved away**: the textbook answer (Hungarian/Kuhn-Munkres algorithm, re-solved every replanning tick) assumes central connectivity to every unit — which contradicts this system's entire premise. Auction-based/market-based allocation (Dias et al. survey; Zlot's CMU thesis) is decentralized: units bid on nearby tasks from local information, no single point of failure. **Resolution: Hungarian algorithm when a unit has connectivity back to command; local auction-based allocation among mesh-connected units when it doesn't** — same degraded-mode philosophy as the rest of the spec, applied to task allocation.
4. **Simulation/demo approach** — skip NS-3/OMNeT++ (Saghir, "Comparative Study of Simulators for Vehicular Networks," arXiv:2403.00546, 2024, §4.2: for a SUMO-driven vehicular 802.11 scenario, OMNeT++ needed <8 h and ns-3 ~9.5 h of wall-clock to simulate 300 s; 400 s took ~13 h / ~17.5 h. That is one vehicular scenario on one machine, not a general law — but enough to rule them out for a live browser demo). Skip Mesa (visually weak without significant extra work). Build a custom lightweight browser canvas/D3 2D visualization: nodes forming links, routing paths animating, task reassignment visibly happening live when priorities change. This is what actually sells the concept — Kenil's own bar is "if I get the simulation correct people will definitely like it," so visual legibility is a real product requirement, not an afterthought.

### The real judge-panel review that shaped all of the above

Full 11-judge research (real people, real backgrounds — Sunny Bakhda/HoneyHive, Thibault Jaigu/Requesty, Sarah Sonje/Oracle, Rishabh Pandey/DoorDash, Mukesh Pareek/LunarTree, Kevin Sutardji/NAMI, Rishabh Mehan/Intuit, Ayush Dwivedi/Walmart, Varshika Gambhir/Google, Daniel Thiyagu/Meta, Harry Bairstow/inference.net) plus a sociologist lens and a skeptical-end-user lens (a district disaster coordinator: *"I already have the Red Cross and local knowledge — why would I trust strangers' app over what I already use?"*) produced the four non-negotiable rules in §1a and the honest-fallback design of every connector above. If a build agent needs the full persona detail (specific "devastating questions" per judge), it's preserved in the original `betterday` repo's chat history — ask Kenil, don't reinvent it.

**Sponsor/tooling stack** (carried over from the original hackathon research, still the right call): **inference.net** executes the LLM pipeline (extraction → narration), cheap at the high call-frequency this generates. **HoneyHive** traces the full multi-step agent trajectory (extraction → silence ranking → route planning → chat answer) — real observability, not a black box. Don't add a second LLM gateway/router on top (Requesty) — redundant with inference.net's execution role for a single-domain project like this.

---

## 3. Agent roster (proposed — confirm with Kenil before arming)

Smaller than the original 3-build-agent hackathon fleet, because this is one product with distinct layers, not three competing ideas.

| Agent | Role |
|---|---|
| **MON** | Supervisor. Watches heartbeats, diagnoses stalls, writes directives, arbitrates cross-agent dependencies. Same role as the original fleet's MON — it worked well. |
| **CORE** | Postgres + ClickHouse backend: the schema and materialized views in §2, plus the connector abstractions (HDX, Copernicus EMS, bitchat protocol ingestion). |
| **SWARM** | The swarm-intelligence layer: PSO relay placement, AntHocNet-inspired routing, Hungarian/auction task allocation, and the canvas/D3 visualization that makes it demoable. This is the highest-research-risk role — cite everything, verify before implementing. |
| **CHAT** | LibreChat deep integration: the tool contract, coordinator + field-adjacent interfaces, the system-prompt safety constraint enforcing Rule 1, inference.net + HoneyHive wiring. |
| **DESIGN** | Shared design system for whatever UI surfaces exist (coordinator dashboard, the swarm visualization page, LibreChat theming). The original fleet's design-system pattern (tokens + a real component library, idle-time research logged concretely) worked well — reuse it. |
| **RESEARCH** | Ongoing verification: sources real per-region connector data as new regions get added, verifies any new technical claim before it goes in the spec, periodically re-runs a brutal-review pass as the build evolves. This is the SCRAPE role's spirit, repurposed — no longer generating alternative ideas (the idea is committed), now protecting the "no invented facts" rule as the project grows. |

No Telegram/async-router role by default this time — the original fleet needed it for unattended overnight operation under a hard deadline; this project doesn't have that pressure. Easy to add back if Kenil wants unattended operation again.

---

## 4. Human-input queue (same format as the original project — anything needing Kenil's decision goes here, never blocks the whole run)

13:31 [DESIGN] first loop. Worktree ../darkspot-design (agent/design-system) at a511276. Shipped: packages/ui (@darkspot/ui) tokens — light+dark palettes reserving colour for evidence state (3 confidence tiers ○◐●, sequential silence ramp, hatched stale/unknown, amber conflict, magenta+stripe simulation), tokens.ts mirror for SWARM's canvas (sim.* colours, silenceStep()), design/tokens.md. Verified: tsc, build, scripts/check-contrast.mjs (110 WCAG pairs, both themes, all pass). No §5 deps on DESIGN yet. Next: ConfidenceTier / SimulationLabel / SilenceSwatch components + swarm legend frame; SWARM/CHAT: log what you need in §5 and it becomes my next unit.
```
### [OPEN|ANSWERED|TIMED-OUT] <short title> — raised by <agent> at <time>
Question: <the actual decision needed>
Reply:
13:31 [DESIGN] first loop. Worktree ../darkspot-design (agent/design-system) at a511276. Shipped: packages/ui (@darkspot/ui) tokens — light+dark palettes reserving colour for evidence state (3 confidence tiers ○◐●, sequential silence ramp, hatched stale/unknown, amber conflict, magenta+stripe simulation), tokens.ts mirror for SWARM's canvas (sim.* colours, silenceStep()), design/tokens.md. Verified: tsc, build, scripts/check-contrast.mjs (110 WCAG pairs, both themes, all pass). No §5 deps on DESIGN yet. Next: ConfidenceTier / SimulationLabel / SilenceSwatch components + swarm legend frame; SWARM/CHAT: log what you need in §5 and it becomes my next unit.
```

### [OPEN] Arm the rest of the roster? — raised by MON at 13:20
Question: §3 says the roster is "proposed — confirm with Kenil before arming." Only MON is running (root checkout, no worktrees, no agent branches). Arm CORE/SWARM/CHAT/DESIGN/RESEARCH as listed in AGENT_PROMPTS.md, a subset, or hold? MON will keep looping either way; until answered it does citation audits only.
Reply:


### [OPEN] Model + tracing keys for CHAT — raised by CHAT at 13:28
Question: No INFERENCE_API_KEY / ANTHROPIC_API_KEY / HONEYHIVE_API_KEY exist in the environment. The Rule 1 guard and its 18-prompt adversarial eval are built (apps/chat/guard on agent/chat), but the live-model half of the eval and the inference.net extraction path are honestly marked UNVERIFIED until a key lands. Which provider do you want funded first (inference.net per §2, or Anthropic as a stopgap), and should keys go in a gitignored .env at repo root? Not blocking: CHAT proceeds with the tool server + LibreChat compose in the meantime.
Reply:

### [ANSWERED] Local Docker vs. shared ClickHouse Cloud/Postgres instance — raised by Kenil (via Claude) at ~13:5x
Question: CORE stood up its own local `docker-compose.yml` (Postgres + ClickHouse) and already has 5 real commits against it (9-table schema, mesh_events, mv_silence_duration, HDX connector verified on 860 real Nepal admin units). Kenil also has a live ClickHouse Cloud + Postgres Cloud instance (originally provisioned for the `betterday` project). Should DarkSpot stay on local Docker or move to that cloud instance?
Reply: **Move to the cloud instance — same one betterday uses, but isolated as its own database on each service, not sharing tables.** Done so far by the supervising session (not CORE): (1) ClickHouse — `CREATE DATABASE IF NOT EXISTS darkspot` run and confirmed via `SHOW DATABASES` on the live `betterday-clickhouse` instance. (2) `D:\hackathons\darkspot\.env` written (gitignored) with `CLICKHOUSE_URL`/`CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD`/`CLICKHOUSE_DB=darkspot` — live-verified working via curl. (3) Postgres — `DATABASE_URL` written pointing at a `darkspot` database on the same `betterday-postgres` server, but **that database does not exist yet** — creating it requires a live connection, and the supervising session hit an unresolved TLS certificate-chain issue (the server's cert is signed by a private "Ubicloud" root CA it doesn't fully present in-chain; `node --use-system-ca` did not fix it, and disabling cert verification to force a test through was deliberately not done). See D-6 below for what CORE should try.

## 5a. Directives (MON → agents; newest on top, each one says who/what/why)

**Standing directives (apply from first loop):**
- **D-1 (all build agents):** Work ONLY in your own worktree (`../darkspot-<role>`, branch `agent/<role>`). Never `rebase`, `checkout`, or `reset` in the root `D:\hackathons\darkspot` checkout — the root is MON's and the shared COORDINATION.md lives there. Edit COORDINATION.md by absolute path from your worktree, commit it on `main` with `-c user.name="Agent <ROLE>"`, and if `main` moved, `git pull --rebase` only your own branch. (Why: the betterday fleet lost time to a root-checkout mid-rebase incident, commit 13eeccd there.)
- **D-2 (all):** Every commit message or §9 entry that states a technical fact, dataset, or algorithm behavior carries its citation inline (paper + venue + year, or URL). No citation → MON flags it here and the claim is treated as unverified until RESEARCH clears it.
- **D-3 (CORE):** `escalations.authorized_by` is `NOT NULL` with a FK to a real reviewer identity, and `drone_routes_simulated.is_simulation` is `BOOLEAN NOT NULL DEFAULT true CHECK (is_simulation)` — a schema-level guarantee, not a default that can be flipped. Nothing in any schema may be named or shaped like a dispatch/assignment order (Rules 1, 2, 4).
- **D-4 (SWARM, CHAT):** No LLM call may sit on the code path of silence-ranking, routing, or allocation (Rule 3). If a narration layer is added, it consumes a finished result; it never gates one.
- **D-5 (RESEARCH, first unit when armed):** Clear the citation audit below before anything else — these are claims already in this file that are stated as fact without a checkable source.

**Citation audit of COORDINATION.md §2 (MON, 13:20) — stated as fact, not yet checkable:**
| # | Claim (§2) | Status |
|---|---|---|
| C1 | (as above) | **CLEARED** — Wang et al., *Drones* 10(5):355, **2026** (not 2025), doi:10.3390/drones10050355. §2 corrected. |
| C2 | (as above) | **CLEARED** — Saghir, arXiv:2403.00546 (2024) §4.2: ns-3 ~9.5 h / OMNeT++ <8 h for 300 s, vehicular scenario. §2 corrected to say exactly that. |
| C3 | (as above) | **CLEARED** — Lin, *Information Sciences* 232:294–308, 2013, doi:10.1016/j.ins.2012.12.023 (crossref-confirmed). §2 corrected. |
| C4 | (as above) | **DOWNGRADED** — Rani/Sharma/Sharma 2012 (arXiv:1209.5507) supports "reasonable baseline under RPGM," not "strongest." §2 reworded. |
| C5 | (as above) | **WITHDRAWN** — no Kwak & Sung *Sensors* 2021 paper found (3 searches). Real disaster drone-ferry precedent substituted: Ojetunde/Ano/Sakano, *Appl. Sci.* 12(13):6547, 2022 — and it does NOT clearly document live flights. §2 corrected. |
| C6 | (as above) | **CLEARED** — USFS "If You Fly, We Can't" page with 2018/2019 incursion + suspension counts; DroneLife 2026-08-26 for 2026 count. §1a Rule 4 now cites it. |
| C7 | (as above) | **CLEARED (wording adjusted)** — NAMI Board resolution 30 May 2026 read in full; says AI should not substitute for crisis support. §1a Rule 2 now quotes it. |
| — | AntHocNet, Gerkey & Matarić, Zhao/Ammar, bitchat, HDX COD, Copernicus EMS | **ALL CONFIRMED** 2026-08-28 (crossref/primary pages): AntHocNet journal version is ETT 16(5) **2005** (tech report 2004); Gerkey & Matarić IJRR 23(9):939–954 2004 doi:10.1177/0278364904045564; Zhao/Ammar/Zegura MobiHoc'04 pp.187–198; bitchat is **Unlicense (public domain)**, not MIT — §2 corrected; COD guidelines 2010 + Copernicus access rules quoted in §2. |

---

## 5. Dependency graph

- CHAT → CORE: the three coordinator tools (get_priority_ranking, get_conflicts, get_route_plan) read `mv_priority_rank`, `mv_conflicts`, `mv_corroboration`, `mv_staleness`, `mesh_events` (ClickHouse) and `drone_routes_simulated`, `access_roles`, `escalations` (Postgres). Need the actual DDL/column names before the tools can return real rows; until then the tools fail closed with "view not available" — no fake rows. Also need CORE’s access_roles shape to gate casualty/exact-location/urgency fields (§1a Rule 2) — CHAT will not expose those fields until the role check exists.
- SWARM → CORE: need the concrete column list of `drone_routes_simulated` (Postgres) so `swarm/` can emit rows in exactly that shape (currently emitting `{route_id, waypoints[], relay_positions[], is_simulation: true}` as a JSON export — will adapt once the DDL lands). Not blocking: SWARM builds against synthetic seeded scenarios until CORE's `admin_units` + `mv_priority_rank` exist to visualize real settlement data.

---

## 6. Decision log (append-only, newest on top)

`<time> — <agent> — <what was decided> — why`

13:31 — DESIGN — Colour is reserved for evidence state, not brand: verdant green = human-verified ONLY (no success toasts/buttons), ember red = hazard exposure/destructive ONLY, magenta + diagonal stripe = simulation ONLY (Rule 4, two carriers so it survives colour-blindness/greyscale), dusk indigo ramp = silence duration (sequential, luminance-ordered). Interactive = teal 'beacon'. Any agent building UI outside @darkspot/ui must keep these reservations. — why: a coordinator must never misread confidence/silence/simulation; brand-coloured 'success' would dilute the one green that matters.

13:45 — RESEARCH — D-5 citation audit C1–C7 cleared; two claims in §2 were wrong and are corrected in place — (1) **C5 "Kwak & Sung, *Sensors* 2021, real drone flight experiments" does not exist** as far as three independent searches can find; withdrawn and replaced with Ojetunde/Ano/Sakano *Appl. Sci.* 2022, which is real but does not clearly document live flights — so the spec now has **no** citation claiming real disaster drone-ferry flight trials; anyone pitching "field-proven" ferrying is overstating. (2) **C1 is a 2026 paper, not 2025**, and its own abstract flags "pending hardware-in-the-loop and field validation." Also corrected: bitchat license is Unlicense not MIT; AntHocNet journal version is 2005; C4 "strongest baseline" downgraded to "reasonable baseline" (one 20-node NS-2 study, 2012). Rules 2 and 4 now carry primary sources (NAMI 30 May 2026 resolution; USFS incursion counts). Method: WebSearch + WebFetch of primary pages, crossref API for every DOI, pdftotext on the papers themselves for exact quotes — no claim was accepted from a search snippet alone. Lesson for all agents: two of seven "verified" claims from the original session were wrong or misattributed, so **"verified in the original conversation" is not a citation.**

*(this session, ~11:3x)* — Kenil (via Claude) — Fresh repo created at `D:\hackathons\darkspot`, `git init -b main`. The original `betterday` repo and all its worktrees (Caseload/Bridge/NextStep + design system) are left completely untouched as historical record — nothing deleted, nothing merged. This file ports the full DarkSpot spec (product rules, architecture, swarm-intelligence research, judge-panel findings) developed in direct conversation, so no agent arming into this repo needs the original chat history to get started.

---

## 7. Idle behavior

In priority order:
1. Verify something real — re-run tests/build against your own or another agent's last commit.
2. If a technical claim anywhere in this file or your own recent work isn't yet backed by a real citation, go find one or flag it for removal — this project's credibility depends on this more than speed.
3. If UI-adjacent: real design research, logged with 2-3 concrete takeaways (not vibes) to `/design/inspiration.md`.
4. If genuinely nothing: log `sleeping — no actionable work` and wait for the next heartbeat. Do not exit.

---

## 8. Deploy map

| Component | Service | Live URL | Status |
|---|---|---|---|
| — | — | — | not yet deployed |

---

## 9. Heartbeat log (append-only)

13:31 [DESIGN] first loop. Worktree ../darkspot-design (agent/design-system) at a511276. Shipped: packages/ui (@darkspot/ui) tokens — light+dark palettes reserving colour for evidence state (3 confidence tiers ○◐●, sequential silence ramp, hatched stale/unknown, amber conflict, magenta+stripe simulation), tokens.ts mirror for SWARM's canvas (sim.* colours, silenceStep()), design/tokens.md. Verified: tsc, build, scripts/check-contrast.mjs (110 WCAG pairs, both themes, all pass). No §5 deps on DESIGN yet. Next: ConfidenceTier / SimulationLabel / SilenceSwatch components + swarm legend frame; SWARM/CHAT: log what you need in §5 and it becomes my next unit.
```
13:20 [MON] first loop. Only MON armed (root at aeaba29, no worktrees/branches). Added §5a standing directives D-1..D-5 + citation audit C1–C7 of §2; raised §4 item to Kenil on arming the roster. No other heartbeats to diagnose. Next check ~13:30.
13:45 [RESEARCH] first loop. D-5 done: C1–C7 all resolved (5 cleared w/ full citations, 1 downgraded, 1 withdrawn as unfindable — see §6). §2/§1a corrected in place, §5a table updated. Next: sleep 600, re-read; next unit = verify the still-uncited LibreChat/inference.net/HoneyHive tooling claims in §2, unless CORE/SWARM commits appear.
13:28 [CHAT] first loop. Worktree ../darkspot-chat (agent/chat) at 4a0bb09. Shipped: Rule 1 guard (deterministic imperative/directive detector, zero-LLM per D-4/Rule 3) + system prompt + 18-prompt adversarial eval; 6/6 guard tests pass (node --test apps/chat/guard). Live-model eval layer = UNVERIFIED (no key) and the committed eval-report.json says so. Logged §5 dep on CORE views and §4 key question. Next: LibreChat compose + MCP tool server that fails closed until CORE views exist.
13:31 [DESIGN] first loop. Worktree ../darkspot-design (agent/design-system) at a511276. Shipped: packages/ui (@darkspot/ui) tokens — light+dark palettes reserving colour for evidence state (3 confidence tiers ○◐●, sequential silence ramp, hatched stale/unknown, amber conflict, magenta+stripe simulation), tokens.ts mirror for SWARM's canvas (sim.* colours, silenceStep()), design/tokens.md. Verified: tsc, build, scripts/check-contrast.mjs (110 WCAG pairs, both themes, all pass). No §5 deps on DESIGN yet. Next: ConfidenceTier / SimulationLabel / SilenceSwatch components + swarm legend frame; SWARM/CHAT: log what you need in §5 and it becomes my next unit.
```
