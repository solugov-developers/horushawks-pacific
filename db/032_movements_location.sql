-- ============================================================================
-- 032_movements_location.sql
-- movements.location: praça da chapa no momento do movimento (cur para
-- added/changed, prev para removed), gravada pelo worker. Usada pelo mapa
-- (/map: arrived7d/removed7d por praça) sem lookup em slabs_history (1,8 s a
-- frio com 1,2 k movimentos). Backfill só de added/removed (os únicos que o
-- mapa usa); os demais kinds ficam NULL no histórico e preenchidos daqui em diante.
-- ============================================================================
ALTER TABLE movements ADD COLUMN IF NOT EXISTS location text;

UPDATE movements m
SET location = (
  SELECT sh.location FROM slabs_history sh
  WHERE sh.scraper_id = m.scraper_id AND sh.source_key = m.source_key
    AND sh.job_id = CASE WHEN m.kind = 'removed' THEN m.prev_job_id ELSE m.job_id END
  LIMIT 1
)
WHERE m.location IS NULL AND m.kind IN ('added', 'removed');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mov_kind_detected_loc
  ON movements (kind, detected_at DESC) INCLUDE (scraper_id, location, category_name);
ANALYZE movements;
