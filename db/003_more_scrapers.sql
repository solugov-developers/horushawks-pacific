-- ============================================================
-- 5 robôs novos (crs, nsr, granitedistributor, vmc, zucchi)
-- Schema padronizado por fornecedor com colunas comuns + extra jsonb.
-- ============================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'crs_slabs',
    'nsr_slabs',
    'granitedistributor_slabs',
    'vmcstone_slabs',
    'zucchistones_slabs'
  ] LOOP
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I (
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
      )', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (job_id)', 'idx_'||t||'_job', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (item_id)', 'idx_'||t||'_item', t);
  END LOOP;
END$$;


-- ============================================================
-- CRS (Stone Profits POST + Authorization)
-- ============================================================
INSERT INTO scrapers (name, description, url, actions, vars, schedule, enabled) VALUES (
  'crs',
  'CRS Granite (Austin) - Stone Profits POST autenticado',
  'https://crsaustin.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx',
  $JSON$[
    {
      "type": "fetch_json",
      "method": "POST",
      "url": "https://crsaustin.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx",
      "headers": {
        "Content-Type": "application/json",
        "Authorization": "{{vars.auth_token}}"
      },
      "query_params": {
        "act": "getItemGallery",
        "WebconnectSettingID": "1",
        "InventoryGroupBy": "IDOne_",
        "q": "{{now}}"
      },
      "body_json": {},
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
          "method": "GET",
          "url": "https://crsaustin.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx",
          "headers": {
            "Authorization": "{{vars.auth_token}}"
          },
          "query_params": {
            "act": "getItemInventory",
            "WebconnectSettingID": "1",
            "id": "{{item.ItemID}}",
            "InventoryGroupBy": "IDTwo_Lot_",
            "TrimmedUserID": "{{vars.trimmed_user_id}}",
            "OnHold": "null", "OnSO": "null", "Intransit": "null",
            "SelctdLocation": "null", "ShowLocationinGallery": "on",
            "LotPicturesRestrictToSIPL": "True",
            "q": "{{now}}", "DetailLocation": "null"
          },
          "append_to": "inventory"
        }
      ]
    },
    {
      "type": "save_rows", "from": "inventory", "table": "crs_slabs",
      "columns": {
        "item_id": "ItemID", "item_name": "ItemName", "category_name": "CategoryName",
        "serial_number": "SerialNumber", "color": "Color", "location": "Location",
        "thickness": "Thickness",
        "available_qty": "AvailableQty", "available_slabs": "AvailableSlabs",
        "average_length": "AverageLength", "average_width": "AverageWidth",
        "price": "Price1", "uom": "UOM"
      }
    }
  ]$JSON$::jsonb,
  -- vars deve ser preenchido depois via db/secrets.sql ou /scrapers/:id/edit
  '{"auth_token": "", "trimmed_user_id": "random16"}'::jsonb,
  NULL, true
)
ON CONFLICT (name) DO UPDATE SET
  url=EXCLUDED.url, actions=EXCLUDED.actions,
  -- preserva vars existentes (com tokens já configurados)
  vars=COALESCE(NULLIF(scrapers.vars, '{}'::jsonb), EXCLUDED.vars),
  description=EXCLUDED.description, updated_at=now();


