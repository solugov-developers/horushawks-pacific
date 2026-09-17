-- ============================================================================
-- 026_pacshore.sql
-- Fonte própria: catálogo público da Pacific Shore Stones (vitrine WebConnect
-- em https://inventory.pacificshorestones.com, API pacshore.stoneprofits.com).
-- Mesma plataforma StoneProfits de crs/nsr/encore/tsi; receita copiada da TSI
-- (db/013) com capa da galeria -> image_url (db/022).
--
-- Descoberto via Playwright (vitrine atrás do Cloudflare), 2026-09-14:
--   - config da vitrine: sps115production.stoneprofitsweb.com/pacificshorestones/app.js
--     (Token = 'pacshore'); API: pacshore.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx
--   - getSettings: FilePath = https://s3.us-east-2.amazonaws.com/pacshorewest-sps-files/
--     labels: IDOne=Lot, IDTwo=BUNDLE, IDThree=Sup Ref, SerialPrefix=Serial
--   - getItemGallery POST (InventoryGroupBy=IDOne_Lot_): 4.408 linhas (item x local),
--     2.144 ItemID distintos, 98% com Filename (capa). ItemName == erp.stock.product
--     em 2.136/2.144 (mesmo tenant) -> cruzamento por nome exato no BFF.
--   - getItemInventory (IDOne_Lot_): 1 linha por lote/bundle: SerialPrefix (lote),
--     IDOne (bundle), FileName (foto da chapa), AverageLength/Width, AvailableQty,
--     AvailableSlabs, UOM; SELECTEDLocation vem vazio neste tenant.
--   - source_key = [item_id, serial_number(lote), bundle].
--
-- É a PRÓPRIA Pacific, não concorrente: scrapers.kind = 'own' e o módulo
-- Mercado (overview/sales/inventory/movements/status) filtra kind = 'competitor'.
-- Token de Authorization (80 chars) entra por db/secrets.sql (gitignored).
-- ============================================================================

BEGIN;

-- 1) flag de tipo de fonte
ALTER TABLE scrapers ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'competitor';
COMMENT ON COLUMN scrapers.kind IS 'competitor (entra no módulo Mercado) | own (a própria Pacific; só imagens/pareamento)';

-- 2) tabela por-lote (mesmo shape das outras *_slabs, já com finish/image_url)
CREATE TABLE IF NOT EXISTS pacshore_slabs (
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
CREATE INDEX IF NOT EXISTS idx_pacshore_slabs_job  ON pacshore_slabs (job_id);
CREATE INDEX IF NOT EXISTS idx_pacshore_slabs_item ON pacshore_slabs (item_id);

-- 3) o scraper (02:30 UTC, meia hora depois dos concorrentes)
INSERT INTO scrapers (name, description, url, actions, vars, schedule, enabled, kind) VALUES (
  'pacshore',
  'Pacific Shore Stones (própria) - catálogo público StoneProfits (gallery IDOne_Lot_), fotos p/ o app',
  'https://pacshore.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx',
  $JSON$[
    {
      "type": "fetch_json",
      "method": "POST",
      "url": "https://pacshore.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx",
      "headers": {
        "Content-Type": "application/json",
        "Authorization": "{{vars.auth_token}}"
      },
      "query_params": {
        "act": "getItemGallery",
        "WebconnectSettingID": "1",
        "InventoryGroupBy": "IDOne_Lot_",
        "SearchbyItemIdentifiers": "null",
        "ShowFeatureProductOnTop": "null",
        "SearchbyFinish": "on",
        "SearchbySKU": "on",
        "OnHold": "null", "OnSO": "null", "Intransit": "null",
        "showNotInStock": "null",
        "Alphabet": "",
        "q": "{{now}}"
      },
      "body_json": {},
      "save_as": "gallery"
    },
    {
      "type": "loop", "over": "gallery", "as": "item", "dedupe_by": "ItemID",
      "actions": [
        {
          "type": "fetch_json",
          "method": "GET",
          "url": "https://pacshore.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx",
          "headers": { "Authorization": "{{vars.auth_token}}" },
          "query_params": {
            "act": "getItemInventory",
            "WebconnectSettingID": "1",
            "id": "{{item.ItemID}}",
            "InventoryGroupBy": "IDOne_Lot_",
            "TrimmedUserID": "{{vars.trimmed_user_id}}",
            "OnHold": "null", "OnSO": "null", "Intransit": "null",
            "SelctdLocation": "undefined",
            "ShowLocationinGallery": "null",
            "LotPicturesRestrictToSIPL": "True",
            "q": "{{now}}",
            "DetailLocation": "undefined"
          },
          "stamp_from_item": { "Thickness": "Thickness", "Color": "Color", "CoverFilename": "Filename" },
          "append_to": "inventory"
        }
      ]
    },
    {
      "type": "save_rows", "from": "inventory", "table": "pacshore_slabs",
      "source_key": ["item_id", "serial_number", "bundle"],
      "columns": {
        "item_id": "ItemID",
        "item_name": "ItemName",
        "category_name": "CategoryName",
        "serial_number": "SerialPrefix",
        "bundle": "IDOne",
        "thickness": "Thickness",
        "color": "Color",
        "location": "SELECTEDLocation",
        "available_qty": "AvailableQty",
        "available_slabs": "AvailableSlabs",
        "average_length": "AverageLength",
        "average_width": "AverageWidth",
        "uom": "UOM",
        "image_url": "https://s3.us-east-2.amazonaws.com/pacshorewest-sps-files/{{CoverFilename|url}}"
      }
    }
  ]$JSON$::jsonb,
  '{"auth_token": "", "trimmed_user_id": "random16"}'::jsonb,
  '30 2 * * *', true, 'own'
)
ON CONFLICT (name) DO UPDATE SET
  url=EXCLUDED.url, actions=EXCLUDED.actions, kind='own', schedule=EXCLUDED.schedule,
  vars=COALESCE(NULLIF(scrapers.vars, '{}'::jsonb), EXCLUDED.vars),
  description=EXCLUDED.description, updated_at=now();

COMMIT;

SELECT name, kind, enabled, schedule, length(vars->>'auth_token') AS tok_len FROM scrapers WHERE name = 'pacshore';
