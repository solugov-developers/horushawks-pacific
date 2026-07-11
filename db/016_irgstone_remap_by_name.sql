-- ============================================================================
-- 016_irgstone_remap_by_name.sql
-- Remapeia os atributos do irgstone por NOME (não por posição), agora que o
-- worker getPath suporta filtro de array: attributes[name=X].terms.0.name.
-- Descoberto ao vivo: a ordem dos attributes varia por produto (posição [1]
-- ora é Color, ora lot...), por isso o mapa posicional embaralhava tudo.
-- Nomes reais: lot (serial), Color, Slab Thickness, Finish, size, Status.
--   serial_number <- attributes[name=lot]           (ex.: 421, 342, 489-9)
--   color         <- attributes[name=Color]         (Black, Beige, Grey...)
--   thickness     <- attributes[name=Slab Thickness](2cm, 3cm)
-- Forward-only: o atributo cru não foi guardado nos snapshots antigos, então
-- histórico de color/thickness não dá p/ recuperar (só daqui pra frente).
-- Requer worker com filtro de array no getPath. Idempotente.
-- ============================================================================

BEGIN;

UPDATE scrapers s
SET actions = rebuilt.new_actions, updated_at = now()
FROM (
  SELECT sc.id,
         jsonb_agg(
           CASE WHEN elem->>'type' = 'save_rows'
                THEN jsonb_set(elem, '{columns}',
                       (elem->'columns') || jsonb_build_object(
                         'serial_number', 'attributes[name=lot].terms.0.name',
                         'color',         'attributes[name=Color].terms.0.name',
                         'thickness',     'attributes[name=Slab Thickness].terms.0.name'
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

-- verificação
SELECT elem->'columns'->>'serial_number' AS serial_map,
       elem->'columns'->>'color'         AS color_map,
       elem->'columns'->>'thickness'     AS thickness_map
FROM scrapers s, jsonb_array_elements(s.actions::jsonb) elem
WHERE s.name='irgstone' AND elem->>'type'='save_rows';

COMMIT;
