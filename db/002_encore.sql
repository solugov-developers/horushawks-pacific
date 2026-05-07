ALTER TABLE scrapers
  ADD COLUMN IF NOT EXISTS vars JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS encore_slabs (
  id              SERIAL PRIMARY KEY,
  job_id          INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  scraper_id      INT NOT NULL REFERENCES scrapers(id) ON DELETE CASCADE,
  scraped_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  item_id         INT,
  serial_number   TEXT,
  item_name       TEXT,
  category_name   TEXT,
  product_form    TEXT,
  location        TEXT,
  location_id     INT,
  available_qty   NUMERIC,
  uom             TEXT,
  available_slabs INT,
  average_length  NUMERIC,
  average_width   NUMERIC,
  price_1         NUMERIC,
  extra           JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_encore_slabs_job ON encore_slabs (job_id);
CREATE INDEX IF NOT EXISTS idx_encore_slabs_item ON encore_slabs (item_id);
CREATE INDEX IF NOT EXISTS idx_encore_slabs_serial ON encore_slabs (serial_number);

INSERT INTO scrapers (name, description, url, actions, vars, schedule, enabled)
VALUES (
  'encore',
  'Encore (Pacshore East) - galeria + inventario por ItemID',
  'https://pacshoreeast.stoneprofits.com/custom/pacshoreeast/FetchDataWebV1.ashx',
  $JSON$[
    {
      "type": "fetch_json",
      "url": "https://pacshoreeast.stoneprofits.com/custom/pacshoreeast/FetchDataWebV1.ashx?act=getItemGallery&InventoryGroupBy=SerialNumber_&SearchbyItemIdentifiers=on&SearchbyFinish=on&SearchbySKU=on&OnHold=null&OnSO=null&Intransit=null&showNotInStock=null",
      "save_as": "gallery"
    },
    {
      "type": "loop",
      "over": "gallery",
      "as": "item",
      "dedupe_by": "ItemID",
      "actions": [
        {
          "type": "fetch_json",
          "url": "https://pacshoreeast.stoneprofits.com/custom/pacshoreeast/FetchDataWebV1.ashx?act=getItemInventory&hidelocations=4&id={{item.ItemID}}&InventoryGroupBy=SerialNumber_&TrimmedUserID={{vars.trimmedUserId}}&OnHold=null&OnSO=null&Intransit=null&SelectedLocation=&ShowLocationinGallery=on&LotPicturesRestrictToSIPL=True&q={{now}}",
          "append_to": "inventory"
        }
      ]
    },
    {
      "type": "save_rows",
      "from": "inventory",
      "table": "encore_slabs",
      "columns": {
        "item_id":         "ItemID",
        "serial_number":   "SerialNumber",
        "item_name":       "ItemName",
        "category_name":   "CategoryName",
        "product_form":    "ProductFormValue",
        "location":        "Location",
        "location_id":     "LocationID",
        "available_qty":   "AvailableQty",
        "uom":             "UOM",
        "available_slabs": "AvailableSlabs",
        "average_length":  "AverageLength",
        "average_width":   "AverageWidth",
        "price_1":         "Price1"
      }
    }
  ]$JSON$::jsonb,
  '{"trimmedUserId": "random16"}'::jsonb,
  NULL,
  true
)
ON CONFLICT (name) DO UPDATE
SET url        = EXCLUDED.url,
    actions    = EXCLUDED.actions,
    vars       = EXCLUDED.vars,
    description= EXCLUDED.description,
    updated_at = now();
