-- ============================================================================
-- 010_fix_column_maps.sql
-- Reaponta os mapas `columns` (ação save_rows) para os campos que cada fonte
-- realmente emite hoje. Diagnóstico (confirmado no banco):
--   - crs/nsr: serial quebrou na 006 (agrupamento IDTwo_Lot_); o serial real
--              chega em SerialPrefix (100% preenchido). SerialNumber virou null.
--   - vmcstone: fonte não tem CategoryName/SerialNumber; id textual = SKU,
--               categoria = SlabType.
--   - zucchistones: id de chapa = parsedData.EntryId (Salesforce).
-- Idempotente: o merge (||) sobrescreve as chaves. Aborta se algum save_rows
-- não for top-level (guarda contra patch parcial).
-- OBS: popular serial_number muda source_key no PRÓXIMO scrape (serial tem
-- prioridade em buildSourceKey) -> 1 diff de movements ruidoso, depois normaliza.
-- ============================================================================

BEGIN;

WITH patch(name, add_cols) AS (
  VALUES
    ('vmcstone',     '{"serial_number":"SKU","category_name":"SlabType"}'::jsonb),
    ('crs',          '{"serial_number":"SerialPrefix"}'::jsonb),
    ('nsr',          '{"serial_number":"SerialPrefix"}'::jsonb),
    ('zucchistones', '{"serial_number":"parsedData.EntryId"}'::jsonb)
)
UPDATE scrapers s
SET actions = rebuilt.new_actions
FROM (
  SELECT sc.id,
         jsonb_agg(
           CASE WHEN elem->>'type' = 'save_rows' AND elem ? 'columns'
                THEN jsonb_set(elem, '{columns}', (elem->'columns') || p.add_cols)
                ELSE elem END
           ORDER BY ord
         ) AS new_actions
  FROM scrapers sc
  JOIN patch p ON p.name = sc.name,
       LATERAL jsonb_array_elements(sc.actions::jsonb) WITH ORDINALITY AS a(elem, ord)
  GROUP BY sc.id
) rebuilt
WHERE s.id = rebuilt.id;

-- Guard: garante que os 4 receberam serial_number no save_rows (senão, save_rows
-- estava aninhado num loop e o patch acima não pegou -> aborta a transação).
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(sc.name, ', ') INTO missing
  FROM scrapers sc
  WHERE sc.name IN ('vmcstone','crs','nsr','zucchistones')
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(sc.actions::jsonb) e
      WHERE e->>'type' = 'save_rows' AND (e->'columns') ? 'serial_number'
    );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'save_rows não-top-level / não patchado para: %', missing;
  END IF;
END $$;

-- Verificação (aparece na saída antes do COMMIT):
SELECT s.name,
       elem->'columns'->>'serial_number' AS serial_map,
       elem->'columns'->>'category_name' AS category_map
FROM scrapers s, jsonb_array_elements(s.actions::jsonb) elem
WHERE s.name IN ('vmcstone','crs','nsr','zucchistones')
  AND elem->>'type' = 'save_rows'
ORDER BY s.name;

COMMIT;
