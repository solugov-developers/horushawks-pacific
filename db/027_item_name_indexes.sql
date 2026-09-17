-- ============================================================================
-- 027_item_name_indexes.sql
-- Índices por item_name: o detalhe unificado (/erp/materials -> resumo dos
-- concorrentes) e o /materials do app consultam movements e slabs_history
-- por nome do material; sem índice era seq scan (409k / 1,4M linhas, ~230 ms
-- cada a quente, segundos a frio no Lightsail de 1 GB).
-- CONCURRENTLY: não bloqueia o worker; rodar FORA de transação.
-- ============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_movements_item_name
  ON movements (item_name, detected_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_history_item_name
  ON slabs_history (item_name, scraper_id, job_id);
