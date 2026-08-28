-- DarkSpot Postgres (OLTP) — canonical state, human authority only.
-- Spec: COORDINATION.md §2 "Postgres (OLTP)". Product rules §1a are enforced here as constraints, not UI suggestions.
-- Applied automatically by the postgres image on first init (docker-entrypoint-initdb.d).

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- disaster_events — one row per activation. Region/disaster-agnostic.
-- ---------------------------------------------------------------------------
CREATE TYPE disaster_type AS ENUM (
  'flood', 'glof', 'earthquake', 'wildfire', 'storm', 'landslide', 'volcanic', 'drought', 'other'
);

CREATE TABLE disaster_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type               disaster_type NOT NULL,
  country_iso3       char(3) NOT NULL,                 -- ISO 3166-1 alpha-3 (HDX COD key)
  region             text NOT NULL,                    -- free-text human label, e.g. 'Trishuli basin, Bagmati/Gandaki'
  activation_date    date NOT NULL,
  copernicus_ems_ref text,                             -- e.g. 'EMSR927' if an activation exists; NULL = none known
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT disaster_events_iso3_upper CHECK (country_iso3 = upper(country_iso3)),
  CONSTRAINT disaster_events_ems_ref_fmt CHECK (copernicus_ems_ref IS NULL OR copernicus_ems_ref ~ '^EMS[RN][0-9]{3,4}$')
);

-- ---------------------------------------------------------------------------
-- admin_units — settlement/ward/district, sourced per-region from HDX COD-AB
-- (+ COD-PS population). granularity_level is honest about resolution.
-- ---------------------------------------------------------------------------
CREATE TABLE admin_units (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso3       char(3) NOT NULL,
  granularity_level  smallint NOT NULL CHECK (granularity_level BETWEEN 0 AND 4),  -- COD admin level (0=country ... 4)
  pcode              text NOT NULL,                    -- HDX COD P-code, unique per country+level
  name               text NOT NULL,
  parent_pcode       text,
  population         integer CHECK (population IS NULL OR population >= 0),
  population_year    smallint,
  centroid_lat       double precision CHECK (centroid_lat IS NULL OR centroid_lat BETWEEN -90 AND 90),
  centroid_lon       double precision CHECK (centroid_lon IS NULL OR centroid_lon BETWEEN -180 AND 180),
  geohash            text,                             -- join key to ClickHouse mesh_events.settlement_geohash
  -- Provenance (ground rule: every number traces to a real source)
  source_dataset     text NOT NULL,                    -- HDX dataset slug, e.g. 'cod-ab-npl'
  source_url         text NOT NULL,
  source_retrieved   timestamptz NOT NULL,
  UNIQUE (country_iso3, granularity_level, pcode)
);
CREATE INDEX admin_units_parent_idx ON admin_units (country_iso3, parent_pcode);

-- ---------------------------------------------------------------------------
-- authorized_orgs — THE DEPLOYMENT GATE. No default org, no bypass.
-- A disaster_event with no authorized_org row is inert.
-- ---------------------------------------------------------------------------
CREATE TABLE authorized_orgs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  disaster_event_id  uuid NOT NULL REFERENCES disaster_events(id),
  org_name           text NOT NULL,
  org_type           text NOT NULL,                    -- 'red_cross_crescent' | 'eoc' | 'district_committee' | 'un' | 'ngo' | ...
  contact_name       text NOT NULL,
  contact_channel    text NOT NULL,                    -- how a human reaches them (phone/email/radio callsign)
  registered_by      text NOT NULL,                    -- named human who registered this org
  registered_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  UNIQUE (disaster_event_id, org_name)
);

-- ---------------------------------------------------------------------------
-- devices — mesh device pubkey registry (bitchat Noise-protocol static identity).
-- ---------------------------------------------------------------------------
CREATE TYPE trust_tier AS ENUM ('unknown', 'seen', 'vouched', 'responder');

