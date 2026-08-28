-- Event-scoped hazard exposure per admin unit, filled by the Copernicus EMS connector (§2 connector table).
-- Honest fallback: 'unknown' — never assumed. mv_priority_rank must treat 'unknown' as unknown, not as 'low'.
CREATE TYPE hazard_level AS ENUM ('unknown', 'low', 'medium', 'high');

CREATE TABLE hazard_exposure (
  disaster_event_id  uuid NOT NULL REFERENCES disaster_events(id),
  admin_unit_id      uuid NOT NULL REFERENCES admin_units(id),
  level              hazard_level NOT NULL DEFAULT 'unknown',
  -- Provenance: which Copernicus EMS product said so. Required unless level = 'unknown'.
  ems_product_ref    text,                             -- e.g. 'EMSR927_01TRISHULI_DEL_PRODUCT_v1'
  source_url         text,
  source_retrieved   timestamptz,
  PRIMARY KEY (disaster_event_id, admin_unit_id),
  CONSTRAINT hazard_exposure_needs_source CHECK (
    level = 'unknown' OR (ems_product_ref IS NOT NULL AND source_url IS NOT NULL AND source_retrieved IS NOT NULL)
  )
);

-- Window after which a settlement's last known status decays back to 'unknown, needs re-verification' (mv_staleness).
-- A parameter chosen per deployment by the authorized org, not a claim about the world.
ALTER TABLE disaster_events
  ADD COLUMN staleness_window_hours integer NOT NULL DEFAULT 24 CHECK (staleness_window_hours > 0);
