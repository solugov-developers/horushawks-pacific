-- ============================================================================
-- 020_reconcile_bi_keys.sql
-- Alinha a source_key de granite e zucchi à CHAVE DA CHAPA do BI do cliente
-- (cd_item), pra reconciliar 100% com o histórico legado. Descoberto lendo os
-- robôs originais + os .xlsx (VPS Hostinger) e cruzando com o payload:
--
--   granite (everest):  cd_item = f"{item_id}-{files_table_id}"
--                       -> temos ItemID (mapeado) e FilesTableID (payload)
--                       -> verificado: 2091/2091 = 100% vs o .xlsx legado
--   zucchi:             cd_item = internal_code  (códigos "BD…")
--                       -> NÃO é o Codigo__c da chapa (esse é "1152-B-19");
--                          é o chapas[].CdigoCavalete__c (125 distintos = 1/bundle)
--                       -> verificado: 125/125 = 100% vs o .xlsx legado
--
-- A chave-do-BI vira serial_number (é o identificador de chapa mais próximo que
-- cada fonte tem) e a source_key passa a apontar pra ela. Mesmo padrão da db/018.
--
-- Efeito colateral (going-forward): mapear serial do zucchi a partir de
-- chapas[].* faz o worker marcar "chapas" como usado -> chapas sai do payload
-- nos PRÓXIMOS snapshots (o histórico já gravado mantém). Aceitável: a identidade
-- fica no serial_number e o chapas é grande.
--
-- Idempotente. Requer worker com template {{campo}} (já em prod desde a db/018).
-- Depois disto: rodar db/020b (recompute de movements).
-- ============================================================================

BEGIN;

-- 1) granite: serial = {{ItemID}}-{{FilesTableID}} ; source_key = serial
UPDATE scrapers s
SET actions = rebuilt.new_actions, updated_at = now()
FROM (
  SELECT sc.id,
         jsonb_agg(
           CASE WHEN elem->>'type' = 'save_rows'
                THEN jsonb_set(
                       jsonb_set(elem, '{columns}',
                         (elem->'columns') || jsonb_build_object(
                           'serial_number', '{{ItemID}}-{{FilesTableID}}')),
                       '{source_key}', '["serial_number"]'::jsonb)
                ELSE elem END
           ORDER BY ord
         ) AS new_actions
  FROM scrapers sc,
       LATERAL jsonb_array_elements(sc.actions::jsonb) WITH ORDINALITY AS a(elem, ord)
  WHERE sc.name = 'granitedistributor'
  GROUP BY sc.id
) rebuilt
WHERE s.id = rebuilt.id;

-- 2) zucchi: serial = chapas[0].CdigoCavalete__c ; source_key = serial
UPDATE scrapers s
SET actions = rebuilt.new_actions, updated_at = now()
FROM (
  SELECT sc.id,
         jsonb_agg(
           CASE WHEN elem->>'type' = 'save_rows'
                THEN jsonb_set(
                       jsonb_set(elem, '{columns}',
                         (elem->'columns') || jsonb_build_object(
                           'serial_number', 'chapas.0.CdigoCavalete__c')),
                       '{source_key}', '["serial_number"]'::jsonb)
                ELSE elem END
           ORDER BY ord
         ) AS new_actions
  FROM scrapers sc,
       LATERAL jsonb_array_elements(sc.actions::jsonb) WITH ORDINALITY AS a(elem, ord)
  WHERE sc.name = 'zucchistones'
  GROUP BY sc.id
) rebuilt
WHERE s.id = rebuilt.id;

-- 3) backfill granite: serial + source_key = ItemID-FilesTableID (dados no payload)
UPDATE slabs_history h
SET serial_number = h.item_id::text || '-' || (h.payload->>'FilesTableID'),
    source_key    = h.item_id::text || '-' || (h.payload->>'FilesTableID')
FROM scrapers s
WHERE s.id = h.scraper_id AND s.name = 'granitedistributor'
  AND h.item_id IS NOT NULL
  AND (h.payload->>'FilesTableID') IS NOT NULL
  AND h.source_key IS DISTINCT FROM (h.item_id::text || '-' || (h.payload->>'FilesTableID'));

-- 4) backfill zucchi: serial + source_key = chapas[0].CdigoCavalete__c
UPDATE slabs_history h
SET serial_number = (h.payload->'chapas'->0->>'CdigoCavalete__c'),
    source_key    = (h.payload->'chapas'->0->>'CdigoCavalete__c')
FROM scrapers s
WHERE s.id = h.scraper_id AND s.name = 'zucchistones'
  AND (h.payload->'chapas'->0->>'CdigoCavalete__c') IS NOT NULL
  AND h.source_key IS DISTINCT FROM (h.payload->'chapas'->0->>'CdigoCavalete__c');

-- verificação: chave nas actions
SELECT s.name,
       elem->'columns'->>'serial_number' AS serial_map,
       elem->>'source_key'               AS source_key_spec
FROM scrapers s, jsonb_array_elements(s.actions::jsonb) elem
WHERE s.name IN ('granitedistributor','zucchistones') AND elem->>'type'='save_rows'
ORDER BY s.name;

-- verificação: unicidade no último snapshot
SELECT s.name, count(*) linhas, count(DISTINCT h.source_key) unicos,
       round(100.0*count(DISTINCT h.source_key)/count(*)) pct
FROM slabs_history h JOIN scrapers s ON s.id=h.scraper_id
WHERE s.name IN ('granitedistributor','zucchistones')
  AND h.job_id=(SELECT max(job_id) FROM slabs_history h2 WHERE h2.scraper_id=h.scraper_id)
GROUP BY s.name ORDER BY s.name;

COMMIT;
