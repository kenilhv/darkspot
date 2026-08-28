# DarkSpot CORE — backend (Postgres + ClickHouse + connectors)

Deterministic core. No LLM anywhere in this layer (product rule 3).

## Run

```sh
docker compose up -d --wait            # Postgres :5433 (wal_level=logical), ClickHouse :8124 http / :9001 native
pip install -r requirements.txt
python -m connectors.hdx_cod NPL       # admin units + population from HDX COD-AB / COD-PS (any ISO3)
python -m connectors.register_event --type glof --iso3 NPL --region "..." --date 2026-08-26 \
       --ems EMSR927 --glide FL-2026-000167-NPL --gdacs FL1104124      # prints event id
python -m connectors.copernicus_ems --event <id> \
       [--extra-extent <geojson url> --extra-ref "<citation>"]         # hazard exposure per admin unit
```

Schema is applied from `db/postgres/*.sql` and `db/clickhouse/*.sql` on first container init (`docker compose down -v` to re-init).

## Verify (always the last step)

```sh
sh scripts/verify_postgres_rules.sh         # §1a rules are constraints: bad rows rejected (7/7)
python scripts/verify_hdx_load.py NPL       # D-8: admin_units vs COD-AB/COD-PS source files, with HDX dates
python scripts/verify_clickhouse_views.py   # inserts labelled fixtures, checks all 5 views, drops them (18/18)
```

## What's where

| Layer | Object | Notes |
|---|---|---|
| Postgres | `disaster_events`, `admin_units`, `authorized_orgs`, `principals`, `devices`, `reports_human_review`, `escalations`, `access_roles`, `downstream_exports`, `drone_routes_simulated`, `hazard_exposure` | §2 tables; `escalations.authorized_by` NOT NULL + non-blank, `drone_routes_simulated` CHECK `is_simulation = true` (+ `relay_positions`/`route_id` for SWARM), `access_roles` keys on `principals.id` and a PII grant is trigger-checked against the granting org |
| ClickHouse | `mesh_events` | immutable MergeTree, raw_text kept next to extracted fields, partitioned per event |
| ClickHouse | `mv_silence_duration` → `silence_state` → view `silence_duration` | raw time-since-any-report and time-since-human-confirmed; never-heard settlements present with the clock running from activation |
| ClickHouse | `mv_corroboration` → `corroboration_state` → view `corroboration` | distinct device identities, tiers `unverified-single-source` / `corroborated-multi-source` / `human-verified` |
| ClickHouse | `mv_staleness` → `staleness_state` → view `staleness` | decays to `unknown, needs re-verification` past `disaster_events.staleness_window_hours` — **the default of 24 h is arbitrary (uncited); the authorized org sets it per deployment** |
| ClickHouse | view `conflicts` | disagreeing reports side by side with raw text |
| ClickHouse | view `priority_rank` | silence_hours × population × hazard_weight; `population_basis` and `hazard_unknown` flags are explicit |
| ClickHouse | `pg_*` | PostgreSQL-engine read-through tables (live, not copies) |

## Data provenance (Nepal launch case)

- Admin units: HDX `cod-ab-npl` (OCHA, last modified 2026-08-14) — 1/7/77/775 units at ADM0–3, official admin points for centroids.
- Population: HDX `cod-ps-npl` (2023 projections, ADM0–2 only). ADM3 rows have `population = NULL`; `priority_rank` uses the district figure and says so (`population_basis = 'parent'`).
- Event: GLIDE `FL-2026-000167-NPL` / `FF-2026-000162-NPL`, GDACS `FL1104124`, Copernicus `EMSR927` (HDX `npl-flood-emsr927`).
- Hazard: Copernicus EMSR927 AOI01/AOI02 GRA `observedEventA` polygons + HOT `hot_flood_npl` observed flood extent (27 Aug 2026). Intersecting units → `high`, all other in-scope units → `unknown`. Never `low` from absence of mapped water.
