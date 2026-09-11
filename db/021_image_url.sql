-- ============================================================================
-- 021_image_url.sql
-- Adiciona image_url (capa do item) em slabs_history + tabelas *_slabs, mapeia
-- nos scrapers e faz backfill do histórico.
--
-- FASE 1 (esta migration): os que já têm URL/nome no payload ->
--   vmcstone      image_url = ImagePath                        (URL S3 completa)
--   zucchistones  image_url = contents[0].prodLinkFull         (CloudFront)
--   irgstone      image_url = images[0].src                    (WooCommerce)
--   granite       image_url = s3/evereststone-sps-files/{Filename}  (encodado)
-- Os 4 StoneProfits *.stoneprofits.com entram na FASE 2 (capa via stamp).
--
-- Descoberto ao vivo: base S3 por tenant vem do act=getSettings (FilePath);
-- granite = evereststone-sps-files. [ ] e espaço EXIGEM URL-encode no S3.
-- Requer worker com snapCols+image_url e filtro {{campo|url}} (db deploy junto).
-- Idempotente.
-- ============================================================================

BEGIN;

-- 1) schema
ALTER TABLE slabs_history ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE crs_slabs                ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE encore_slabs             ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE granitedistributor_slabs ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE irgstone_slabs           ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE nsr_slabs                ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE tsi_slabs                ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE vmcstone_slabs           ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE zucchistones_slabs       ADD COLUMN IF NOT EXISTS image_url text;

-- 2) mapeia image_url nas actions (going-forward). Um UPDATE por recipe.
-- helper: adiciona a chave image_url no columns do save_rows
CREATE OR REPLACE FUNCTION pg_temp.set_image_map(p_name text, p_expr text) RETURNS void AS $$
BEGIN
  UPDATE scrapers s
  SET actions = rebuilt.new_actions, updated_at = now()
  FROM (
    SELECT sc.id,
           jsonb_agg(
             CASE WHEN elem->>'type' = 'save_rows'
                  THEN jsonb_set(elem, '{columns}',
                         (elem->'columns') || jsonb_build_object('image_url', p_expr))
                  ELSE elem END
             ORDER BY ord
           ) AS new_actions
    FROM scrapers sc,
         LATERAL jsonb_array_elements(sc.actions::jsonb) WITH ORDINALITY AS a(elem, ord)
    WHERE sc.name = p_name
    GROUP BY sc.id
  ) rebuilt
  WHERE s.id = rebuilt.id;
END; $$ LANGUAGE plpgsql;

SELECT pg_temp.set_image_map('vmcstone',     'ImagePath');
SELECT pg_temp.set_image_map('zucchistones', 'contents.0.prodLinkFull');
SELECT pg_temp.set_image_map('irgstone',     'images.0.src');
SELECT pg_temp.set_image_map('granitedistributor',
       'https://s3.us-east-1.amazonaws.com/evereststone-sps-files/{{Filename|url}}');

-- 3) backfill do histórico (só onde faz sentido; idempotente via IS DISTINCT)
-- URL-encode em SQL dos chars que o S3 exige ( [ ] espaço # ? & + ; % primeiro)
CREATE OR REPLACE FUNCTION pg_temp.urlenc(t text) RETURNS text AS $$
  SELECT replace(replace(replace(replace(replace(replace(replace(replace(
         t,'%','%25'),' ','%20'),'[','%5B'),']','%5D'),'#','%23'),'?','%3F'),'&','%26'),'+','%2B');
$$ LANGUAGE sql IMMUTABLE;

-- vmc / zucchi / irg: URL completa já no payload
UPDATE slabs_history h SET image_url = h.payload->>'ImagePath'
FROM scrapers s WHERE s.id=h.scraper_id AND s.name='vmcstone'
  AND (h.payload->>'ImagePath') IS NOT NULL
  AND h.image_url IS DISTINCT FROM (h.payload->>'ImagePath');

UPDATE slabs_history h SET image_url = h.payload->'contents'->0->>'prodLinkFull'
FROM scrapers s WHERE s.id=h.scraper_id AND s.name='zucchistones'
  AND (h.payload->'contents'->0->>'prodLinkFull') IS NOT NULL
  AND h.image_url IS DISTINCT FROM (h.payload->'contents'->0->>'prodLinkFull');

UPDATE slabs_history h SET image_url = h.payload->'images'->0->>'src'
FROM scrapers s WHERE s.id=h.scraper_id AND s.name='irgstone'
  AND (h.payload->'images'->0->>'src') IS NOT NULL
  AND h.image_url IS DISTINCT FROM (h.payload->'images'->0->>'src');

-- granite: base + Filename encodado
UPDATE slabs_history h
SET image_url = 'https://s3.us-east-1.amazonaws.com/evereststone-sps-files/'
                || pg_temp.urlenc(h.payload->>'Filename')
FROM scrapers s WHERE s.id=h.scraper_id AND s.name='granitedistributor'
  AND coalesce(h.payload->>'Filename','') <> ''
  AND h.image_url IS DISTINCT FROM
      ('https://s3.us-east-1.amazonaws.com/evereststone-sps-files/' || pg_temp.urlenc(h.payload->>'Filename'));

-- verificação: cobertura por scraper no último snapshot
SELECT s.name,
       count(*) linhas,
       count(h.image_url) com_imagem,
       round(100.0*count(h.image_url)/count(*)) pct
FROM slabs_history h JOIN scrapers s ON s.id=h.scraper_id
WHERE s.name IN ('vmcstone','zucchistones','irgstone','granitedistributor')
  AND h.job_id=(SELECT max(job_id) FROM slabs_history h2 WHERE h2.scraper_id=h.scraper_id)
GROUP BY s.name ORDER BY s.name;

COMMIT;
