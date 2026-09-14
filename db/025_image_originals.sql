-- ============================================================================
-- 025_image_originals.sql
-- Pipeline de imagens passa a guardar também o ORIGINAL recortado no S3
-- (originals/<sha1>.jpg, recorte na chapa, lado maior até 2000 px, JPEG 90),
-- além do thumbnail (thumbs/<sha1>.jpg). Motivo: as URLs dos fornecedores
-- expiram e o embedding do motor de pareamento precisa recalcular a partir
-- do S3, nunca do site de origem (docs/arquitetura-v2.md §4).
--
-- Linhas 'done' sem original_key voltam pra worklist do job imgpipe, que
-- completa o histórico de forma resumível.
-- ============================================================================

ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS original_key text;  -- S3: originals/<sha1>.jpg

CREATE INDEX IF NOT EXISTS idx_image_assets_missing_original
  ON image_assets (source_url) WHERE status = 'done' AND original_key IS NULL;
