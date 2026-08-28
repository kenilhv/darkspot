/**
 * Column contract the coordinator tools rely on — taken from CORE's actual DDL
 * (`git show agent/core:db/clickhouse/001_mesh_events.sql`, `003_views.sql`,
 * `db/postgres/001_schema.sql`), not from §2's prose. Tools DESCRIBE each object
 * at call time and fail closed if a required column is missing — they never
 * substitute or guess a column.
 *
 * Note CORE's naming: the *materialized* views are mv_* (write side); the
 * readable views are `priority_rank`, `conflicts`, `corroboration`, `staleness`.
 *
 * Restricted data (§1a Rule 2 / CHAT hard rule): casualty counts, exact rescue
 * locations, urgency tiers. In CORE's schema that is `mesh_events.extracted_people`
 * (a headcount; when paired with status 'casualties' it IS a casualty count) and
 * the `extracted_status = 'casualties'` value itself. Until an access_roles check
 * exists AND the caller is a verified responder, every tool runs aggregate-only:
 * `extracted_people` is never emitted and 'casualties' is rendered as a
 * restricted marker, never as a number.
 */
export const RESTRICTED_COLUMNS = ["extracted_people", "casualty_count", "exact_location", "urgency_tier", "rescue_location"] as const;
export const RESTRICTED_STATUS = "casualties";
export const RESTRICTED_STATUS_LABEL = "restricted (casualty-related; visible only via a signed-off escalation)";

export const CONTRACT = {
  clickhouse: {
    mesh_events: ["id", "disaster_event_id", "device_pubkey", "bridge_pubkey", "hop_count", "reported_at", "received_at", "settlement_pcode", "settlement_geohash", "raw_text", "extracted_status", "extracted_people", "extraction_model", "extraction_confidence"],
    // coverage_basis / hazard_kind / hazard_source_* landed with CORE's review-pass #1 (D-18/D-19, agent/core 9bdba96)
    priority_rank: ["disaster_event_id", "settlement_pcode", "settlement_name", "never_heard", "coverage_basis", "report_count", "last_report_at", "silence_hours", "population_used", "population_basis", "hazard_exposure", "hazard_kind", "hazard_source_org", "hazard_source_licence", "hazard_unknown", "rank"],
    corroboration: ["disaster_event_id", "settlement_pcode", "extracted_status", "distinct_devices", "distinct_trusted_devices", "trusted_corroboration", "message_count", "confidence_tier"],
    staleness: ["disaster_event_id", "settlement_pcode", "latest_status", "latest_mesh_event_id", "latest_at", "window_hours", "is_stale", "effective_status"],
    conflicts: ["disaster_event_id", "settlement_pcode", "distinct_statuses", "distinct_devices", "reports_side_by_side"],
    pg_disaster_events: ["id", "region", "activation_date"],
    pg_admin_units: ["pcode", "name", "country_iso3"],
  },
  postgres: {
    drone_routes_simulated: ["id", "disaster_event_id", "is_simulation", "algorithm", "fleet_size", "waypoints", "computed_at"],
    access_roles: ["id", "disaster_event_id", "principal", "level"],
    escalations: ["id", "authorized_by", "kind"],
  },
} as const;

export type ChView = keyof typeof CONTRACT.clickhouse;
export type PgTable = keyof typeof CONTRACT.postgres;
