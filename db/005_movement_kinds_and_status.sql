-- ============================================================
-- 005: estende movement kinds (transferred/held/released)
--      e adiciona colunas de status (on_hold, on_so, in_transit)
--
-- Aplicar após 002, 003, 004.
-- Idempotente: usa IF NOT EXISTS / DROP IF EXISTS.
-- ============================================================

-- 1) Estender o CHECK de movements.kind
ALTER TABLE movements DROP CONSTRAINT IF EXISTS movements_kind_check;
ALTER TABLE movements ADD CONSTRAINT movements_kind_check
  CHECK (kind IN (
    'added',
    'removed',
    'price_changed',
    'qty_changed',
    'transferred',
    'held',
    'released'
  ));

-- 2) Adicionar colunas de status nas tabelas <source>_slabs.
-- Cada coluna fica anulável (nem todo fornecedor reporta os 3).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'encore_slabs',
    'crs_slabs',
    'nsr_slabs',
    'granitedistributor_slabs',
    'vmcstone_slabs',
    'zucchistones_slabs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS on_hold     BOOLEAN', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS on_so       BOOLEAN', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS in_transit  BOOLEAN', t);
  END LOOP;
END$$;

-- 3) Adicionar as mesmas colunas em slabs_history para que os snapshots
-- as preservem e o computeMovements possa diff-ar.
ALTER TABLE slabs_history ADD COLUMN IF NOT EXISTS on_hold    BOOLEAN;
ALTER TABLE slabs_history ADD COLUMN IF NOT EXISTS on_so      BOOLEAN;
ALTER TABLE slabs_history ADD COLUMN IF NOT EXISTS in_transit BOOLEAN;

-- 4) Índices úteis para as agregações dos relatórios.
CREATE INDEX IF NOT EXISTS idx_history_on_hold
  ON slabs_history (scraper_id, on_hold) WHERE on_hold = true;

CREATE INDEX IF NOT EXISTS idx_history_location
  ON slabs_history (scraper_id, location);

CREATE INDEX IF NOT EXISTS idx_movements_kind_detected
  ON movements (kind, detected_at DESC);

-- 5) Colunas agregadas em jobs (espelhando movements_added/removed/changed
-- já existentes em 004_platform.sql) para os 3 novos kinds.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS movements_transferred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS movements_held        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS movements_released    INTEGER NOT NULL DEFAULT 0;

-- 6) Colunas de progresso usadas pelo worker durante runs longos.
-- (Bug pré-existente: worker.js faz UPDATE jobs SET progress_done=0... mas
-- essas colunas nunca foram declaradas em migrations anteriores. Adicionamos
-- aqui de forma idempotente para que a aplicação inicial em ambientes novos
-- não falhe.)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS progress_done   INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS progress_total  INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS progress_label  TEXT;
