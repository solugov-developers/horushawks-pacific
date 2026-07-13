-- ============================================================================
-- 017_finish_column.sql
-- Adiciona "finish" (acabamento). O irgstone tem o atributo Finish com nomes
-- reais (Honed/Polished/Satin/Natural/Filled/Hammered... — 99% de cobertura).
-- Mapeia finish por NOME de atributo (getPath com filtro de array).
-- Obs: thestoneindustry NÃO entra — o Finish dele é ID numérico (fica no
-- item_name, ex.: "... - Polished"), não aproveitável como campo.
-- Idempotente. Requer worker com finish no snapCols.
-- ============================================================================

BEGIN;

ALTER TABLE slabs_history  ADD COLUMN IF NOT EXISTS finish TEXT;
ALTER TABLE irgstone_slabs ADD COLUMN IF NOT EXISTS finish TEXT;

-- mapeia finish no save_rows do irgstone
UPDATE scrapers s
SET actions = rebuilt.new_actions, updated_at = now()
FROM (
  SELECT sc.id,
         jsonb_agg(
           CASE WHEN elem->>'type' = 'save_rows'
                THEN jsonb_set(elem, '{columns}',
                       (elem->'columns') || jsonb_build_object(
                         'finish', 'attributes[name=Finish].terms.0.name'
                       ))
                ELSE elem END
           ORDER BY ord
         ) AS new_actions
  FROM scrapers sc,
       LATERAL jsonb_array_elements(sc.actions::jsonb) WITH ORDINALITY AS a(elem, ord)
  WHERE sc.name = 'irgstone'
  GROUP BY sc.id
) rebuilt
WHERE s.id = rebuilt.id;

SELECT elem->'columns'->>'finish' AS finish_map
FROM scrapers s, jsonb_array_elements(s.actions::jsonb) elem
WHERE s.name='irgstone' AND elem->>'type'='save_rows';

COMMIT;
