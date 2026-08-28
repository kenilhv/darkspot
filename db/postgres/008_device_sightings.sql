-- RESEARCH review pass #1, finding 1 (HIGH): "silent 40 h" must never be confused with "DarkSpot has no
-- coverage there". Silence is only a signal where a device was known to exist. This table is the evidence
-- of coverage: one row per time a device was known to be somewhere.
CREATE TABLE device_sightings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_pubkey      bytea NOT NULL REFERENCES devices(pubkey),
  settlement_pcode   text,                             -- COD p-code if known
  geohash            text NOT NULL,
  seen_at            timestamptz NOT NULL,
  source             text NOT NULL CHECK (source IN (
    'mesh_report',            -- a report from this device carried this location (written by ingestion)
    'bridge_registration',    -- a bridge node's operator registered its position (named human)
    'pre_activation_survey'   -- a device was recorded at this place before the event (e.g. seeded relay inventory)
  )),
  recorded_by        text,                             -- named human for the two human-entered sources
  CONSTRAINT device_sightings_human_sources_named CHECK (source = 'mesh_report' OR recorded_by IS NOT NULL)
);
CREATE INDEX device_sightings_pcode_idx ON device_sightings (settlement_pcode, seen_at);
