-- ============================================================================
-- 030_history_scraper_key_job.sql
-- /movements: o detalhe de cada linha do feed (local/categoria) busca a linha
-- de slabs_history do movimento por (scraper_id, source_key, job_id). Com o
-- índice só em (scraper_id, source_key), chaves antigas (ex. 'removed') têm
-- centenas de linhas (uma por job) e cada lookup custava ~38 ms x 50 linhas
-- (= 1,9 s em kind=removed). Índice com job_id no fim -> lookup pontual.
-- Substitui idx_history_scraper_key (prefixo coberto). CONCURRENTLY, fora de tx.
-- ============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_history_scraper_key_job
  ON slabs_history (scraper_id, source_key, job_id);
DROP INDEX CONCURRENTLY IF EXISTS idx_history_scraper_key;
ANALYZE slabs_history;
