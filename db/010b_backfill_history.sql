-- ============================================================================
-- 010b_backfill_history.sql  (one-time, NÃO entra no loop de migrations)
-- Preenche serial_number / category_name em slabs_history a partir do payload
-- JÁ coletado (nada de novo scrape). Corrige o relatório histórico, inclusive
-- o mês reclamado. NÃO altera source_key -> não mexe nos movements já gravados.
-- Idempotente: só toca linhas onde a coluna está NULL; NULLIF evita gravar "".
-- item_id continua NULL em vmcstone/zucchistones (id é textual, e item_id é BIGINT).
-- ============================================================================

BEGIN;

-- ANTES
SELECT s.name,
       count(*) FILTER (WHERE h.serial_number IS NULL) AS serial_null,
       count(*) FILTER (WHERE h.category_name IS NULL) AS categoria_null
FROM slabs_history h JOIN scrapers s ON s.id = h.scraper_id
WHERE s.name IN ('vmcstone','crs','nsr','zucchistones')
GROUP BY s.name ORDER BY s.name;

-- vmcstone: serial <- SKU ; categoria <- SlabType
UPDATE slabs_history h SET
  serial_number = COALESCE(h.serial_number, NULLIF(h.payload->>'SKU','')),
  category_name = COALESCE(h.category_name, NULLIF(h.payload->>'SlabType',''))
FROM scrapers s
WHERE s.id = h.scraper_id AND s.name = 'vmcstone'
  AND (h.serial_number IS NULL OR h.category_name IS NULL);

-- crs + nsr: serial <- SerialPrefix
UPDATE slabs_history h SET
  serial_number = NULLIF(h.payload->>'SerialPrefix','')
FROM scrapers s
WHERE s.id = h.scraper_id AND s.name IN ('crs','nsr')
  AND h.serial_number IS NULL;

-- zucchistones: serial <- parsedData.EntryId
UPDATE slabs_history h SET
  serial_number = NULLIF(h.payload->'parsedData'->>'EntryId','')
FROM scrapers s
WHERE s.id = h.scraper_id AND s.name = 'zucchistones'
  AND h.serial_number IS NULL;

-- DEPOIS (esperado: serial_null e categoria_null ~ 0)
SELECT s.name,
       count(*) FILTER (WHERE h.serial_number IS NULL) AS serial_null,
       count(*) FILTER (WHERE h.category_name IS NULL) AS categoria_null
FROM slabs_history h JOIN scrapers s ON s.id = h.scraper_id
WHERE s.name IN ('vmcstone','crs','nsr','zucchistones')
GROUP BY s.name ORDER BY s.name;

COMMIT;
