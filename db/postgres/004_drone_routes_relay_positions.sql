-- SWARM asked (§5) where relay positions go. Own column, not folded into waypoints: a relay position is a
-- proposed mesh-node placement (PSO output), a waypoint is a ferry path step — different things, kept legible.
-- Still a simulation row (Rule 4): the table-level CHECK is_simulation = true applies to every column here.
ALTER TABLE drone_routes_simulated
  ADD COLUMN relay_positions jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{lat, lon, admin_unit_id?, label?}]
  ADD COLUMN route_id text,                                        -- SWARM's own run/route identifier, for traceability
  ADD CONSTRAINT drone_routes_relay_positions_is_array CHECK (jsonb_typeof(relay_positions) = 'array'),
  ADD CONSTRAINT drone_routes_waypoints_is_array       CHECK (jsonb_typeof(waypoints) = 'array');
