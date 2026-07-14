-- ============================================================================
-- 018_fix_identifiers.sql
-- Corrige o IDENTIFICADOR (source_key) de 4 scrapers que estavam colidindo.
--
-- Descoberto lendo os ROBÔS ORIGINAIS do cliente (VPS Hostinger,
-- /root/HorusHawks/marble_tracker2/). O nsrstone.py CONSTRÓI o serial — não vem
-- da API:
--     l["SerialNumber"] = f'{l.get("SerialPrefix","")}{l.get("IDTwo","")}'
-- E o encore usa InventoryGroupBy=SerialNumber_ (por isso a API já devolve o
-- SerialNumber pronto — e por isso o encore era o único 100% único).
--
-- Estado antes (último snapshot):
--   encore 4141/4141 (100%) OK | granitedistributor 2109/2119 (100%) OK
--   nsr    1032/2359  (44%)  ✗ | crs 300/701 (43%) ✗
--   vmc     557/2974  (19%)  ✗ | zucchistones 52/125 (42%) ✗
--
-- Correções:
--   crs/nsr      serial_number = {{SerialPrefix}}{{IDTwo}}  (fórmula do original)
--   vmcstone     serial_number = ItemNumber   (SKU é código de PRODUTO, repete;
--                ItemNumber é único: 2974/2974)
--   zucchistones remove serial_number (era parsedData.EntryId, que colide) ->
--                identidade cai no bundle (= Stock_Item__r.Name, 125/125 único,
--                exatamente o que o robô original usa)
--
-- Requer worker com suporte a template {{campo}} no columns. Idempotente.
-- ============================================================================

BEGIN;

-- crs + nsr: serial = SerialPrefix + IDTwo (concatenado)
UPDATE scrapers s
SET actions = rebuilt.new_actions, updated_at = now()
FROM (
  SELECT sc.id,
         jsonb_agg(
           CASE WHEN elem->>'type' = 'save_rows'
                THEN jsonb_set(elem, '{columns}',
                       (elem->'columns') || jsonb_build_object(
                         'serial_number', '{{SerialPrefix}}{{IDTwo}}'))
                ELSE elem END
           ORDER BY ord
         ) AS new_actions
  FROM scrapers sc,
       LATERAL jsonb_array_elements(sc.actions::jsonb) WITH ORDINALITY AS a(elem, ord)
  WHERE sc.name IN ('crs','nsr')
  GROUP BY sc.id
) rebuilt
WHERE s.id = rebuilt.id;

-- vmcstone: serial = ItemNumber (desfaz o SKU, que repete entre chapas)
UPDATE scrapers s
SET actions = rebuilt.new_actions, updated_at = now()
FROM (
  SELECT sc.id,
         jsonb_agg(
           CASE WHEN elem->>'type' = 'save_rows'
                THEN jsonb_set(elem, '{columns}',
                       (elem->'columns') || jsonb_build_object('serial_number', 'ItemNumber'))
                ELSE elem END
           ORDER BY ord
         ) AS new_actions
  FROM scrapers sc,
       LATERAL jsonb_array_elements(sc.actions::jsonb) WITH ORDINALITY AS a(elem, ord)
  WHERE sc.name = 'vmcstone'
  GROUP BY sc.id
) rebuilt
WHERE s.id = rebuilt.id;

-- zucchistones: remove o serial colidente e fixa a identidade no bundle
UPDATE scrapers s
SET actions = rebuilt.new_actions, updated_at = now()
FROM (
  SELECT sc.id,
         jsonb_agg(
           CASE WHEN elem->>'type' = 'save_rows'
                THEN jsonb_set(
                       jsonb_set(elem, '{columns}', (elem->'columns') - 'serial_number'),
                       '{source_key}', '["bundle"]'::jsonb)
                ELSE elem END
           ORDER BY ord
         ) AS new_actions
  FROM scrapers sc,
       LATERAL jsonb_array_elements(sc.actions::jsonb) WITH ORDINALITY AS a(elem, ord)
  WHERE sc.name = 'zucchistones'
  GROUP BY sc.id
) rebuilt
WHERE s.id = rebuilt.id;

-- verificação
SELECT s.name,
       elem->'columns'->>'serial_number' AS serial_map,
       elem->>'source_key'               AS source_key_spec
FROM scrapers s, jsonb_array_elements(s.actions::jsonb) elem
WHERE s.name IN ('crs','nsr','vmcstone','zucchistones')
  AND elem->>'type' = 'save_rows'
ORDER BY s.name;

COMMIT;
