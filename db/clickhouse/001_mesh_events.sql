-- DarkSpot ClickHouse (OLAP) — the analytical engine, scoped per disaster_event_id.
-- Spec: COORDINATION.md §2 "ClickHouse (OLAP)". Applied on first init (docker-entrypoint-initdb.d).
-- Everything is fully qualified with the `darkspot` database because the init runner does not set a default DB.

CREATE DATABASE IF NOT EXISTS darkspot;

-- ---------------------------------------------------------------------------
-- mesh_events — IMMUTABLE. One row per report-hop received at a bridge node.
-- Plain MergeTree (not Replacing/Collapsing): nothing here is ever updated or
-- deduplicated in place. Raw report text is never discarded. Extracted fields
-- sit NEXT TO raw text, never instead of it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS darkspot.mesh_events
(
    id                   UUID,
    disaster_event_id    UUID,
    -- bitchat identity: Noise static public key of the ORIGINATING device (32 bytes, Curve25519)
    device_pubkey        FixedString(32),
    -- bridge node (the device with backhaul that handed this to us) + hop count from bitchat packet TTL
    bridge_pubkey        FixedString(32),
    hop_count            UInt8,
    -- device-claimed time vs. bridge receive time. Both kept; device clocks are untrusted.
    reported_at          DateTime64(3, 'UTC'),
    received_at          DateTime64(3, 'UTC'),
    -- location as the device/reporter gave it: COD admin p-code at whatever granularity was known + geohash
    settlement_pcode     LowCardinality(String),
    settlement_geohash   String,
    -- raw report text — NEVER discarded
    raw_text             String,
    -- extracted fields (may be filled by the CHAT layer's extraction model; the CORE never depends on them being present)
    extracted_status     LowCardinality(String) DEFAULT 'unextracted',  -- 'unextracted' | 'safe' | 'needs_help' | 'casualties' | 'unknown'
    extracted_people     Nullable(UInt32),
    extraction_model     LowCardinality(String) DEFAULT '',
    extraction_confidence Nullable(Float32)
)
ENGINE = MergeTree
PARTITION BY disaster_event_id
ORDER BY (disaster_event_id, settlement_pcode, received_at, id);

-- ---------------------------------------------------------------------------
-- Read-through links to Postgres (canonical human-authority state).
-- These are NOT copies: every SELECT goes to Postgres. Credentials are the
-- local dev-compose ones; production supplies its own via named collections.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS darkspot.pg_disaster_events
(
    id                      UUID,
    type                    String,
    country_iso3            String,
    region                  String,
    activation_date         Date,
    copernicus_ems_ref      Nullable(String),
    staleness_window_hours  Int32
)
ENGINE = PostgreSQL('postgres:5432', 'darkspot', 'disaster_events', 'darkspot', 'darkspot');

CREATE TABLE IF NOT EXISTS darkspot.pg_admin_units
(
    id                 UUID,
    country_iso3       String,
    granularity_level  Int16,
    pcode              String,
    name               String,
    parent_pcode       Nullable(String),
    population         Nullable(Int32),
    population_year    Nullable(Int16),
    centroid_lat       Nullable(Float64),
    centroid_lon       Nullable(Float64),
    geohash            Nullable(String),
    source_dataset     String,
    source_url         String
)
ENGINE = PostgreSQL('postgres:5432', 'darkspot', 'admin_units', 'darkspot', 'darkspot');

CREATE TABLE IF NOT EXISTS darkspot.pg_hazard_exposure
(
    disaster_event_id  UUID,
    admin_unit_id      UUID,
    level              String,
    ems_product_ref    Nullable(String),
    observed_event_kind Nullable(String),
    source_org         Nullable(String),
    source_licence     Nullable(String)
)
ENGINE = PostgreSQL('postgres:5432', 'darkspot', 'hazard_exposure', 'darkspot', 'darkspot');

CREATE TABLE IF NOT EXISTS darkspot.pg_devices
(
    pubkey             String,        -- bytea arrives as text '\x..' via the PostgreSQL engine; compared with hex(FixedString)
    trust              String,
    first_seen         DateTime64(6, 'UTC'),
    last_seen          DateTime64(6, 'UTC')
)
ENGINE = PostgreSQL('postgres:5432', 'darkspot', 'devices', 'darkspot', 'darkspot');

CREATE TABLE IF NOT EXISTS darkspot.pg_device_sightings
(
    settlement_pcode   Nullable(String),
    seen_at            DateTime64(6, 'UTC'),
    source             String
)
ENGINE = PostgreSQL('postgres:5432', 'darkspot', 'device_sightings', 'darkspot', 'darkspot');

CREATE TABLE IF NOT EXISTS darkspot.pg_reports_human_review
(
    id                 UUID,
    disaster_event_id  UUID,
    mesh_event_id      UUID,
    reviewer           String,
    decision           String,
    reviewed_at        DateTime64(6, 'UTC')
)
ENGINE = PostgreSQL('postgres:5432', 'darkspot', 'reports_human_review', 'darkspot', 'darkspot');
