-- ============================================================
-- v2 platform: snapshots históricos, API tokens, webhooks, auditoria
-- ============================================================

-- 1) Snapshots históricos: estado de cada chapa em cada job.
-- Chave de identidade da chapa = (scraper_id, source_key) onde source_key
-- é o melhor identificador disponível (serial_number, bundle ou item_id).
CREATE TABLE IF NOT EXISTS slabs_history (
  id              BIGSERIAL PRIMARY KEY,
  scraper_id      INT NOT NULL REFERENCES scrapers(id) ON DELETE CASCADE,
  job_id          INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source_key      TEXT NOT NULL,
  item_id         BIGINT,
  item_name       TEXT,
  category_name   TEXT,
  serial_number   TEXT,
  bundle          TEXT,
  color           TEXT,
  location        TEXT,
  thickness       TEXT,
  available_qty   NUMERIC,
  available_slabs INTEGER,
  price           NUMERIC,
  price_range     TEXT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  scraped_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_history_scraper_job ON slabs_history (scraper_id, job_id);
CREATE INDEX IF NOT EXISTS idx_history_scraper_key ON slabs_history (scraper_id, source_key);
CREATE INDEX IF NOT EXISTS idx_history_scraped_at  ON slabs_history (scraped_at DESC);

-- 2) Movimentações: linha por diff entre 2 jobs do mesmo scraper.
CREATE TABLE IF NOT EXISTS movements (
  id           BIGSERIAL PRIMARY KEY,
  scraper_id   INT NOT NULL REFERENCES scrapers(id) ON DELETE CASCADE,
  job_id       INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  prev_job_id  INT REFERENCES jobs(id) ON DELETE SET NULL,
  source_key   TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('added','removed','price_changed','qty_changed')),
  item_name    TEXT,
  prev_value   TEXT,
  next_value   TEXT,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_movements_scraper_job ON movements (scraper_id, job_id);
CREATE INDEX IF NOT EXISTS idx_movements_kind ON movements (kind);
CREATE INDEX IF NOT EXISTS idx_movements_detected_at ON movements (detected_at DESC);

-- 3) API tokens (Bearer): hash + prefix visível.
CREATE TABLE IF NOT EXISTS api_tokens (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  prefix      TEXT NOT NULL,             -- ex: "hh_pub_xyz12"
  token_hash  TEXT NOT NULL UNIQUE,      -- sha256 hex
  scopes      TEXT[] NOT NULL DEFAULT ARRAY['read'],
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix ON api_tokens (prefix);

-- 4) Webhooks
CREATE TABLE IF NOT EXISTS webhooks (
  id          SERIAL PRIMARY KEY,
  url         TEXT NOT NULL,
  scraper_id  INT REFERENCES scrapers(id) ON DELETE CASCADE, -- NULL = todos
  events      TEXT[] NOT NULL DEFAULT ARRAY['job.done','job.failed'],
  secret      TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_delivered_at TIMESTAMPTZ,
  last_status INTEGER,
  last_error  TEXT
);

-- 5) Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor);

-- 6) Adicionar coluna de finalização explícita pra runs e dispatch de webhooks
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS rows_inserted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS movements_added    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS movements_removed  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS movements_changed  INTEGER NOT NULL DEFAULT 0;