-- ============================================================
-- NSR (Stone Profits POST gallery + GET inventory)
-- ============================================================
INSERT INTO scrapers (name, description, url, actions, vars, schedule, enabled) VALUES (
  'nsr',
  'NSR Stone - Stone Profits POST autenticado',
  'https://nsrstone.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx',
  $JSON$[
    {
      "type": "fetch_json",
      "method": "POST",
      "url": "https://nsrstone.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx",
      "headers": {
        "Content-Type": "application/json",
        "Authorization": "{{vars.auth_token}}",
        "Origin": "https://slabs.nsrstone.com",
        "Referer": "https://slabs.nsrstone.com/",
        "Accept": "*/*",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15"
      },
      "query_params": {
        "act": "getItemGallery",
        "WebconnectSettingID": "1",
        "InventoryGroupBy": "IDTwo_Lot_",
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
          "url": "https://nsrstone.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx",
          "headers": {
            "Authorization": "{{vars.auth_token}}",
            "Origin": "https://slabs.nsrstone.com",
            "Referer": "https://slabs.nsrstone.com/"
          },
          "query_params": {
            "act": "getItemInventory",
            "WebconnectSettingID": "1",
            "id": "{{item.ItemID}}",
            "InventoryGroupBy": "IDTwo_Lot_",
            "TrimmedUserID": "{{vars.trimmed_user_id}}",
            "OnHold": "null", "OnSO": "null", "Intransit": "null",
            "SelctdLocation": "null", "ShowLocationinGallery": "on",
            "LotPicturesRestrictToSIPL": "True",
            "q": "{{now}}", "DetailLocation": "null"
          },
          "append_to": "inventory"
        }
      ]
    },
    {
      "type": "save_rows", "from": "inventory", "table": "nsr_slabs",
      "columns": {
        "item_id": "ItemID", "item_name": "ItemName", "category_name": "CategoryName",
        "serial_number": "SerialNumber", "color": "Color", "location": "Location",
        "thickness": "Thickness",
        "available_qty": "AvailableQty", "available_slabs": "AvailableSlabs",
        "average_length": "AverageLength", "average_width": "AverageWidth",
        "price": "Price1", "uom": "UOM"
      }
    }
  ]$JSON$::jsonb,
  -- vars deve ser preenchido depois via db/secrets.sql ou /scrapers/:id/edit
  '{"auth_token": "", "trimmed_user_id": ""}'::jsonb,
  NULL, true
)
ON CONFLICT (name) DO UPDATE SET
  url=EXCLUDED.url, actions=EXCLUDED.actions,
  vars=COALESCE(NULLIF(scrapers.vars, '{}'::jsonb), EXCLUDED.vars),
  description=EXCLUDED.description, updated_at=now();


-- ============================================================
-- GRANITE DISTRIBUTOR (HTML scrape com regex)
-- ============================================================
INSERT INTO scrapers (name, description, url, actions, vars, schedule, enabled) VALUES (
  'granitedistributor',
  'Granite Distributor (Everest Stone) - JSON embebido no HTML',
  'https://inventory.granitedistributor.com/',
  $JSON$[
    {
      "type": "fetch_text",
      "method": "GET",
      "url": "https://inventory.granitedistributor.com/",
      "headers": {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        "Accept": "text/html"
      },
      "save_as": "html"
    },
    {
      "type": "extract_match",
      "from": "html",
      "pattern": "JSON\\.parse\\('(\\[\\{.*?\\}\\])'\\)",
      "flags": "s",
      "parse": "json",
      "save_as": "bundles",
      "group": 1
    },
    {
      "type": "save_rows", "from": "bundles", "table": "granitedistributor_slabs",
      "columns": {
        "item_id": "ItemID", "item_name": "ItemName", "category_name": "CategoryName",
        "bundle": "Bundle", "color": "Color", "thickness": "Thickness",
        "available_qty": "AvailableQty", "available_slabs": "AvailableSlabs",
        "average_length": "AverageLength", "average_width": "AverageWidth",
        "price_range": "PriceRange"
      }
    }
  ]$JSON$::jsonb,
  '{}'::jsonb,
  NULL, true
)
ON CONFLICT (name) DO UPDATE SET
  url=EXCLUDED.url, actions=EXCLUDED.actions, vars=EXCLUDED.vars,
  description=EXCLUDED.description, updated_at=now();


