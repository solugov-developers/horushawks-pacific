-- ============================================================================
-- 028_movements_category_and_covering_indexes.sql
-- Desempenho a frio do módulo Mercado (alvo < 1,5 s) e filtro de categorias
-- nos movimentos sem subconsulta correlata.
--
-- 1) movements.category_name: preenchida pelo worker no computeMovements
--    (cur/prev de slabs_history) e aqui com backfill único a partir da linha
--    de slabs_history do próprio movimento (job_id ou prev_job_id). Com isso
--    o filtro EXCLUDED_CATEGORIES vira `category_name = ANY(...)` direto.
-- 2) Índices COBRINDO (INCLUDE) para as leituras do app virarem index-only
--    scan e não tocarem o heap (movements 95 MB, slabs_history 1,2 GB, num
--    Lightsail de 1 GB):
--      movements(kind, detected_at DESC) INCLUDE (scraper_id, item_name, category_name)
--        -> /sales (totais e top), /overview (7 d)
--      movements(detected_at DESC)       INCLUDE (kind, item_name, scraper_id, category_name, id)
--        -> /movements (feed agrupado)
--      slabs_history(scraper_id, job_id) INCLUDE (item_name, category_name, location, on_hold, thickness)
--        -> /overview (contagens do snapshot), /inventory (facets)
--    Os índices antigos cobertos por prefixo (idx_movements_kind_detected,
--    idx_movements_detected_at, idx_history_scraper_job) são removidos.
-- CONCURRENTLY: rodar FORA de transação, não bloqueia o worker.
-- 3) VACUUM ANALYZE para o visibility map (index-only scan depende dele).
-- ============================================================================

ALTER TABLE movements ADD COLUMN IF NOT EXISTS category_name text;

-- backfill (idempotente: só linhas ainda NULL)
UPDATE movements m
SET category_name = (
  SELECT sh.category_name FROM slabs_history sh
  WHERE sh.scraper_id = m.scraper_id AND sh.source_key = m.source_key
    AND sh.job_id IN (m.job_id, m.prev_job_id)
  ORDER BY (sh.job_id = m.job_id) DESC LIMIT 1
)
WHERE m.category_name IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mov_kind_detected_cov
  ON movements (kind, detected_at DESC) INCLUDE (scraper_id, item_name, category_name);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mov_detected_cov
  ON movements (detected_at DESC) INCLUDE (kind, item_name, scraper_id, category_name, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_history_scraper_job_cov
  ON slabs_history (scraper_id, job_id) INCLUDE (item_name, category_name, location, on_hold, thickness);

DROP INDEX CONCURRENTLY IF EXISTS idx_movements_kind_detected;
DROP INDEX CONCURRENTLY IF EXISTS idx_movements_detected_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_history_scraper_job;

VACUUM ANALYZE movements;
VACUUM ANALYZE slabs_history;
