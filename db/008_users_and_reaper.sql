-- ============================================================
-- 008: users table (bcrypt) + reaper de jobs órfãos.
--
-- Substitui PANEL_USER/PANEL_PASSWORD plain-text por hash bcrypt
-- numa tabela `users`. O bootstrap do panel cria/upgrada o admin
-- a partir das envs PANEL_USER/PANEL_PASSWORD na primeira subida.
--
-- Idempotente. Aplicar após 007.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','viewer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- Reaper: marcar como failed jobs que ficaram em 'running' por > 2h
-- (provavelmente o worker morreu durante execução).
-- Esta query é executada no boot do worker (worker/worker.js).
-- Não precisa de mais nada aqui — só registramos a intenção em SQL comment.
COMMENT ON TABLE jobs IS
  'Jobs órfãos (running > 2h) são marcados como failed automaticamente pelo worker no boot.';
