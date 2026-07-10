-- ============================================================
-- 007: saved_queries — repositório de SQL ad-hoc do painel.
-- Aplicar após 006. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS saved_queries (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  sql             TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at     TIMESTAMPTZ,
  last_run_ms     INTEGER,
  last_row_count  INTEGER,
  last_error      TEXT
);

CREATE INDEX IF NOT EXISTS idx_saved_queries_updated_at ON saved_queries (updated_at DESC);

-- Seeds: queries úteis pra começar.
INSERT INTO saved_queries (name, description, sql) VALUES
  (
    'Inventory por categoria',
    'Total de slabs por categoria, considerando o último job done de cada scraper.',
    $sql$WITH latest AS (
  SELECT s.id AS scraper_id, max(j.id) AS job_id
  FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
  WHERE j.status = 'done'
  GROUP BY s.id
)
SELECT sh.category_name, count(*) AS slabs
FROM slabs_history sh
JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
WHERE sh.category_name IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC;$sql$
  ),
  (
    'Inventory por location',
    'Distribuição por location (todos os scrapers, último job done).',
    $sql$WITH latest AS (
  SELECT s.id AS scraper_id, max(j.id) AS job_id
  FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
  WHERE j.status = 'done'
  GROUP BY s.id
)
SELECT sh.location, count(*) AS slabs
FROM slabs_history sh
JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
WHERE sh.location IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC;$sql$
  ),
  (
    'Movements last 30 days',
    'Últimas 30 dias de movimentações por kind.',
    $sql$SELECT kind, count(*) AS n
FROM movements
WHERE detected_at > now() - INTERVAL '30 days'
GROUP BY 1 ORDER BY 2 DESC;$sql$
  ),
  (
    'Top 20 vendidos (kind=removed)',
    'Materiais mais vendidos.',
    $sql$SELECT item_name, count(*) AS sold
FROM movements
WHERE kind = 'removed' AND detected_at > now() - INTERVAL '90 days'
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;$sql$
  ),
  (
    'Jobs recentes',
    'Status de cada job dos últimos 7 dias.',
    $sql$SELECT j.id, s.name AS scraper, j.status, j.started_at, j.finished_at,
       j.rows_inserted, j.movements_added, j.movements_removed,
       j.movements_transferred, j.movements_held
FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
WHERE j.started_at > now() - INTERVAL '7 days'
ORDER BY j.id DESC;$sql$
  ),
  (
    'Slabs em hold por scraper',
    'Quantas slabs marcadas on_hold no snapshot atual.',
    $sql$WITH latest AS (
  SELECT s.id AS scraper_id, s.name, max(j.id) AS job_id
  FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
  WHERE j.status = 'done'
  GROUP BY s.id, s.name
)
SELECT l.name, count(*) FILTER (WHERE sh.on_hold = true) AS on_hold,
       count(*) AS total
FROM latest l
JOIN slabs_history sh ON sh.scraper_id = l.scraper_id AND sh.job_id = l.job_id
GROUP BY 1 ORDER BY 1;$sql$
  )
ON CONFLICT DO NOTHING;
