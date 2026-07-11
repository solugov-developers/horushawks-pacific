-- ============================================================================
-- 011_thestoneindustry.sql
-- Novo scraper: The Stone Industry (thestoneindustry.stoneprofitsweb.com)
-- Plataforma StoneProfits — MESMA API do crs/nsr:
--   https://thestoneindustry.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx
-- Descoberto via Playwright (site atrás de Cloudflare, sem login público):
--   - getItemGallery: POST, InventoryGroupBy=IDOne_, header Authorization -> 922 produtos
--   - labels do tenant: IDOne=Block, IDTwo=Bundle, IDThree=Slab Number, SerialPrefix=Serial
--   - exige token de Authorization (preencher vars.auth_token — igual crs/nsr)
--
-- SCHEMA CONFIRMADO (via Playwright, com token real, capturando a chamada da
-- própria página): getItemInventory é agrupado por BLOCO (IDOne_) e retorna:
--   SELECTEDLocation, CategoryName, ProductFormValue, ItemName, ItemID, FileName,
--   IDOne, CustomID, FileID, AverageLength, AverageWidth, AvailableQty, UOM,
--   AvailableSlabs, WebCartID, LengthUnitsSymbol, Barcode
-- NÃO há SerialNumber/SerialPrefix/IDTwo/Color/Thickness/Price neste tenant.
-- O identificador é IDOne (ex.: "PBR36536" = bloco) -> mapeado em bundle
-- (source_key = bundle). Cada linha = 1 bloco com N chapas (AvailableSlabs).
-- Params do getItemInventory validados (200): TrimmedUserID é irrelevante;
-- DetailLocation/SelctdLocation=undefined são necessários (sem eles: erro SQL).
-- ============================================================================

-- 1) tabela por-chapa (mesmo shape das outras)
DO $$
BEGIN
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS tsi_slabs (
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
      extra           JSONB NOT NULL DEFAULT ''{}''::jsonb
    )');
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_tsi_slabs_job ON tsi_slabs (job_id)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_tsi_slabs_item ON tsi_slabs (item_id)';
END$$;

-- 2) o scraper
INSERT INTO scrapers (name, description, url, actions, vars, schedule, enabled) VALUES (
  'thestoneindustry',
  'The Stone Industry - Stone Profits POST autenticado (gallery IDOne_)',
  'https://thestoneindustry.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx',
  $JSON$[
    {
      "type": "fetch_json",
      "method": "POST",
      "url": "https://thestoneindustry.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx",
      "headers": {
        "Content-Type": "application/json",
        "Authorization": "{{vars.auth_token}}"
      },
      "query_params": {
        "act": "getItemGallery",
        "WebconnectSettingID": "1",
        "InventoryGroupBy": "IDOne_",
        "SearchbyItemIdentifiers": "on",
        "SearchbyFinish": "on",
        "SearchbySKU": "on",
        "OnHold": "null", "OnSO": "null", "Intransit": "null",
        "showNotInStock": "null",
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
          "url": "https://thestoneindustry.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx",
          "headers": { "Authorization": "{{vars.auth_token}}" },
          "query_params": {
            "act": "getItemInventory",
            "WebconnectSettingID": "1",
            "id": "{{item.ItemID}}",
            "InventoryGroupBy": "IDOne_",
            "TrimmedUserID": "{{vars.trimmed_user_id}}",
            "OnHold": "null", "OnSO": "null", "Intransit": "null",
            "SelctdLocation": "undefined",
            "ShowLocationinGallery": "null",
            "LotPicturesRestrictToSIPL": "False",
            "q": "{{now}}",
            "DetailLocation": "undefined"
          },
          "append_to": "inventory"
        }
      ]
    },
    {
      "type": "save_rows", "from": "inventory", "table": "tsi_slabs",
      "columns": {
        "item_id": "ItemID",
        "item_name": "ItemName",
        "category_name": "CategoryName",
        "bundle": "IDOne",
        "location": "SELECTEDLocation",
        "available_qty": "AvailableQty",
        "available_slabs": "AvailableSlabs",
        "average_length": "AverageLength",
        "average_width": "AverageWidth",
        "uom": "UOM"
      }
    }
  ]$JSON$::jsonb,
  '{"auth_token": "", "trimmed_user_id": "random16"}'::jsonb,
  '0 1 * * *', true
)
ON CONFLICT (name) DO UPDATE SET
  url=EXCLUDED.url, actions=EXCLUDED.actions,
  vars=COALESCE(NULLIF(scrapers.vars, '{}'::jsonb), EXCLUDED.vars),
  description=EXCLUDED.description, updated_at=now();

-- 3) Pós-1º-job: confirmar os campos de identidade reais (igual fizemos no fix):
--   SELECT jsonb_object_keys(payload) k, count(*) FROM slabs_history h
--     JOIN scrapers s ON s.id=h.scraper_id AND s.name='thestoneindustry'
--     GROUP BY k ORDER BY 2 DESC;
--   -- e conferir se serial_number/bundle vieram preenchidos; se não, reapontar
--   -- para o campo populado (IDOne/IDThree/SerialNumber/etc).
