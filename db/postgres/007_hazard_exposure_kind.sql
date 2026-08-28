-- RESEARCH review pass #1 (Copernicus note): a coordinator must see "landslide (Copernicus EMSR927)" vs
-- "flood extent (HOT, ODbL)" — not one undifferentiated 'high'. Carry what the observed-event polygon IS,
-- who published it, and under which licence.
ALTER TABLE hazard_exposure
  ADD COLUMN observed_event_kind text,    -- as the product states it: e.g. 'Landslide' (Copernicus obj_desc), 'Flood extent'
  ADD COLUMN source_org          text,    -- 'Copernicus EMS' | 'HOT' | 'UNOSAT' | ...
  ADD COLUMN source_licence      text,    -- e.g. 'Copernicus EMS (© European Union) — free public reuse with attribution' | 'ODbL'
  ADD CONSTRAINT hazard_exposure_high_needs_kind CHECK (level = 'unknown' OR observed_event_kind IS NOT NULL) NOT VALID;
-- NOT VALID so an existing deployment can backfill by re-running the connector, then: ALTER TABLE hazard_exposure VALIDATE CONSTRAINT hazard_exposure_high_needs_kind;
