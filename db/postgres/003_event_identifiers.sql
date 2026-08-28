-- Interoperable disaster identifiers (GLIDE is the cross-agency standard used by ReliefWeb/HDX/IFRC/GDACS).
ALTER TABLE disaster_events
  ADD COLUMN glide_number text CHECK (glide_number IS NULL OR glide_number ~ '^[A-Z]{2}-[0-9]{4}-[0-9]{6}-[A-Z]{3}$'),
  ADD COLUMN gdacs_id     text;
