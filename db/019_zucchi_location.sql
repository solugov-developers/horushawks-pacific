-- ============================================================================
-- 019_zucchi_location.sql
-- Popula location='California' no zucchistones.
--
-- Motivo: a Zucchi Luxury Stones tem UMA única operação nos EUA — Costa Mesa,
-- CA (2942 Century Pl, Suite 727, Costa Mesa, CA 92626). O site que raspamos
-- (inventoryusa.zucchistones.com) é só esse estoque. O payload até traz um
-- Deposito__c com 3 IDs Salesforce, mas são baldes operacionais internos, não
-- geografia — fisicamente é tudo Califórnia. Então location é constante.
--
-- Mesmo padrão do irgstone, que já usa constants:{"location":"California"}.
-- Idempotente: o patch da action faz merge; o backfill só toca o que difere.
-- ============================================================================

BEGIN;

-- 1) going-forward: injeta a constante na action save_rows do zucchi.
--    Merge com constants pré-existente (se houver) pra não perder outras chaves.
UPDATE scrapers s
SET actions = rebuilt.new_actions, updated_at = now()
FROM (
  SELECT sc.id,
         jsonb_agg(
           CASE WHEN elem->>'type' = 'save_rows'
                THEN jsonb_set(elem, '{constants}',
                       coalesce(elem->'constants', '{}'::jsonb)
                         || jsonb_build_object('location', 'California'))
                ELSE elem END
           ORDER BY ord
         ) AS new_actions
  FROM scrapers sc,
       LATERAL jsonb_array_elements(sc.actions::jsonb) WITH ORDINALITY AS a(elem, ord)
  WHERE sc.name = 'zucchistones'
  GROUP BY sc.id
) rebuilt
WHERE s.id = rebuilt.id;

-- 2) backfill: todo o histórico do zucchi -> California
UPDATE slabs_history h
SET location = 'California'
FROM scrapers s
WHERE s.id = h.scraper_id AND s.name = 'zucchistones'
  AND h.location IS DISTINCT FROM 'California';

-- verificação
SELECT 'action' AS o, elem->'constants'->>'location' AS location_const
FROM scrapers s, jsonb_array_elements(s.actions::jsonb) elem
WHERE s.name = 'zucchistones' AND elem->>'type' = 'save_rows';

SELECT 'historico' AS o,
       count(*) AS linhas,
       count(*) FILTER (WHERE location = 'California') AS com_california,
       count(*) FILTER (WHERE location IS NULL)        AS ainda_nula
FROM slabs_history h JOIN scrapers s ON s.id = h.scraper_id
WHERE s.name = 'zucchistones';

COMMIT;
