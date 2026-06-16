-- ============================================================
-- IRG Stone (irgstone.com) - WooCommerce Store API REST
-- ============================================================
-- Catálogo WordPress/WooCommerce com endpoint público em
-- /wp-json/wc/store/v1/products. Cada produto é tratado como
-- single slab (atributo "Status: SINGLE SLAB" + atributo "lot"
-- como serial number). 3 warehouses fisicos em CA (Brisbane,
-- Dublin, Sacramento) sem identificacao por produto na API;
-- location e setada como "California" (genérica).
-- ============================================================

CREATE TABLE IF NOT EXISTS irgstone_slabs (
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
  available_qty   NUMERIC,
  available_slabs INTEGER,
  average_length  NUMERIC,
  average_width   NUMERIC,
  price           NUMERIC,
  price_range     TEXT,
  uom             TEXT,
  extra           JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_irgstone_slabs_job ON irgstone_slabs (job_id);
CREATE INDEX IF NOT EXISTS idx_irgstone_slabs_item ON irgstone_slabs (item_id);


-- ============================================================
-- Scraper config
-- ============================================================
INSERT INTO scrapers (name, description, url, actions, vars, schedule, enabled) VALUES (
  'irgstone',
  'IRG Stone (California) - WooCommerce Store API REST (Cloudflare via browser)',
  'https://irgstone.com/',
  $JSON$[
    {
      "type": "paginate_until",
      "page_var": "page",
      "page_offset": 1,
      "max_pages": 30,
      "current_count_in": "products",
      "stop_when_empty": true,
      "actions": [
        {
          "type": "browser_get_json",
          "url": "https://irgstone.com/wp-json/wc/store/v1/products?per_page=100&page={{vars.page}}",
          "save_as": "page_resp"
        },
        {
          "type": "accumulate",
          "from": "page_resp",
          "into": "products",
          "required": false
        }
      ]
    },
    {
      "type": "save_rows",
      "from": "products",
      "table": "irgstone_slabs",
      "columns": {
        "item_id":        "id",
        "item_name":      "name",
        "category_name":  "categories.0.name",
        "serial_number":  "attributes.1.terms.0.name",
        "color":          "attributes.2.terms.0.name",
        "thickness":      "attributes.4.terms.0.name",
        "price_range":    "prices.price_range"
      },
      "constants": {
        "location":        "California",
        "available_slabs": 1,
        "available_qty":   1,
        "uom":             "SLABS"
      }
    }
  ]$JSON$::jsonb,
  '{}'::jsonb,
  '0 1 * * *', true
)
ON CONFLICT (name) DO UPDATE SET
  url=EXCLUDED.url, actions=EXCLUDED.actions, vars=EXCLUDED.vars,
  description=EXCLUDED.description, updated_at=now();
