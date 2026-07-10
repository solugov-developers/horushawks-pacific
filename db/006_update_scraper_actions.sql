-- ============================================================
-- 006: atualiza actions dos scrapers existentes para mapear
--      on_hold / on_so / in_transit + location (onde faltava).
--
-- Aplicar após 005. Idempotente (UPDATE por nome).
--
-- Stone Profits (encore/crs/nsr) tem confiança alta dos field names
-- (URL params confirmam OnHold, OnSO, Intransit no payload).
-- VMC tem confiança alta para LocationName/Availability.
-- granitedistributor e zucchistones precisam inspeção manual de
-- payload antes de atualizar — não tocados nesta migration.
-- ============================================================

-- ------------------------------------------------------------
-- ENCORE
-- ------------------------------------------------------------
UPDATE scrapers SET actions = $JSON$[
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
      "price_1":         "Price1",
      "on_hold":         "OnHold",
      "on_so":           "OnSO",
      "in_transit":      "Intransit"
    }
  }
]$JSON$::jsonb, updated_at = now()
WHERE name = 'encore';

-- ------------------------------------------------------------
-- CRS
-- ------------------------------------------------------------
UPDATE scrapers SET actions = $JSON$[
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
    "type": "loop", "over": "gallery", "as": "item", "dedupe_by": "ItemID",
    "actions": [
      {
        "type": "fetch_json",
        "method": "GET",
        "url": "https://crsaustin.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx",
        "headers": { "Authorization": "{{vars.auth_token}}" },
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
      "price": "Price1", "uom": "UOM",
      "on_hold": "OnHold", "on_so": "OnSO", "in_transit": "Intransit"
    }
  }
]$JSON$::jsonb, updated_at = now()
WHERE name = 'crs';

-- ------------------------------------------------------------
-- NSR
-- ------------------------------------------------------------
UPDATE scrapers SET actions = $JSON$[
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
      "price": "Price1", "uom": "UOM",
      "on_hold": "OnHold", "on_so": "OnSO", "in_transit": "Intransit"
    }
  }
]$JSON$::jsonb, updated_at = now()
WHERE name = 'nsr';

-- ------------------------------------------------------------
-- VMCSTONE
-- Adiciona location (LocationName) e on_hold derivado de Availability.
-- Note: Availability vem como string ("InStock", "OnHold", ...). O worker
-- coercionará para boolean baseado em palavras-chave (ver coerceBool em
-- worker/worker.js).
-- ------------------------------------------------------------
UPDATE scrapers SET actions = $JSON$[
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
      "location": "LocationName",
      "thickness": "Thickness",
      "available_qty": "AvailableQty", "available_slabs": "AvailableSlabs",
      "average_length": "AverageLength", "average_width": "AverageWidth",
      "on_hold": "Availability"
    }
  }
]$JSON$::jsonb, updated_at = now()
WHERE name = 'vmcstone';

-- ------------------------------------------------------------
-- granitedistributor e zucchistones: NÃO atualizados aqui.
-- Field names precisam ser confirmados via DevTools antes de mapear.
-- Quando confirmar, escreva 007_*.sql com os UPDATEs equivalentes.
-- ------------------------------------------------------------
