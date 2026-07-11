-- ============================================================================
-- 012_tsi_source_key.sql
-- thestoneindustry: define source_key composto = [item_id, bundle(IDOne)].
-- Motivo: IDOne colide (162 linhas com "1"); item_id+IDOne é único (839/839).
-- Sem isso, o rastreio de movements colide. O worker passou a suportar
-- action.source_key (lista de colunas -> concatena com "|").
-- Idempotente. Faz também o backfill das linhas já coletadas.
-- ============================================================================

BEGIN;

-- 1) adiciona "source_key":["item_id","bundle"] na ação save_rows do scraper
UPDATE scrapers s
SET actions = rebuilt.new_actions, updated_at = now()
FROM (
  SELECT sc.id,
         jsonb_agg(
           CASE WHEN elem->>'type' = 'save_rows'
                THEN jsonb_set(elem, '{source_key}', '["item_id","bundle"]'::jsonb)
                ELSE elem END
           ORDER BY ord
         ) AS new_actions
  FROM scrapers sc,
       LATERAL jsonb_array_elements(sc.actions::jsonb) WITH ORDINALITY AS a(elem, ord)
  WHERE sc.name = 'thestoneindustry'
  GROUP BY sc.id
) rebuilt
WHERE s.id = rebuilt.id;

-- guard: garante que pegou
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM scrapers sc, jsonb_array_elements(sc.actions::jsonb) e
    WHERE sc.name = 'thestoneindustry' AND e->>'type' = 'save_rows' AND e ? 'source_key'
  ) THEN
    RAISE EXCEPTION 'source_key não aplicado no save_rows de thestoneindustry';
  END IF;
END $$;

-- 2) backfill das linhas já gravadas (source_key = item_id|bundle)
UPDATE slabs_history h
SET source_key = h.item_id::text || '|' || h.bundle
FROM scrapers s
WHERE s.id = h.scraper_id AND s.name = 'thestoneindustry'
  AND h.item_id IS NOT NULL AND h.bundle IS NOT NULL;

-- verificação
SELECT count(*) AS linhas, count(DISTINCT source_key) AS source_keys_distintos
FROM slabs_history h JOIN scrapers s ON s.id = h.scraper_id AND s.name = 'thestoneindustry';

COMMIT;
