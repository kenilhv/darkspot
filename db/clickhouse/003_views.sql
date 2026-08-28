-- The other four analytical views (COORDINATION.md §2). Naming, honestly:
--   mv_corroboration, mv_staleness  — true incremental MATERIALIZED VIEWs into AggregatingMergeTree state,
--                                     read through the plain views `corroboration` / `staleness`.
--   priority_rank, conflicts        — query-time views. They depend on now() (silence clocks, staleness
--                                     windows) and on Postgres human-authority tables, which an insert-driven
--                                     MV cannot re-evaluate; "recomputed continuously" = recomputed per query.

-- ===========================================================================
-- mv_corroboration — counts DISTINCT DEVICE IDENTITIES, never message count.
-- One phone re-sending the same thing 50 times is still one source.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS darkspot.corroboration_state
(
    disaster_event_id  UUID,
    settlement_pcode   LowCardinality(String),
    extracted_status   LowCardinality(String),
    distinct_devices   AggregateFunction(uniqExact, FixedString(32)),
    message_count      AggregateFunction(count, UInt64),
    first_seen         AggregateFunction(min, DateTime64(3, 'UTC')),
    last_seen          AggregateFunction(max, DateTime64(3, 'UTC'))
)
ENGINE = AggregatingMergeTree
PARTITION BY disaster_event_id
ORDER BY (disaster_event_id, settlement_pcode, extracted_status);

CREATE MATERIALIZED VIEW IF NOT EXISTS darkspot.mv_corroboration
TO darkspot.corroboration_state
AS SELECT
    disaster_event_id, settlement_pcode, extracted_status,
    uniqExactState(device_pubkey) AS distinct_devices,
    countState()                  AS message_count,
    minState(received_at)         AS first_seen,
    maxState(received_at)         AS last_seen
FROM darkspot.mesh_events
GROUP BY disaster_event_id, settlement_pcode, extracted_status;

-- Confidence tiers surfaced explicitly, never collapsed into one number.
CREATE VIEW IF NOT EXISTS darkspot.corroboration AS
WITH human AS (
    SELECT m.disaster_event_id AS disaster_event_id, m.settlement_pcode AS settlement_pcode,
           m.extracted_status AS extracted_status, count() AS confirmed_reviews
    FROM darkspot.pg_reports_human_review r
    INNER JOIN darkspot.mesh_events m ON m.id = r.mesh_event_id
    WHERE r.decision = 'confirmed'
    GROUP BY 1, 2, 3
)
SELECT
    s.disaster_event_id, s.settlement_pcode, s.extracted_status,
    uniqExactMerge(s.distinct_devices) AS distinct_devices,
    countMerge(s.message_count)        AS message_count,
    minMerge(s.first_seen)             AS first_seen,
    maxMerge(s.last_seen)              AS last_seen,
    any(h.confirmed_reviews)           AS confirmed_reviews,
    multiIf(any(h.confirmed_reviews) > 0,                'human-verified',
            uniqExactMerge(s.distinct_devices) >= 2,     'corroborated-multi-source',
                                                         'unverified-single-source') AS confidence_tier
FROM darkspot.corroboration_state s
LEFT JOIN human h ON h.disaster_event_id = s.disaster_event_id AND h.settlement_pcode = s.settlement_pcode AND h.extracted_status = s.extracted_status
GROUP BY s.disaster_event_id, s.settlement_pcode, s.extracted_status;

-- ===========================================================================
-- mv_staleness — latest known status per settlement; decays to
-- 'unknown, needs re-verification' past the event's staleness window.
-- Stale data trusted as current is more dangerous than no data.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS darkspot.staleness_state
(
    disaster_event_id  UUID,
    settlement_pcode   LowCardinality(String),
    latest_status      AggregateFunction(argMax, LowCardinality(String), DateTime64(3, 'UTC')),
    latest_event_id    AggregateFunction(argMax, UUID, DateTime64(3, 'UTC')),
    latest_at          AggregateFunction(max, DateTime64(3, 'UTC'))
)
ENGINE = AggregatingMergeTree
PARTITION BY disaster_event_id
ORDER BY (disaster_event_id, settlement_pcode);

CREATE MATERIALIZED VIEW IF NOT EXISTS darkspot.mv_staleness
TO darkspot.staleness_state
AS SELECT
    disaster_event_id, settlement_pcode,
    argMaxState(extracted_status, received_at) AS latest_status,
    argMaxState(id, received_at)               AS latest_event_id,
    maxState(received_at)                      AS latest_at
FROM darkspot.mesh_events
WHERE extracted_status != 'unextracted'
GROUP BY disaster_event_id, settlement_pcode;

