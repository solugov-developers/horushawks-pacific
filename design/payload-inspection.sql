-- ============================================================
-- Payload Inspection — descobrir nomes reais dos fields
-- Rode este script quando tiver o docker compose up + jobs já tendo rodado.
--
-- Uso:
--   docker compose exec -T postgres psql -U scraper -d scrapers \
--     < design/payload-inspection.sql > design/payload-samples.txt
-- ============================================================

\timing off
\pset pager off

-- ------------------------------------------------------------
-- 1) Lista de scrapers e quantos snapshots cada um tem
-- ------------------------------------------------------------
SELECT
  s.id, s.name,
  count(sh.id) AS snapshots,
  max(sh.scraped_at) AS last_snapshot
FROM scrapers s
LEFT JOIN slabs_history sh ON sh.scraper_id = s.id
GROUP BY s.id, s.name
ORDER BY s.id;

-- ------------------------------------------------------------
-- 2) Para cada scraper: 1 payload de exemplo (último job done).
-- Salvar a saída deste bloco e procurar por:
--   - location / locationname / warehouse / city
--   - hold / on_hold / onhold / status
--   - serial / lot / slabid
--   - dateadded / arrived / receiveddate / created
-- ------------------------------------------------------------

\echo '======================================================='
\echo 'ENCORE — sample payload'
\echo '======================================================='
SELECT jsonb_pretty(payload) AS payload
FROM slabs_history
WHERE scraper_id = (SELECT id FROM scrapers WHERE name = 'encore')
ORDER BY scraped_at DESC LIMIT 1;

\echo '======================================================='
\echo 'CRS — sample payload'
\echo '======================================================='
SELECT jsonb_pretty(payload) AS payload
FROM slabs_history
WHERE scraper_id = (SELECT id FROM scrapers WHERE name = 'crs')
ORDER BY scraped_at DESC LIMIT 1;

\echo '======================================================='
\echo 'NSR — sample payload'
\echo '======================================================='
SELECT jsonb_pretty(payload) AS payload
FROM slabs_history
WHERE scraper_id = (SELECT id FROM scrapers WHERE name = 'nsr')
ORDER BY scraped_at DESC LIMIT 1;

\echo '======================================================='
\echo 'VMCSTONE — sample payload'
\echo '======================================================='
SELECT jsonb_pretty(payload) AS payload
FROM slabs_history
WHERE scraper_id = (SELECT id FROM scrapers WHERE name = 'vmcstone')
ORDER BY scraped_at DESC LIMIT 1;

\echo '======================================================='
\echo 'GRANITEDISTRIBUTOR — sample payload'
\echo '======================================================='
SELECT jsonb_pretty(payload) AS payload
FROM slabs_history
WHERE scraper_id = (SELECT id FROM scrapers WHERE name = 'granitedistributor')
ORDER BY scraped_at DESC LIMIT 1;

\echo '======================================================='
\echo 'ZUCCHISTONES — sample payload'
\echo '======================================================='
SELECT jsonb_pretty(payload) AS payload
FROM slabs_history
WHERE scraper_id = (SELECT id FROM scrapers WHERE name = 'zucchistones')
ORDER BY scraped_at DESC LIMIT 1;

-- ------------------------------------------------------------
-- 3) Field heatmap: quais top-level keys aparecem em quantos snapshots?
-- Mostra onde os fields candidatos estão de fato presentes.
-- ------------------------------------------------------------

\echo '======================================================='
\echo 'FIELD KEY FREQUENCY per scraper (top 30 keys)'
\echo '======================================================='
WITH keys AS (
  SELECT
    s.name AS scraper,
    k AS key
  FROM slabs_history sh
  JOIN scrapers s ON s.id = sh.scraper_id
  CROSS JOIN LATERAL jsonb_object_keys(sh.payload) AS k
  WHERE sh.scraped_at > now() - INTERVAL '7 days'
)
SELECT scraper, key, count(*) AS occurrences
FROM keys
GROUP BY scraper, key
ORDER BY scraper, occurrences DESC
LIMIT 200;

-- ------------------------------------------------------------
-- 4) Candidatos diretos para cada field-of-interest
-- ------------------------------------------------------------

