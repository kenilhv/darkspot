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
2. **No field marked casualty count, exact rescue location, or urgency tier becomes actionable without a named, authorized human sign-off.** The `escalations` table requires a non-null `authorized_by` — this is a schema constraint, not a UI suggestion. (Why: mirrors NAMI's own public stance that AI must never make crisis determinations — verified, not assumed, during the judge-panel review.)
3. **The safety-critical core (silence-ranking, routing, task allocation) runs with zero LLM dependency.** The LLM only narrates on top of a result that already exists without it. (Why: "the model provider is down" can never be a reason the core stops working — this was the sharpest question in the judge review, from Requesty's Thibault Jaigu.)
4. **Any UAV/drone routing output is a labeled simulation (`is_simulation = true`) until formally deconflicted with real airspace authority.** No pitch, demo, or line of code implies a drone is actually flying without that integration existing. (Why: uncoordinated drones are a documented real hazard to manned search-and-rescue aircraft — this was the single highest-severity gap found in review, and it's the easiest one to accidentally overstate because it's the "coolest" part.)

**The honest framing to hold onto throughout:** this stays a prototype until a real authorized partner org, airspace integration, and field validation exist. The goal is never to claim "this saves lives today" — it's to build something that could responsibly get there.

---

## 2. What DarkSpot is (full spec, ported from the original research session)

**Core insight:** Existing disaster dashboards rank by where reports are loudest. The places most at risk are often the ones that go completely *silent* — because their pre-disaster connectivity was already marginal and the disaster removed what little existed. Nobody ranks silence as a first-class signal. DarkSpot does.

**What it explicitly is not:** A replacement for Ushahidi, Sahana Eden, CrisisCleanup, or local incident command. Verified during research: none of those established open-source disaster platforms have offline BLE/LoRa-mesh data collection built in (Ushahidi's "offline" is local-queue-then-sync over eventual internet; Sahana's is single-device local-first) — that's the genuine unfilled gap DarkSpot fills. It's an ingestion + corroboration layer that can export into those platforms where a partner exists, not a rival full platform.

### Pluggable connectors (region/disaster-agnostic — nothing hardcoded to one country)

| Connector | Real source | Honest fallback when unavailable |
|---|---|---|
| Admin unit + population | HDX COD-AB + COD-PS per country (verified: official OCHA program, required "in all disaster-prone countries," not a Nepal one-off) | Coarser admin level rather than guessing finer granularity |
| Hazard exposure | Any live Copernicus EMS activation for the event (verified: general-purpose, any disaster type, any eligible country — *requesting* a new activation needs an authorized government/UN/humanitarian-org partner, but *consuming* an already-activated product is public) | `hazard_exposure = unknown`, never assumed |
| Mesh transport | bitchat protocol (`github.com/permissionlesstech/bitchat`, MIT/public-domain, whitepaper itself public domain — legally forkable) | — was never region-specific |
| UAV message-ferrying | Grounded in real DTN research: Zhao/Ammar "Message Ferrying," MobiHoc 2004; disaster-specific precedent: Kwak & Sung, *Sensors* 2021 (real drone flight experiments) | Simulation-only per Rule 4 until airspace-deconflicted |
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

1. **Mesh formation** — swarm-intelligence-inspired relay placement. PSO-driven relay placement (real citable formulation: PSO for facility-location/mesh-router placement). Real research exists (ACO/PSO for mesh topology; UAV-swarm coverage papers, e.g. MDPI *Drones* 2025 reporting ~92% simulated area coverage) but it's simulation-stage academic work, not deployed tech — cite as "swarm-intelligence-inspired," never "proven self-organizing mesh."
2. **Adaptive signal routing** — AntHocNet (Di Caro/Ducatelle/Gambardella, 2004): ant-agent pheromone-style path reinforcement, beats AODV on delay/delivery ratio in simulation. AODV itself is the strongest traditional baseline under disaster-like high-mobility conditions. No swarm routing protocol anywhere has real-world disaster field testing — label as "simulation-proven academic technique we're adapting."
3. **Taskforce allocation** — Gerkey & Mataric's 2004 MRTA taxonomy (*IJRR* 23(9):939–954) classifies this problem as **ST-SR-IA** (single-task robots, single-robot tasks, instantaneous assignment) — the simplest, most tractable class. **Design tension, kept deliberately, not resolved away**: the textbook answer (Hungarian/Kuhn-Munkres algorithm, re-solved every replanning tick) assumes central connectivity to every unit — which contradicts this system's entire premise. Auction-based/market-based allocation (Dias et al. survey; Zlot's CMU thesis) is decentralized: units bid on nearby tasks from local information, no single point of failure. **Resolution: Hungarian algorithm when a unit has connectivity back to command; local auction-based allocation among mesh-connected units when it doesn't** — same degraded-mode philosophy as the rest of the spec, applied to task allocation.
4. **Simulation/demo approach** — skip NS-3/OMNeT++ (one comparison needed ~8h wall-clock to simulate 300 seconds of activity, not viable). Skip Mesa (visually weak without significant extra work). Build a custom lightweight browser canvas/D3 2D visualization: nodes forming links, routing paths animating, task reassignment visibly happening live when priorities change. This is what actually sells the concept — Kenil's own bar is "if I get the simulation correct people will definitely like it," so visual legibility is a real product requirement, not an afterthought.

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

```
### [OPEN|ANSWERED|TIMED-OUT] <short title> — raised by <agent> at <time>
Question: <the actual decision needed>
Reply:
```

*(empty — first agent to hit a real decision point logs it here)*

---

## 5. Dependency graph

*(empty — agents add/remove lines here as cross-agent dependencies form/resolve)*

---

## 6. Decision log (append-only, newest on top)

`<time> — <agent> — <what was decided> — why`

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

```
<time> [MON] ...
13:21 [CORE] armed in worktree ../darkspot-core (agent/core). docker-compose.yml up: Postgres 16 wal_level=logical on :5433, ClickHouse 25.3 on :8124/:9001 (offset so betterday stack can coexist). Next: Postgres schema §2.
```
