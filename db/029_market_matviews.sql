-- ============================================================================
-- 029_market_matviews.sql
-- Leituras do módulo Mercado pré-agregadas (alvo < 1,5 s a frio no Lightsail):
--   movements_daily   : feed /movements agrupado por (dia, tipo, material, fonte),
--                       com category_name e sample_id (linha-exemplo p/ detalhe).
--                       ~68 k linhas em vez de agrupar 415 k a cada chamada.
--   inventory_latest  : linhas do ÚLTIMO job done de cada fonte (todas as
--                       fontes; o app filtra scrapers.kind) — base do /inventory,
--                       dos facets, do /overview e do /materials.
-- O worker faz REFRESH MATERIALIZED VIEW CONCURRENTLY das duas ao fim de cada
-- job (por isso os índices UNIQUE). Idempotente.
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS movements_daily;
CREATE MATERIALIZED VIEW movements_daily AS
SELECT m.detected_at::date                         AS d,
       m.kind,
       coalesce(m.item_name, '(unnamed)')          AS item_name,
       m.scraper_id,
       max(m.category_name)                        AS category_name,
       count(*)::int                               AS n,
       min(m.id)                                   AS sample_id
FROM movements m
GROUP BY 1, 2, 3, 4
WITH DATA;
CREATE UNIQUE INDEX idx_mdaily_key ON movements_daily (d, kind, item_name, scraper_id);
CREATE INDEX idx_mdaily_order ON movements_daily (d DESC, n DESC, item_name);
CREATE INDEX idx_mdaily_kind_order ON movements_daily (kind, d DESC, n DESC, item_name);

DROP MATERIALIZED VIEW IF EXISTS inventory_latest;
CREATE MATERIALIZED VIEW inventory_latest AS
WITH latest AS (
  SELECT j.scraper_id, max(j.id) AS job_id
  FROM jobs j WHERE j.status = 'done'
  GROUP BY j.scraper_id
)
SELECT sh.id, sh.scraper_id, sh.job_id, sh.source_key, sh.item_name, sh.category_name,
       sh.location, sh.on_hold, sh.thickness, sh.image_url,
       -- espessura crua já resolvida no refresh: coluna da fonte ou prefixo do nome
       -- ("3cm Cristallo", "12mm …"); o BFF normaliza ("N cm") em TS.
       coalesce(nullif(btrim(sh.thickness), ''),
                (SELECT m[1] || m[2] FROM (SELECT regexp_match(sh.item_name, '\y(\d+(?:\.\d+)?)\s*(cm|mm)\y', 'i') AS m) t)) AS thickness_raw
FROM slabs_history sh JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
WITH DATA;
CREATE UNIQUE INDEX idx_invlatest_id ON inventory_latest (id);
CREATE INDEX idx_invlatest_scraper ON inventory_latest (scraper_id);
CREATE INDEX idx_invlatest_item ON inventory_latest (item_name);
CREATE INDEX idx_invlatest_category ON inventory_latest (category_name);
CREATE INDEX idx_invlatest_location ON inventory_latest (location);
CREATE INDEX idx_invlatest_image ON inventory_latest (image_url) WHERE image_url IS NOT NULL;

ANALYZE movements_daily;
ANALYZE inventory_latest;
SELECT (SELECT count(*) FROM movements_daily) AS movements_daily, (SELECT count(*) FROM inventory_latest) AS inventory_latest;
