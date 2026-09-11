-- ============================================================================
-- 022_image_url_stoneprofits.sql
-- FASE 2: image_url (capa do item) pros 4 StoneProfits *.stoneprofits.com.
--
-- A capa do item vive na galeria (getItemGallery -> campo Filename). O loop já
-- itera a galeria (as: item); uso stamp_from_item pra carimbar item.Filename em
-- cada linha do inventário (como CoverFilename), e mapeio:
--   image_url = <FilePath do tenant> + {{CoverFilename|url}}
--
-- FilePath por tenant (do act=getSettings, verificado ao vivo; regiões diferem!):
--   crs    us-east-1  crsaustin-sps-files
--   encore us-east-1  pacshoreeast-sps-files
--   nsr    us-east-2  nsrstone-sps-files
--   tsi    us-east-2  thestoneindustry-sps-files
--
-- Histórico: a CAPA nunca foi guardada; o passado só tem a foto-da-CHAPA
-- (payload.FileName). Então backfill histórico = foto-da-chapa (best-effort);
-- going-forward = capa. Rodar 1 job de cada depois pega a capa do estoque atual.
--
-- Sem rebuild de worker (stamp_from_item, {{|url}} e image_url já existem).
-- Idempotente.
-- ============================================================================

BEGIN;

-- URL-encode dos chars que o S3 exige (mesmo da 021)
CREATE OR REPLACE FUNCTION pg_temp.urlenc(t text) RETURNS text AS $$
  SELECT replace(replace(replace(replace(replace(replace(replace(replace(
         t,'%','%25'),' ','%20'),'[','%5B'),']','%5D'),'#','%23'),'?','%3F'),'&','%26'),'+','%2B');
$$ LANGUAGE sql IMMUTABLE;

-- carimba a capa da galeria + mapeia image_url na action
CREATE OR REPLACE FUNCTION pg_temp.add_cover(p_name text, p_filepath text) RETURNS void AS $$
DECLARE cur jsonb; res jsonb;
BEGIN
  SELECT actions::jsonb INTO cur FROM scrapers WHERE name = p_name;
  SELECT jsonb_agg(
    CASE
      WHEN elem->>'type' = 'loop' THEN jsonb_set(elem, '{actions}', (
        SELECT jsonb_agg(
          CASE WHEN ie ? 'append_to'
               THEN jsonb_set(ie, '{stamp_from_item}',
                      coalesce(ie->'stamp_from_item', '{}'::jsonb)
                        || jsonb_build_object('CoverFilename', 'Filename'))
               ELSE ie END
          ORDER BY io)
        FROM jsonb_array_elements(elem->'actions') WITH ORDINALITY t2(ie, io)))
      WHEN elem->>'type' = 'save_rows' THEN jsonb_set(elem, '{columns}',
             (elem->'columns') || jsonb_build_object('image_url', p_filepath || '{{CoverFilename|url}}'))
      ELSE elem END
    ORDER BY o)
  INTO res
  FROM jsonb_array_elements(cur) WITH ORDINALITY t1(elem, o);
  UPDATE scrapers SET actions = res, updated_at = now() WHERE name = p_name;
END; $$ LANGUAGE plpgsql;

SELECT pg_temp.add_cover('crs',              'https://s3.us-east-1.amazonaws.com/crsaustin-sps-files/');
SELECT pg_temp.add_cover('encore',           'https://s3.us-east-1.amazonaws.com/pacshoreeast-sps-files/');
SELECT pg_temp.add_cover('nsr',              'https://s3.us-east-2.amazonaws.com/nsrstone-sps-files/');
SELECT pg_temp.add_cover('thestoneindustry', 'https://s3.us-east-2.amazonaws.com/thestoneindustry-sps-files/');

-- backfill histórico best-effort: foto-da-chapa (payload.FileName) + FilePath
CREATE OR REPLACE FUNCTION pg_temp.backfill_img(p_name text, p_filepath text) RETURNS void AS $$
BEGIN
  UPDATE slabs_history h
  SET image_url = p_filepath || pg_temp.urlenc(h.payload->>'FileName')
  FROM scrapers s
  WHERE s.id = h.scraper_id AND s.name = p_name
    AND coalesce(h.payload->>'FileName','') <> ''
    AND h.image_url IS DISTINCT FROM (p_filepath || pg_temp.urlenc(h.payload->>'FileName'));
END; $$ LANGUAGE plpgsql;

SELECT pg_temp.backfill_img('crs',              'https://s3.us-east-1.amazonaws.com/crsaustin-sps-files/');
SELECT pg_temp.backfill_img('encore',           'https://s3.us-east-1.amazonaws.com/pacshoreeast-sps-files/');
SELECT pg_temp.backfill_img('nsr',              'https://s3.us-east-2.amazonaws.com/nsrstone-sps-files/');
SELECT pg_temp.backfill_img('thestoneindustry', 'https://s3.us-east-2.amazonaws.com/thestoneindustry-sps-files/');

-- verificação: mapa da action + cobertura histórica (foto-da-chapa)
SELECT s.name,
       elem->'columns'->>'image_url' AS image_map
FROM scrapers s, jsonb_array_elements(s.actions::jsonb) elem
WHERE s.name IN ('crs','encore','nsr','thestoneindustry') AND elem->>'type'='save_rows'
ORDER BY s.name;

SELECT s.name, count(*) linhas, count(h.image_url) com_img, round(100.0*count(h.image_url)/count(*)) pct
FROM slabs_history h JOIN scrapers s ON s.id=h.scraper_id
WHERE s.name IN ('crs','encore','nsr','thestoneindustry')
  AND h.job_id=(SELECT max(job_id) FROM slabs_history h2 WHERE h2.scraper_id=h.scraper_id)
GROUP BY s.name ORDER BY s.name;

COMMIT;
