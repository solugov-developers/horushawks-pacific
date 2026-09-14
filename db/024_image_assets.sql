-- ============================================================================
-- 024_image_assets.sql
-- Rastreio do pipeline de imagens (download -> auto-crop -> thumbnail -> S3).
-- Serve de CHECKPOINT: o job é resumível (processa só o que não está 'done').
-- Bucket privado; o app recebe URL pré-assinada gerada pela API mobile.
-- ============================================================================

CREATE TABLE IF NOT EXISTS image_assets (
  source_url text PRIMARY KEY,        -- image_url original (fornecedor)
  thumb_key  text,                    -- chave no S3: thumbs/<sha1>.jpg
  status     text NOT NULL DEFAULT 'pending',  -- pending | done | failed
  width      int,
  height     int,
  bytes      int,
  error      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_image_assets_status ON image_assets (status);