CREATE VIEW IF NOT EXISTS darkspot.staleness AS
SELECT
    st.disaster_event_id, st.settlement_pcode,
    argMaxMerge(st.latest_status)  AS latest_status,
    argMaxMerge(st.latest_event_id) AS latest_mesh_event_id,
    maxMerge(st.latest_at)         AS latest_at,
    any(e.staleness_window_hours)  AS window_hours,
    dateDiff('second', maxMerge(st.latest_at), now64(3, 'UTC')) AS age_seconds,
    dateDiff('second', maxMerge(st.latest_at), now64(3, 'UTC')) > any(e.staleness_window_hours) * 3600 AS is_stale,
    if(dateDiff('second', maxMerge(st.latest_at), now64(3, 'UTC')) > any(e.staleness_window_hours) * 3600,
       'unknown, needs re-verification', argMaxMerge(st.latest_status)) AS effective_status
FROM darkspot.staleness_state st
INNER JOIN darkspot.pg_disaster_events e ON e.id = st.disaster_event_id
GROUP BY st.disaster_event_id, st.settlement_pcode;

-- ===========================================================================
-- conflicts — disagreeing reports shown SIDE BY SIDE, never silently resolved.
-- A conflict = within the staleness window, >= 2 distinct devices gave
-- different extracted statuses for the same settlement. Raw text travels with it.
-- ===========================================================================
CREATE VIEW IF NOT EXISTS darkspot.conflicts AS
SELECT
    m.disaster_event_id, m.settlement_pcode,
    uniqExact(m.extracted_status) AS distinct_statuses,
    uniqExact(m.device_pubkey)    AS distinct_devices,
    arraySort(x -> x.3, groupArray((m.extracted_status, hex(m.device_pubkey), m.received_at, m.raw_text, m.id))) AS reports_side_by_side
FROM darkspot.mesh_events m
INNER JOIN darkspot.pg_disaster_events e ON e.id = m.disaster_event_id
WHERE m.extracted_status != 'unextracted'
  AND m.received_at >= now64(3, 'UTC') - toIntervalHour(e.staleness_window_hours)
GROUP BY m.disaster_event_id, m.settlement_pcode
HAVING distinct_statuses > 1 AND distinct_devices > 1;

-- ===========================================================================
-- priority_rank — silence × population × hazard exposure.
-- Population honesty: finest units may have no published figure (COD-PS stops
-- at a coarser level). Then the PARENT unit's figure is used and labelled
-- population_basis = 'parent'; if none, score is NULL and the row ranks last
-- but stays visible. hazard 'unknown' gets neutral weight 1 and is flagged —
-- it is never treated as low.
-- ===========================================================================
CREATE VIEW IF NOT EXISTS darkspot.priority_rank AS
WITH parent_pop AS (
    SELECT country_iso3, pcode, population FROM darkspot.pg_admin_units
)
SELECT
    sd.disaster_event_id AS disaster_event_id, sd.admin_unit_id AS admin_unit_id, sd.settlement_pcode AS settlement_pcode,
    sd.settlement_name AS settlement_name, sd.granularity_level AS granularity_level,
    sd.never_heard AS never_heard, sd.report_count AS report_count, sd.last_report_at AS last_report_at,
    sd.seconds_since_any_report / 3600.0                       AS silence_hours,
    coalesce(sd.population, pp.population)                     AS population_used,
    multiIf(sd.population IS NOT NULL, 'unit', pp.population IS NOT NULL, 'parent', 'none') AS population_basis,
    sd.hazard_exposure AS hazard_exposure,
    sd.hazard_kind AS hazard_kind, sd.hazard_source_org AS hazard_source_org, sd.hazard_source_licence AS hazard_source_licence,
    sd.hazard_exposure = 'unknown'                             AS hazard_unknown,
    multiIf(sd.hazard_exposure = 'high', 3, sd.hazard_exposure = 'medium', 2, 1) AS hazard_weight,
    (sd.seconds_since_any_report / 3600.0) * coalesce(sd.population, pp.population)
        * multiIf(sd.hazard_exposure = 'high', 3, sd.hazard_exposure = 'medium', 2, 1) AS priority_score,
    row_number() OVER (PARTITION BY sd.disaster_event_id ORDER BY priority_score DESC NULLS LAST, sd.settlement_pcode) AS rank
FROM darkspot.silence_duration sd
INNER JOIN darkspot.pg_admin_units au ON au.id = sd.admin_unit_id
LEFT JOIN parent_pop pp ON pp.country_iso3 = au.country_iso3 AND pp.pcode = au.parent_pcode;
