-- Where a unit's centroid came from. COD-AB's adminpoints layer can lag the polygon layer by an admin
-- revision (BGD: points valid_on 2020-11-13 vs polygons 2023-05-21, different pcode scheme), so the
-- connector falls back to the polygon's representative point and says so.
ALTER TABLE admin_units
  ADD COLUMN centroid_source text
  CHECK (centroid_source IS NULL OR centroid_source IN ('cod-ab-adminpoints', 'cod-ab-polygon-representative-point'));
