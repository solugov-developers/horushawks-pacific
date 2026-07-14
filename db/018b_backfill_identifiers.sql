-- ============================================================================
-- 018b_backfill_identifiers.sql   (one-time — NÃO entra no loop de migrations)
-- Corrige a identidade em TODO o histórico, sem re-scrapear: os campos
-- necessários estão preservados no payload.
--   crs/nsr      serial_number += IDTwo  (já tinha SerialPrefix) -> source_key
--   vmcstone     serial_number = payload->>'ItemNumber'          -> source_key
--   zucchistones serial_number = NULL; source_key = bundle
-- Idempotente (guardas evitam concatenar 2x / reprocessar).
-- Depois disto: recomputar movements desses scrapers.
-- ============================================================================

BEGIN;

-- unicidade medida DENTRO do último snapshot (a mesma chapa se repete entre dias)
SELECT 'ANTES' AS t, s.name, count(*) linhas, count(DISTINCT h.source_key) unicos,
       round(100.0*count(DISTINCT h.source_key)/count(*)) pct
FROM slabs_history h JOIN scrapers s ON s.id = h.scraper_id
WHERE s.name IN ('crs','nsr','vmcstone','zucchistones')
  AND h.job_id = (SELECT max(job_id) FROM slabs_history h2 WHERE h2.scraper_id = h.scraper_id)
GROUP BY s.name ORDER BY s.name;

-- 1) crs + nsr: acrescenta o IDTwo ao serial (que hoje é só o SerialPrefix).
--    Guarda: só mexe se o IDTwo não estiver já no fim (idempotente).
UPDATE slabs_history h
SET serial_number = h.serial_number || (h.payload->>'IDTwo')
FROM scrapers s
WHERE s.id = h.scraper_id AND s.name IN ('crs','nsr')
  AND h.serial_number IS NOT NULL
  AND coalesce(h.payload->>'IDTwo','') <> ''
  AND right(h.serial_number, length(h.payload->>'IDTwo')) IS DISTINCT FROM (h.payload->>'IDTwo');

-- identidade = serial (idempotente)
UPDATE slabs_history h
SET source_key = h.serial_number
FROM scrapers s
WHERE s.id = h.scraper_id AND s.name IN ('crs','nsr')
  AND h.serial_number IS NOT NULL
  AND h.source_key IS DISTINCT FROM h.serial_number;

-- 2) vmcstone: ItemNumber é o único (SKU repete entre chapas)
UPDATE slabs_history h
SET serial_number = h.payload->>'ItemNumber',
    source_key    = h.payload->>'ItemNumber'
FROM scrapers s
WHERE s.id = h.scraper_id AND s.name = 'vmcstone'
  AND (h.payload->>'ItemNumber') IS NOT NULL
  AND h.source_key IS DISTINCT FROM (h.payload->>'ItemNumber');

-- 3) zucchistones: serial (EntryId) colidia -> some; identidade vira o bundle
UPDATE slabs_history h
SET serial_number = NULL,
    source_key    = h.bundle
FROM scrapers s
WHERE s.id = h.scraper_id AND s.name = 'zucchistones'
  AND h.bundle IS NOT NULL
  AND (h.source_key IS DISTINCT FROM h.bundle OR h.serial_number IS NOT NULL);

SELECT 'DEPOIS' AS t, s.name, count(*) linhas, count(DISTINCT h.source_key) unicos,
       round(100.0*count(DISTINCT h.source_key)/count(*)) pct
FROM slabs_history h JOIN scrapers s ON s.id = h.scraper_id
WHERE s.name IN ('crs','nsr','vmcstone','zucchistones')
  AND h.job_id = (SELECT max(job_id) FROM slabs_history h2 WHERE h2.scraper_id = h.scraper_id)
GROUP BY s.name ORDER BY s.name;

COMMIT;
