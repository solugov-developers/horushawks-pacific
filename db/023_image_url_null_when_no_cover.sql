-- ============================================================================
-- 023_image_url_null_when_no_cover.sql
-- Limpa image_url "base-only" (URL do S3 sem o nome do arquivo, ex.:
-- ".../nsrstone-sps-files/") gerada quando o item não tem capa. Deve ser NULL,
-- não link quebrado. O worker já foi corrigido pra emitir NULL nesses casos
-- (resolveSrc: template vira NULL quando nenhum placeholder resolve).
-- Idempotente.
-- ============================================================================

BEGIN;

UPDATE slabs_history
SET image_url = NULL
WHERE image_url ~ 'sps-files/$';

SELECT s.name, count(*) linhas, count(h.image_url) com_imagem,
       round(100.0*count(h.image_url)/count(*)) pct
FROM slabs_history h JOIN scrapers s ON s.id=h.scraper_id
WHERE h.job_id=(SELECT max(job_id) FROM slabs_history h2 WHERE h2.scraper_id=h.scraper_id)
GROUP BY s.name ORDER BY s.name;

COMMIT;
