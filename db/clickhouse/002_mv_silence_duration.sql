-- mv_silence_duration — the core insight of DarkSpot.
--
-- RAW time since the last signal, per settlement, per disaster event. Deliberately NOT an
-- anomaly score against a pre-disaster contact baseline: most target regions have no reliable
-- baseline to compare against, so an "anomaly" would claim precision we do not have.
--
-- Two raw clocks are exposed, never collapsed into one number:
--   seconds_since_any_report      — since ANY mesh report about this settlement reached a bridge
--   seconds_since_human_confirmed — since a named human marked a report about it 'confirmed'
-- A settlement with no report at all is the MOST important row, not a missing row: it appears
-- with never_heard = 1 and the clock counting from the event's activation date.

-- Incrementally-maintained state: last contact + report count per (event, settlement).
CREATE TABLE IF NOT EXISTS darkspot.silence_state
(
    disaster_event_id  UUID,
    settlement_pcode   LowCardinality(String),
    last_report_at     AggregateFunction(max, DateTime64(3, 'UTC')),
    first_report_at    AggregateFunction(min, DateTime64(3, 'UTC')),
    report_count       AggregateFunction(count, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY disaster_event_id
ORDER BY (disaster_event_id, settlement_pcode);

CREATE MATERIALIZED VIEW IF NOT EXISTS darkspot.mv_silence_duration
TO darkspot.silence_state
AS SELECT
    disaster_event_id,
    settlement_pcode,
    maxState(received_at)   AS last_report_at,
    minState(received_at)   AS first_report_at,
    countState()            AS report_count
FROM darkspot.mesh_events
GROUP BY disaster_event_id, settlement_pcode;

-- Queryable view. Scope = every admin unit with a hazard_exposure row for the event
-- (the Copernicus connector writes one per unit in the area of interest, level 'unknown' by default),
-- LEFT JOINed to reports so never-heard settlements are present.
CREATE VIEW IF NOT EXISTS darkspot.silence_duration AS
WITH
    reports AS (
        SELECT disaster_event_id, settlement_pcode,
               maxMerge(last_report_at) AS last_report_at,
               countMerge(report_count) AS report_count
        FROM darkspot.silence_state
        GROUP BY disaster_event_id, settlement_pcode
    ),
    confirmed AS (
        SELECT m.disaster_event_id AS disaster_event_id, m.settlement_pcode AS settlement_pcode, max(r.reviewed_at) AS last_confirmed_at
        FROM darkspot.pg_reports_human_review r
        INNER JOIN darkspot.mesh_events m ON m.id = r.mesh_event_id
        WHERE r.decision = 'confirmed'
        GROUP BY m.disaster_event_id, m.settlement_pcode
    )
SELECT
    e.id                                   AS disaster_event_id,
    au.id                                  AS admin_unit_id,
    au.pcode                               AS settlement_pcode,
    au.name                                AS settlement_name,
    au.granularity_level                   AS granularity_level,
    au.population                          AS population,
    h.level                                AS hazard_exposure,
    toDateTime64(e.activation_date, 3, 'UTC') AS activation_at,
    rp.report_count                        AS report_count,
    rp.report_count = 0                    AS never_heard,
    if(rp.report_count = 0, NULL, rp.last_report_at)           AS last_report_at,
    if(c.last_confirmed_at = toDateTime64(0, 6, 'UTC'), NULL, c.last_confirmed_at) AS last_human_confirmed_at,
    -- raw clocks (seconds). Clock starts at activation when nothing has been heard.
    dateDiff('second',
        if(rp.report_count = 0, toDateTime64(e.activation_date, 3, 'UTC'), rp.last_report_at),
        now64(3, 'UTC'))                   AS seconds_since_any_report,
    dateDiff('second',
        if(c.last_confirmed_at = toDateTime64(0, 6, 'UTC'), toDateTime64(e.activation_date, 6, 'UTC'), c.last_confirmed_at),
        now64(6, 'UTC'))                   AS seconds_since_human_confirmed
FROM darkspot.pg_hazard_exposure h
INNER JOIN darkspot.pg_disaster_events e ON e.id = h.disaster_event_id
INNER JOIN darkspot.pg_admin_units   au ON au.id = h.admin_unit_id
LEFT  JOIN reports   rp ON rp.disaster_event_id = e.id AND rp.settlement_pcode = au.pcode
LEFT  JOIN confirmed c  ON c.disaster_event_id  = e.id AND c.settlement_pcode  = au.pcode;
