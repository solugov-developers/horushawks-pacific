-- ============================================================================
-- 031_imperialtile.sql
-- Fonte nova (pedido da Pacific, 2026-09-18): Imperial Tile (North Hollywood,
-- CA) — loja Shopify com JSON público:
--   https://shopimperialtile.com/collections/luxury-premium-slabs/products.json?limit=250&page=N
--   56 produtos numa página; pagina até vir vazio (paginate_until + accumulate).
-- 1 linha = 1 PRODUTO de catálogo (não uma chapa): lib/sources.ts unit='products'.
-- Mapeamento (filtros novos do worker {{campo|tag:Prefixo_}} e {{arr|anytrue:campo}}):
--   item_name=title · category_name=tag Material_ (fallback product_type) ·
--   color=tag Color_ · finish=tag Finish_ · price=variants[0].price ·
--   serial_number=variants[0].sku · available_slabs/available_qty=1 se alguma
--   variante disponível · image_url=images[0].src · source_key=id ·
--   location='California' (site: "California 91605") · uom='PRODUCTS'.
-- Dimensões (tag Size_, ex. 61x126) ficam no payload de slabs_history (tags).
-- ============================================================================

CREATE TABLE IF NOT EXISTS imperialtile_slabs (
  id              SERIAL PRIMARY KEY,
  job_id          INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  scraper_id      INT NOT NULL REFERENCES scrapers(id) ON DELETE CASCADE,
  scraped_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  item_id         BIGINT,
  item_name       TEXT,
  category_name   TEXT,
  serial_number   TEXT,
  bundle          TEXT,
  color           TEXT,
  location        TEXT,
  thickness       TEXT,
  finish          TEXT,
  image_url       TEXT,
  available_qty   NUMERIC,
  available_slabs INTEGER,
  average_length  NUMERIC,
  average_width   NUMERIC,
  price           NUMERIC,
  price_range     TEXT,
  uom             TEXT,
  extra           JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_imperialtile_slabs_job  ON imperialtile_slabs (job_id);
CREATE INDEX IF NOT EXISTS idx_imperialtile_slabs_item ON imperialtile_slabs (item_id);

INSERT INTO scrapers (name, description, url, actions, vars, schedule, enabled, kind) VALUES (
  'imperialtile',
  'Imperial Tile (North Hollywood, CA) - Shopify products.json (1 linha = 1 produto)',
  'https://shopimperialtile.com/collections/luxury-premium-slabs/products.json',
  $JSON$[
    {
      "type": "paginate_until",
      "page_var": "page",
      "page_offset": 1,
      "max_pages": 20,
      "current_count_in": "products",
      "stop_when_empty": true,
      "actions": [
        {
          "type": "fetch_json",
          "method": "GET",
          "url": "https://shopimperialtile.com/collections/luxury-premium-slabs/products.json?limit=250&page={{vars.page}}",
          "headers": { "Accept": "application/json" },
          "save_as": "page_resp"
        },
        { "type": "accumulate", "from": "page_resp.products", "into": "products", "required": false }
      ]
    },
    {
      "type": "save_rows", "from": "products", "table": "imperialtile_slabs",
      "source_key": ["item_id"],
      "columns": {
        "item_id":         "id",
        "item_name":       "title",
        "category_name":   ["{{tags|tag:Material_}}", "product_type"],
        "color":           "{{tags|tag:Color_}}",
        "finish":          "{{tags|tag:Finish_}}",
        "serial_number":   "variants.0.sku",
        "price":           "variants.0.price",
        "available_slabs": "{{variants|anytrue:available}}",
        "available_qty":   "{{variants|anytrue:available}}",
        "image_url":       "images.0.src"
      },
      "constants": { "location": "California", "uom": "PRODUCTS" }
    }
  ]$JSON$::jsonb,
  '{}'::jsonb,
  '15 1 * * *', true, 'competitor'
)
ON CONFLICT (name) DO UPDATE SET
  url=EXCLUDED.url, actions=EXCLUDED.actions, kind='competitor', schedule=EXCLUDED.schedule,
  description=EXCLUDED.description, updated_at=now();

-- category_name: lista de alternativas (novo no worker): tag Material_, senão product_type.
SELECT name, kind, schedule FROM scrapers WHERE name = 'imperialtile';