\echo '======================================================='
\echo 'CANDIDATE: location-like keys'
\echo '======================================================='
WITH keys AS (
  SELECT s.name AS scraper, k AS key
  FROM slabs_history sh
  JOIN scrapers s ON s.id = sh.scraper_id
  CROSS JOIN LATERAL jsonb_object_keys(sh.payload) AS k
  WHERE sh.scraped_at > now() - INTERVAL '7 days'
)
SELECT scraper, key, count(*) AS occurrences
FROM keys
WHERE key ~* '(location|warehouse|store|branch|city|where)'
GROUP BY scraper, key
ORDER BY scraper, occurrences DESC;

\echo '======================================================='
\echo 'CANDIDATE: hold/status-like keys'
\echo '======================================================='
WITH keys AS (
  SELECT s.name AS scraper, k AS key
  FROM slabs_history sh
  JOIN scrapers s ON s.id = sh.scraper_id
  CROSS JOIN LATERAL jsonb_object_keys(sh.payload) AS k
  WHERE sh.scraped_at > now() - INTERVAL '7 days'
)
SELECT scraper, key, count(*) AS occurrences
FROM keys
WHERE key ~* '(hold|status|state|reserve|so\b|sales_order|intransit)'
GROUP BY scraper, key
ORDER BY scraper, occurrences DESC;

\echo '======================================================='
\echo 'CANDIDATE: arrived/date-like keys'
\echo '======================================================='
WITH keys AS (
  SELECT s.name AS scraper, k AS key
  FROM slabs_history sh
  JOIN scrapers s ON s.id = sh.scraper_id
  CROSS JOIN LATERAL jsonb_object_keys(sh.payload) AS k
  WHERE sh.scraped_at > now() - INTERVAL '7 days'
)
SELECT scraper, key, count(*) AS occurrences
FROM keys
WHERE key ~* '(date|arriv|receive|created|added|entry|incoming)'
GROUP BY scraper, key
ORDER BY scraper, occurrences DESC;

\echo '======================================================='
\echo 'CANDIDATE: serial/identity-like keys'
\echo '======================================================='
WITH keys AS (
  SELECT s.name AS scraper, k AS key
  FROM slabs_history sh
  JOIN scrapers s ON s.id = sh.scraper_id
  CROSS JOIN LATERAL jsonb_object_keys(sh.payload) AS k
  WHERE sh.scraped_at > now() - INTERVAL '7 days'
)
SELECT scraper, key, count(*) AS occurrences
FROM keys
WHERE key ~* '(serial|slabid|chapaid|lot|sku\b|barcode)'
GROUP BY scraper, key
ORDER BY scraper, occurrences DESC;

-- ------------------------------------------------------------
-- 5) Sample values para os candidatos identificados (preencher manualmente
-- após ver os resultados acima — exemplo já funciona se 'OnHold' existir)
-- ------------------------------------------------------------

\echo '======================================================='
\echo 'Sample values: payload->>OnHold (Stone Profits convention)'
\echo '======================================================='
SELECT s.name AS scraper, payload->>'OnHold' AS on_hold_raw, count(*)
FROM slabs_history sh
JOIN scrapers s ON s.id = sh.scraper_id
WHERE payload ? 'OnHold' AND sh.scraped_at > now() - INTERVAL '7 days'
GROUP BY 1, 2 ORDER BY 1, 3 DESC;

\echo '======================================================='
\echo 'Sample values: payload->>LocationName (VMC convention)'
\echo '======================================================='
SELECT s.name AS scraper, payload->>'LocationName' AS location_raw, count(*)
FROM slabs_history sh
JOIN scrapers s ON s.id = sh.scraper_id
WHERE payload ? 'LocationName' AND sh.scraped_at > now() - INTERVAL '7 days'
GROUP BY 1, 2 ORDER BY 1, 3 DESC LIMIT 30;

\echo '======================================================='
\echo 'Sample values: payload->>Location (generic)'
\echo '======================================================='
SELECT s.name AS scraper, payload->>'Location' AS location_raw, count(*)
FROM slabs_history sh
JOIN scrapers s ON s.id = sh.scraper_id
WHERE payload ? 'Location' AND sh.scraped_at > now() - INTERVAL '7 days'
GROUP BY 1, 2 ORDER BY 1, 3 DESC LIMIT 30;
