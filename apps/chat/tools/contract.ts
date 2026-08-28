/**
 * Column contract the coordinator tools expect from CORE's schema (§2).
 * This is the concrete ask to CORE (§5). Tools DESCRIBE each view at call
 * time and fail closed if a required column is missing — they never
 * substitute or guess a column.
 *
 * Restricted fields (§1a Rule 2 / CHAT hard rule): never emitted to a viewer
 * until CORE's access_roles gate exists AND the caller is a verified responder.
 * Until then every tool runs in aggregate-only mode unconditionally.
 */
export const RESTRICTED_FIELDS = ["casualty_count", "exact_location", "urgency_tier", "rescue_location"] as const;

export const CONTRACT = {
  clickhouse: {
    mesh_events: ["id", "disaster_event_id", "device_pubkey", "raw_text", "received_at", "settlement_geohash"],
    mv_priority_rank: ["disaster_event_id", "settlement_geohash", "settlement_name", "rank", "silence_hours", "population", "hazard_exposure"],
    mv_conflicts: ["disaster_event_id", "settlement_geohash", "field", "value_a", "event_id_a", "value_b", "event_id_b"],
    mv_corroboration: ["disaster_event_id", "settlement_geohash", "distinct_devices", "confidence_tier"],
    mv_staleness: ["disaster_event_id", "settlement_geohash", "is_stale", "last_confirmation_at"],
  },
  postgres: {
    drone_routes_simulated: ["id", "disaster_event_id", "is_simulation", "waypoints", "relay_positions", "created_at"],
    access_roles: ["id", "principal", "role"],
    escalations: ["id", "authorized_by"],
  },
} as const;

export type ChView = keyof typeof CONTRACT.clickhouse;
export type PgTable = keyof typeof CONTRACT.postgres;
