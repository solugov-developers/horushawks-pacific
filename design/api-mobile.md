# Pacific Pocket · Módulo Mercado — contrato da API

Base: `https://app.horushawks.com/api/mobile/v1`
Auth: header `Authorization: Bearer <token>` (tokens da tabela `api_tokens` do HorusHawks; sha256 do token).
Erros: `{ "error": "mensagem" }` com 400/401/404. Datas em ISO 8601 (UTC). Números sempre numéricos (nunca string).

## GET /overview
```json
{
  "asOf": "2026-09-11T09:10:00Z",
  "totalSlabs": 12480, "weekDeltaPct": 3.1,
  "sourcesCovered": 6, "sourcesTotal": 7,
  "categories": 4, "locations": 19,
  "onHold": 1036, "onHoldPct": 8.3,
  "arrived7d": 412, "removed7d": 388,
  "sources": [ { "slug": "encore", "label": "Encore", "slabs": 3910, "lastJobAt": "2026-09-11T09:02:00Z", "stale": false } ]
}
```
`stale` = último job com mais de 36 h. `weekDeltaPct` pode ser `null` quando não há snapshot de 7 dias atrás.

## GET /sales?period=7|30|90&source=<slug|all>
Vendas inferidas = movimentos `removed`.
```json
{
  "period": 30, "totalSold": 1642, "prevTotalSold": 1506, "deltaPct": 9.0,
  "distinctMaterials": 214,
  "top": [ { "itemName": "Taj Mahal", "category": "Quartzite", "sold": 96, "sources": ["Encore","CRS"], "cumulativePct": 5.8 } ],
  "coverage": { "top10": 31.2, "top25": 52.0, "top50": 68.4 }
}
```
`top` tem até 50 itens, ordenado por `sold` desc.

## GET /inventory?q=<texto>&source=<slug|all>&page=1&pageSize=50
Estoque atual (último snapshot de cada fonte) agrupado por material.
```json
{
  "totalSlabs": 12480, "totalMaterials": 1180, "page": 1, "pageSize": 50,
  "sources": [ { "slug": "encore", "label": "Encore" } ],
  "rows": [ { "itemName": "Taj Mahal", "category": "Quartzite", "slabs": 184, "onHold": 12, "sources": ["Encore","CRS","VMC"], "locations": ["Dallas","Fort Worth","Lowell"] } ]
}
```
Ordenado por `slabs` desc. `q` busca por nome do material (ILIKE).

## GET /materials/<itemName URL-encoded>
```json
{
  "itemName": "Taj Mahal", "category": "Quartzite",
  "slabs": 184, "available": 172, "onHold": 12, "onHoldPct": 6.5,
  "arrived30d": 108, "removed30d": 96,
  "sources": [ { "slug": "encore", "label": "Encore", "slabs": 92, "locations": ["Dallas"], "thicknesses": ["2 cm","3 cm"] } ],
  "locations": ["Dallas","Fort Worth","Lowell"],
  "history": [ { "date": "2026-09-11", "kind": "added", "count": 12, "source": "Encore", "location": "Dallas", "detail": null } ]
}
```
`history` = últimos 20 grupos de movimentos deste material. 404 se não existir.

## GET /movements?kind=<all|added|removed|held|released|transferred|price_changed|qty_changed>&page=1&pageSize=50
Feed agrupado por (dia, tipo, material, fonte).
```json
{
  "asOf": "2026-09-11T09:10:00Z", "page": 1, "pageSize": 50, "total": 812,
  "rows": [ { "date": "2026-09-11", "kind": "added", "itemName": "Taj Mahal", "category": "Quartzite", "count": 12, "source": "Encore", "location": "Dallas", "detail": null } ]
}
```
`detail` traz texto extra quando existe: transfer → `"Dallas → The Colony"`, price_changed → `"$1,240 → $1,310"`.

## Rótulos no app (pt-BR)
added → "Chegou" (good) · removed → "Saiu" (bad) · held → "On hold" (warn) · released → "Liberado" (good) · transferred → "Transfer" (teal) · price_changed → "Preço" (soft) · qty_changed → "Qtd." (soft)