-- ============================================================
-- VMCSTONE (lista SKUs + loop de bundles via POST form)
-- ============================================================
INSERT INTO scrapers (name, description, url, actions, vars, schedule, enabled) VALUES (
  'vmcstone',
  'VMC Stone - inventário paginado via POST form-urlencoded',
  'https://vmcstone.com/ci/index.php/apiRedesign/current_inventory/',
  $JSON$[
    {
      "type": "fetch_json",
      "method": "GET",
      "url": "https://vmcstone.com/ci/index.php/apiRedesign/current_inventory/?&role=&isLoggedIn=no&sortBy=featured&initial=false&Availability=All%20Inventory&AvailableSlabs=&ItemGroupValue=&SubCategoryValue=",
      "headers": {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Origin": "https://vmcstone.com",
        "Referer": "https://vmcstone.com/product-catalog/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        "X-Requested-With": "XMLHttpRequest"
      },
      "save_as": "inventory_resp"
    },
    {
      "type": "loop", "over": "inventory_resp.results", "as": "item", "dedupe_by": "SKU",
      "actions": [
        {
          "type": "fetch_json",
          "method": "POST",
          "url": "https://vmcstone.com/ci/index.php/apiRedesign/instock_bundles",
          "headers": {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Origin": "https://vmcstone.com",
            "Referer": "https://vmcstone.com/product-catalog/",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
            "X-Requested-With": "XMLHttpRequest"
          },
          "body_form": {
            "isLoggedIn": "false",
            "ItemSKU": "{{item.SKU}}",
            "sortoption": "",
            "Availability": "all",
            "serachbundle": "",
            "LocationName": "All",
            "web_name": "{{item.SKU}}"
          },
          "save_as": "bundle_resp"
        },
        {
          "type": "accumulate",
          "from": "bundle_resp.results",
          "into": "bundles",
          "required": false
        }
      ]
    },
    {
      "type": "save_rows", "from": "bundles", "table": "vmcstone_slabs",
      "columns": {
        "item_name": "ItemName", "category_name": "CategoryName",
        "bundle": "Bundle", "color": "Color",
        "thickness": "Thickness",
        "available_qty": "AvailableQty", "available_slabs": "AvailableSlabs",
        "average_length": "AverageLength", "average_width": "AverageWidth"
      }
    }
  ]$JSON$::jsonb,
  '{}'::jsonb,
  NULL, true
)
ON CONFLICT (name) DO UPDATE SET
  url=EXCLUDED.url, actions=EXCLUDED.actions, vars=EXCLUDED.vars,
  description=EXCLUDED.description, updated_at=now();


-- ============================================================
-- ZUCCHISTONES (1 chamada Apex Salesforce)
-- ============================================================
INSERT INTO scrapers (name, description, url, actions, vars, schedule, enabled) VALUES (
  'zucchistones',
  'Zucchi Luxury Stones (USA) - Salesforce Apex POST',
  'https://inventoryusa.zucchistones.com/webruntime/api/apex/execute',
  $JSON$[
    {
      "type": "fetch_json",
      "method": "POST",
      "url": "https://inventoryusa.zucchistones.com/webruntime/api/apex/execute?language=en-US&asGuest=true&htmlEncode=false",
      "headers": {
        "Content-Type": "application/json",
        "Accept": "*/*",
        "Origin": "https://inventoryusa.zucchistones.com",
        "Referer": "https://inventoryusa.zucchistones.com/products",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        "X-Requested-With": "XMLHttpRequest"
      },
      "body_json": {
        "namespace": "",
        "classname": "@udd/01p8X000004WUED",
        "method": "buscaProds_WishlistWithTime",
        "isContinuation": false,
        "params": {
          "chvLocation": "62dK&iG*e1*$DET$J&@6Bcl&JSVY6TXNYK(1#jAT",
          "idContact": "",
          "pagination": "0",
          "chvWishlist": null,
          "qtdRegs": 1000,
          "filters": null,
          "order": null,
          "searchTerm": null,
          "standardLocation": "USA",
          "contarProds": true
        },
        "cacheable": false
      },
      "save_as": "resp"
    },
    {
      "type": "save_rows",
      "from": "resp.returnValue.itens",
      "table": "zucchistones_slabs",
      "columns": {
        "item_name":       "prod.Stock_Item__r.Produto__r.NomeMaterialEn__c",
        "category_name":   "prod.Stock_Item__r.Produto__r.FamilyVitrine__c",
        "bundle":          "prod.Stock_Item__r.Name",
        "thickness":       "prod.Stock_Item__r.Espessura__c",
        "available_qty":   "prod.Stock_Item__r.MetragemLiquidaFt2__c",
        "available_slabs": "prod.Stock_Item__r.QuantidadeChapas__c"
      }
    }
  ]$JSON$::jsonb,
  '{}'::jsonb,
  NULL, true
)
ON CONFLICT (name) DO UPDATE SET
  url=EXCLUDED.url, actions=EXCLUDED.actions, vars=EXCLUDED.vars,
  description=EXCLUDED.description, updated_at=now();
