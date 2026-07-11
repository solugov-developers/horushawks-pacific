-- ============================================================================
-- 013_tsi_enrich.sql
-- Enriquece thestoneindustry com dados do nível GALERIA (que o inventário por
-- bloco não traz): SubCategory e Thickness. Usa o novo stamp_from_item do engine
-- (carimba campos do item do loop em cada linha do inventário).
--   - category_name <- SubCategory  (Granite/Marble/Quartzite... em vez do
--     genérico "Natural Stone" que vinha em CategoryName)
--   - thickness     <- Thickness    (espessura, ex.: 2/3 cm)
-- Mantém source_key composto [item_id, bundle] (da 012). Cor NÃO existe neste
-- fornecedor (0/922), então fica de fora. Idempotente (reescreve as actions).
-- Requer o engine com suporte a stamp_from_item.
-- ============================================================================

UPDATE scrapers SET actions = $JSON$[
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
        "stamp_from_item": { "SubCategory": "SubCategory", "Thickness": "Thickness" },
        "append_to": "inventory"
      }
    ]
  },
  {
    "type": "save_rows", "from": "inventory", "table": "tsi_slabs",
    "source_key": ["item_id", "bundle"],
    "columns": {
      "item_id": "ItemID",
      "item_name": "ItemName",
      "category_name": "SubCategory",
      "bundle": "IDOne",
      "thickness": "Thickness",
      "location": "SELECTEDLocation",
      "available_qty": "AvailableQty",
      "available_slabs": "AvailableSlabs",
      "average_length": "AverageLength",
      "average_width": "AverageWidth",
      "uom": "UOM"
    }
  }
]$JSON$::jsonb, updated_at = now()
WHERE name = 'thestoneindustry';

SELECT name,
       (elem->'columns'->>'category_name') AS category_map,
       (elem->'columns'->>'thickness') AS thickness_map,
       (elem ? 'source_key') AS tem_source_key
FROM scrapers s, jsonb_array_elements(s.actions::jsonb) elem
WHERE s.name = 'thestoneindustry' AND elem->>'type' = 'save_rows';