CREATE TABLE devices (
  pubkey             bytea PRIMARY KEY,                -- Noise static public key (Curve25519, 32 bytes)
  first_seen         timestamptz NOT NULL DEFAULT now(),
  last_seen          timestamptz NOT NULL DEFAULT now(),
  trust              trust_tier NOT NULL DEFAULT 'unknown',
  trust_set_by       text,                             -- named human, required once trust > 'seen'
  label              text,
  CONSTRAINT devices_pubkey_len CHECK (octet_length(pubkey) = 32),
  CONSTRAINT devices_trust_needs_human CHECK (trust IN ('unknown','seen') OR trust_set_by IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- reports_human_review — every report a human has looked at.
-- mesh_event_id references the immutable ClickHouse row (no FK across stores).
-- ---------------------------------------------------------------------------
CREATE TYPE review_decision AS ENUM ('confirmed', 'rejected', 'needs_followup', 'duplicate');

CREATE TABLE reports_human_review (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  disaster_event_id  uuid NOT NULL REFERENCES disaster_events(id),
  mesh_event_id      uuid NOT NULL,
  reviewer           text NOT NULL,
  decision           review_decision NOT NULL,
  note               text,
  reviewed_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_human_review_event_idx ON reports_human_review (disaster_event_id, mesh_event_id);

-- ---------------------------------------------------------------------------
-- escalations — Rule 2: nothing marked casualty count / exact rescue location /
-- urgency tier becomes actionable without a NAMED, AUTHORIZED human sign-off.
-- Rule 1: there is deliberately no 'dispatch' / 'send_to' / 'assigned_unit'
-- column. An escalation is evidence handed to a human, never an instruction.
-- ---------------------------------------------------------------------------
CREATE TYPE escalation_kind AS ENUM ('casualty_count', 'rescue_location', 'urgency_tier');

CREATE TABLE escalations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  disaster_event_id  uuid NOT NULL REFERENCES disaster_events(id),
  admin_unit_id      uuid REFERENCES admin_units(id),
  kind               escalation_kind NOT NULL,
  evidence_mesh_event_ids uuid[] NOT NULL CHECK (cardinality(evidence_mesh_event_ids) > 0),
  summary            text NOT NULL,
  authorized_by      text NOT NULL,                    -- named human. NOT NULL is the rule, not a default.
  authorized_org_id  uuid NOT NULL REFERENCES authorized_orgs(id),
  authorized_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT escalations_authorized_by_nonblank CHECK (btrim(authorized_by) <> '')
);
CREATE INDEX escalations_event_idx ON escalations (disaster_event_id, authorized_at DESC);

-- ---------------------------------------------------------------------------
-- access_roles — aggregate-only by default; individual-level PII only for
-- verified responders (post-disaster targeting of vulnerable people is a
-- documented secondary harm).
-- ---------------------------------------------------------------------------
CREATE TYPE access_level AS ENUM ('aggregate_only', 'individual_pii');

CREATE TABLE access_roles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  disaster_event_id  uuid NOT NULL REFERENCES disaster_events(id),
  principal          text NOT NULL,                    -- user identifier (email/handle)
  level              access_level NOT NULL DEFAULT 'aggregate_only',
  granted_by         text,
  granted_org_id     uuid REFERENCES authorized_orgs(id),
  granted_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz,
  UNIQUE (disaster_event_id, principal),
  -- PII access must be granted by a named human of an authorized org.
  CONSTRAINT access_roles_pii_needs_grant CHECK (
    level = 'aggregate_only' OR (granted_by IS NOT NULL AND granted_org_id IS NOT NULL)
  )
);

-- ---------------------------------------------------------------------------
-- downstream_exports — what's been pushed to a partner platform, when, by whom.
-- ---------------------------------------------------------------------------
CREATE TYPE downstream_platform AS ENUM ('sahana_eden', 'ushahidi', 'crisiscleanup', 'other');

CREATE TABLE downstream_exports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  disaster_event_id  uuid NOT NULL REFERENCES disaster_events(id),
  platform           downstream_platform NOT NULL,
  platform_ref       text,                             -- id/URL of the record on the partner side
  review_ids         uuid[] NOT NULL CHECK (cardinality(review_ids) > 0), -- only human-reviewed evidence is exportable
  exported_by        text NOT NULL,
  exported_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- drone_routes_simulated — Rule 4: every row is a labeled simulation.
-- is_simulation is a column so consumers must read it, and a CHECK so it can
-- never be false until a real airspace-deconfliction integration exists.
-- ---------------------------------------------------------------------------
CREATE TABLE drone_routes_simulated (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  disaster_event_id  uuid NOT NULL REFERENCES disaster_events(id),
  is_simulation      boolean NOT NULL DEFAULT true,
  algorithm          text NOT NULL,                    -- e.g. 'message-ferry (Zhao & Ammar 2004)'
  fleet_size         smallint NOT NULL CHECK (fleet_size > 0),
  waypoints          jsonb NOT NULL,                   -- [{admin_unit_id, lat, lon, order}]
  computed_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drone_routes_are_simulated CHECK (is_simulation = true)
);
