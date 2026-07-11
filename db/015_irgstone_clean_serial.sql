-- ============================================================================
-- 015_irgstone_clean_serial.sql
-- Limpa o serial_number do irgstone: ele vinha de attributes.1.terms.0.name
-- (posicional), que na prática é COR (White/Grey/Black...) — não é serial.
-- A identidade correta já é o item_id (source_key, migration 014).
-- Aqui: remove serial_number do mapa (para de popular lixo) + zera no histórico.
-- O remap correto (serial<-atributo "lot", por NOME) fica p/ quando o site voltar
-- e o engine ganhar lookup de atributo por nome. Idempotente.
-- ============================================================================

BEGIN;

-- 1) remove serial_number do columns do save_rows (para de popular)
UPDATE scrapers s
SET actions = rebuilt.new_actions, updated_at = now()
FROM (
  SELECT sc.id,
         jsonb_agg(
           CASE WHEN elem->>'type' = 'save_rows'
                THEN jsonb_set(elem, '{columns}', (elem->'columns') - 'serial_number')
                ELSE elem END
           ORDER BY ord
         ) AS new_actions
  FROM scrapers sc,
       LATERAL jsonb_array_elements(sc.actions::jsonb) WITH ORDINALITY AS a(elem, ord)
  WHERE sc.name = 'irgstone'
  GROUP BY sc.id
) rebuilt
WHERE s.id = rebuilt.id;

-- 2) zera o serial_number garbage no histórico
UPDATE slabs_history h
SET serial_number = NULL
FROM scrapers s
WHERE s.id = h.scraper_id AND s.name = 'irgstone' AND h.serial_number IS NOT NULL;

-- verificação: mapa sem serial_number, e histórico zerado
SELECT (elem->'columns' ? 'serial_number') AS ainda_tem_serial_no_mapa
FROM scrapers s, jsonb_array_elements(s.actions::jsonb) elem
WHERE s.name='irgstone' AND elem->>'type'='save_rows';

COMMIT;
