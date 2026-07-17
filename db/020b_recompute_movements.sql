-- ============================================================================
-- 020b_recompute_movements.sql   (one-time — NÃO entra no loop de migrations)
-- Recomputa os movements de granite e zucchi sobre a source_key nova (db/020).
-- Refaz o mesmo diff do worker (computeMovements): para cada par de jobs
-- consecutivos, entradas (added) / saídas (removed) / qty_changed / price_changed,
-- por source_key. Colapsa colisões com DISTINCT ON.
-- Idempotente: apaga os movements dos 2 scrapers e regrava.
-- ============================================================================

BEGIN;

DELETE FROM movements m USING scrapers s
WHERE m.scraper_id = s.id AND s.name IN ('granitedistributor','zucchistones');

WITH scr AS (
  SELECT id FROM scrapers WHERE name IN ('granitedistributor','zucchistones')
),
-- jobs presentes no histórico, cada um pareado com o imediatamente anterior
jobs_ord AS (
  SELECT scraper_id, job_id,
         lag(job_id) OVER (PARTITION BY scraper_id ORDER BY job_id) AS prev_job_id
  FROM (SELECT DISTINCT scraper_id, job_id FROM slabs_history
        WHERE scraper_id IN (SELECT id FROM scr)) d
),
pairs AS (SELECT * FROM jobs_ord WHERE prev_job_id IS NOT NULL),
-- 1 linha por (scraper, job, source_key), colapsando colisões
snap AS (
  SELECT DISTINCT ON (scraper_id, job_id, source_key)
         scraper_id, job_id, source_key, item_name, price, available_qty
  FROM slabs_history
  WHERE scraper_id IN (SELECT id FROM scr) AND source_key IS NOT NULL
  ORDER BY scraper_id, job_id, source_key, id
),
cur AS (
  SELECT p.scraper_id, p.job_id, p.prev_job_id, sn.source_key, sn.item_name, sn.price, sn.available_qty
  FROM pairs p JOIN snap sn ON sn.scraper_id=p.scraper_id AND sn.job_id=p.job_id
),
prev AS (
  SELECT p.scraper_id, p.job_id AS cur_job, sn.source_key, sn.price, sn.available_qty
  FROM pairs p JOIN snap sn ON sn.scraper_id=p.scraper_id AND sn.job_id=p.prev_job_id
),
diff AS (
  SELECT c.scraper_id, c.job_id, c.prev_job_id, c.source_key, c.item_name,
         p.source_key AS p_key, p.price AS p_price, p.available_qty AS p_qty,
         c.price AS c_price, c.available_qty AS c_qty
  FROM cur c
  LEFT JOIN prev p ON p.scraper_id=c.scraper_id AND p.cur_job=c.job_id AND p.source_key=c.source_key
),
-- removidos: estavam no anterior e sumiram no atual
removed AS (
  SELECT pr.scraper_id, pa.job_id, pa.prev_job_id, pr.source_key,
         (SELECT item_name FROM snap s2 WHERE s2.scraper_id=pr.scraper_id AND s2.job_id=pa.prev_job_id AND s2.source_key=pr.source_key LIMIT 1) AS item_name
  FROM pairs pa
  JOIN prev pr ON pr.scraper_id=pa.scraper_id AND pr.cur_job=pa.job_id
  LEFT JOIN cur c ON c.scraper_id=pr.scraper_id AND c.job_id=pa.job_id AND c.source_key=pr.source_key
  WHERE c.source_key IS NULL
)
INSERT INTO movements (scraper_id, job_id, prev_job_id, source_key, kind, item_name, prev_value, next_value)
SELECT scraper_id, job_id, prev_job_id, source_key, 'added', item_name, NULL, NULL
FROM diff WHERE p_key IS NULL
UNION ALL
SELECT scraper_id, job_id, prev_job_id, source_key, 'removed', item_name, NULL, NULL
FROM removed
UNION ALL
SELECT scraper_id, job_id, prev_job_id, source_key, 'price_changed', item_name, p_price::text, c_price::text
FROM diff WHERE p_key IS NOT NULL AND c_price IS DISTINCT FROM p_price
UNION ALL
SELECT scraper_id, job_id, prev_job_id, source_key, 'qty_changed', item_name, p_qty::text, c_qty::text
FROM diff WHERE p_key IS NOT NULL AND c_qty IS DISTINCT FROM p_qty;

-- resumo
SELECT s.name, m.kind, count(*)
FROM movements m JOIN scrapers s ON s.id=m.scraper_id
WHERE s.name IN ('granitedistributor','zucchistones')
GROUP BY s.name, m.kind ORDER BY s.name, count(*) DESC;

COMMIT;
