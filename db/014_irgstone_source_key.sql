-- ============================================================================
-- 014_irgstone_source_key.sql
-- irgstone: source_key = [item_id] (o id do produto WooCommerce, único).
-- Antes o source_key caía no serial_number, que na verdade é COR (White/Grey/
-- Black...) puxada de um atributo posicional -> colidia (516 únicos p/ 1235).
-- item_id é 100% preenchido e único, então backfillamos TODO o histórico.
-- Idempotente. Requer o worker com suporte a action.source_key (migration 012+).
-- ============================================================================

BEGIN;

-- 1) forward: adiciona "source_key":["item_id"] na ação save_rows (top-level)
UPDATE scrapers s
SET actions = rebuilt.new_actions, updated_at = now()
FROM (
  SELECT sc.id,
         jsonb_agg(
           CASE WHEN elem->>'type' = 'save_rows'
                THEN jsonb_set(elem, '{source_key}', '["item_id"]'::jsonb)
                ELSE elem END
           ORDER BY ord
         ) AS new_actions
  FROM scrapers sc,
       LATERAL jsonb_array_elements(sc.actions::jsonb) WITH ORDINALITY AS a(elem, ord)
  WHERE sc.name = 'irgstone'
  GROUP BY sc.id
) rebuilt
WHERE s.id = rebuilt.id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM scrapers sc, jsonb_array_elements(sc.actions::jsonb) e
    WHERE sc.name = 'irgstone' AND e->>'type' = 'save_rows' AND e ? 'source_key'
  ) THEN
    RAISE EXCEPTION 'source_key não aplicado no save_rows de irgstone';
  END IF;
END $$;

-- 2) backfill: source_key = item_id em TODO o histórico do irgstone
UPDATE slabs_history h
SET source_key = h.item_id::text
FROM scrapers s
WHERE s.id = h.scraper_id AND s.name = 'irgstone'
  AND h.item_id IS NOT NULL
  AND h.source_key IS DISTINCT FROM h.item_id::text;

-- verificação: no último snapshot, source_key deve ficar 100% único
WITH ult AS (SELECT max(job_id) j FROM slabs_history h JOIN scrapers s ON s.id=h.scraper_id AND s.name='irgstone')
SELECT count(*) AS linhas, count(DISTINCT source_key) AS source_keys_distintos
FROM slabs_history WHERE job_id = (SELECT j FROM ult);

COMMIT;
