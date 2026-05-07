CREATE TABLE IF NOT EXISTS scrapers (
  id          SERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  url         TEXT NOT NULL,
  actions     JSONB NOT NULL,
  schedule    TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id            SERIAL PRIMARY KEY,
  scraper_id    INT NOT NULL REFERENCES scrapers(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  triggered_by  TEXT NOT NULL CHECK (triggered_by IN ('manual','scheduled')),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_scraper_created ON jobs (scraper_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);

CREATE TABLE IF NOT EXISTS results (
  id          SERIAL PRIMARY KEY,
  job_id      INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  scraper_id  INT NOT NULL REFERENCES scrapers(id) ON DELETE CASCADE,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_results_scraper_created ON results (scraper_id, created_at DESC);
