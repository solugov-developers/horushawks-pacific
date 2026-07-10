# HorusHawks · Data Gap Analysis

Cruzamento entre o que os relatórios PDF (VMC, Encore Feb 2026) entregam e o que os 6 scrapers atuais capturam hoje. Objetivo: identificar exatamente o que precisa mudar no pipeline de scraping/persistência antes (ou em paralelo) ao redesign do painel.

Auditado em: `db/002_encore.sql`, `db/003_more_scrapers.sql`, `db/004_platform.sql`, `worker/worker.js`.

---

## TL;DR

**Boa notícia:** o `payload jsonb` em `slabs_history` e o `extra jsonb` em `<source>_slabs` recebem TUDO o que não foi mapeado em `columns` — `worker/worker.js:97`. Então qualquer flag (hold, status) que vem do fornecedor já está fisicamente no DB, só não está em coluna canônica para query rápida.

**Má notícia:** `computeMovements` (`worker/worker.js:147-194`) só detecta `added`, `removed`, `price_changed`, `qty_changed`. Faltam **`transferred`** (mudança de location) e **`held/released`** (mudança de status), que são pilares dos relatórios.

**Correções necessárias:** todas pequenas, sem retroação destrutiva. Estimativa: **2-3 dias de trabalho** para cobrir todos os gaps que bloqueiam os relatórios.

---

## 1. Mapa: necessidades dos PDFs × cobertura atual

Legenda:
- ✓ pronto (campo mapeado em coluna canônica)
- ◐ dado existe mas só no `payload`/`extra` jsonb
- ✗ dado não capturado / scraper precisa ajuste

### Scraper-by-scraper coverage

| Necessidade do relatório         | encore | crs | nsr | vmcstone | granitedistributor | zucchistones |
|-----------------------------------|--------|-----|-----|----------|--------------------|--------------|
| total slabs (qty)                | ✓      | ✓   | ✓   | ✓        | ✓                  | ✓            |
| category breakdown               | ✓      | ✓   | ✓   | ✓        | ✓                  | ✓            |
| material name                    | ✓      | ✓   | ✓   | ✓        | ✓                  | ✓            |
| **location** (essencial)         | ✓      | ✓   | ✓   | ◐        | ◐                  | ◐            |
| location_id (estável)            | ✓      | ✗   | ✗   | ✗        | ✗                  | ✗            |
| serial_number (chapa única)      | ✓      | ✓   | ✓   | ✗ (bundle) | ✗ (bundle)       | ✗ (bundle)   |
| price                            | ◐      | ✓   | ✓   | ✗        | ✗ (range só)       | ✗            |
| **on_hold flag** (essencial)     | ◐      | ◐   | ◐   | ◐        | ?                  | ?            |
| arrived_at (chegada do fornec.)  | ✗      | ✗   | ✗   | ✗        | ✗                  | ✗            |

### Diff/movements detection

| Movement kind necessário          | Status hoje                                            |
|-----------------------------------|--------------------------------------------------------|
| `added` (new arrivals)            | ✓ detectado                                             |
| `removed` (sold)                  | ✓ detectado                                             |
| `price_changed`                   | ✓ detectado                                             |
| `qty_changed`                     | ✓ detectado                                             |
| **`transferred`** (location chg)  | ✗ não detectado, embora `location` esteja em snapshots |
| **`held`** / **`released`**       | ✗ não detectado                                         |
| `cross_sale` (Encore p.11)        | ✗ derivação composta — não computado                    |

---

## 2. Gaps com fix concreto

### Gap 1 — VMC, GraniteDistributor, Zucchi não mapeiam `location`

**Sintoma:** os relatórios PDF do VMC mostram breakdown por Dallas/Tulsa/Lowell/Fort Worth/The Colony, mas `vmcstone_slabs.location` é sempre NULL. O campo existe no schema (`db/003_more_scrapers.sql:29`), só não está no `columns` mapping do scraper.

**Causa:** `db/003_more_scrapers.sql:302-310` (vmc), linhas 228-236 (granite distributor), 363-372 (zucchi) — `columns` não inclui `location`.

**Fix:**
```sql
-- VMC: descobrir nome real do field no payload de instock_bundles
-- Provável: "Location" ou "LocationName" ou "WarehouseName"
-- Adicionar:
"location": "Location"
```
Validação: rodar uma vez o scraper, dar `SELECT extra->>'Location' FROM vmcstone_slabs LIMIT 1` e ver se vem string. Se vier, mapear em columns; se não vier, descobrir o nome real do field no payload do POST `instock_bundles`.

**Mesmo procedimento** para granitedistributor e zucchistones.

**Esforço:** 1-2h por scraper, dependendo de quão fácil é descobrir o nome do field. Total: ~half-day.

### Gap 2 — `on_hold` flag não está em coluna canônica

**Sintoma:** PDFs mostram "Last 30 days slabs on hold" (VMC p.7, Encore p.7) mas o painel não consegue gerar isso.

**Causa:** Stone Profits API (Encore, CRS, NSR) tem `OnHold` como query param sugerindo que o payload por slab inclui o flag, mas nenhum scraper mapeia para coluna.

**Fix em duas partes:**

a) **Adicionar coluna canônica** ao schema (migration):
```sql
ALTER TABLE encore_slabs ADD COLUMN IF NOT EXISTS on_hold BOOLEAN;
ALTER TABLE crs_slabs    ADD COLUMN IF NOT EXISTS on_hold BOOLEAN;
ALTER TABLE nsr_slabs    ADD COLUMN IF NOT EXISTS on_hold BOOLEAN;
ALTER TABLE vmcstone_slabs ADD COLUMN IF NOT EXISTS on_hold BOOLEAN;
-- (e em granitedistributor_slabs, zucchistones_slabs se aplicável)
ALTER TABLE slabs_history ADD COLUMN IF NOT EXISTS on_hold BOOLEAN;
```

b) **Mapear** em cada scraper (depois de descobrir o nome real do field no payload de cada um):
```json
"columns": { ..., "on_hold": "OnHold" }   // ou "IsOnHold", "Hold", varia por API
```

**Esforço:** 1 dia (inclui inspecionar 1 payload de cada scraper para descobrir o nome do field).

### Gap 3 — `movements.kind` não tem `transferred`/`held`/`released`

**Sintoma:** mesmo se mapearmos location/on_hold em colunas, o diff atual não os detecta. Não há registro de "chapa X moveu de Dallas para Lowell em 2026-02-15".

**Causa:** `movements.kind CHECK (kind IN ('added','removed','price_changed','qty_changed'))` em `db/004_platform.sql:39`. E `computeMovements` em `worker/worker.js:147-194` só compara `price` e `available_qty` entre snapshots.

**Fix:**

a) **Estender o CHECK constraint:**
```sql
ALTER TABLE movements DROP CONSTRAINT movements_kind_check;
ALTER TABLE movements ADD CONSTRAINT movements_kind_check
  CHECK (kind IN ('added','removed','price_changed','qty_changed','transferred','held','released'));
```

b) **Adicionar lógica em `computeMovements`** (CTE adicional):
```sql
-- após qty_changed:
location_changed AS (
  SELECT c.source_key, c.item_name, p.location AS prev_loc, c.location AS next_loc
  FROM cur c JOIN prev p ON p.source_key = c.source_key
  WHERE c.location IS DISTINCT FROM p.location
    AND p.location IS NOT NULL AND c.location IS NOT NULL
),
hold_status_changed AS (
  SELECT c.source_key, c.item_name,
         p.on_hold AS prev_h, c.on_hold AS next_h
  FROM cur c JOIN prev p ON p.source_key = c.source_key
  WHERE c.on_hold IS DISTINCT FROM p.on_hold
),
ins_t AS (
  INSERT INTO movements (..., kind, prev_value, next_value)
  SELECT ..., 'transferred', prev_loc, next_loc FROM location_changed RETURNING 1
),
ins_h AS (
  INSERT INTO movements (..., kind, prev_value, next_value)
  SELECT ..., CASE WHEN next_h THEN 'held' ELSE 'released' END,
              prev_h::text, next_h::text FROM hold_status_changed RETURNING 1
),
```

c) Atualizar `cur` e `prev` CTEs para selecionar também `location` e `on_hold`.

**Esforço:** ~half-day. Refactor cirúrgico, com testes manuais antes/depois.

### Gap 4 — VMC/GD/Zucchi não têm identidade individual de chapa

**Sintoma:** `source_key` em VMC/GD/Zucchi vem do `bundle` (lote), não de um serial único. Significa que se um lote de 10 chapas existe em Dallas com `bundle="ABC123"` e amanhã 7 estão em Dallas + 3 em Tulsa, o painel detecta como **2 bundles** (um em cada local) e não como 3 chapas movidas.

**Implicação para os relatórios:**
- "Slabs transferred" agregado por bundle ainda é útil mas perde precisão
- "Cross-sales" (Encore p.11) é impossível sem serial individual

**Fix:**
- Para VMC e GD: investigar se o payload tem algum campo de slab serial (provável que sim — fornecedores de pedra geralmente trackeiam por slab). Se sim, mapear; se não, aceitar a limitação.
- Documentar que esses 3 scrapers operam em granularidade de lote.

**Esforço:** investigação 2-4h, fix se possível ~2h.

### Gap 5 — `arrived_at` não vem do fornecedor

**Sintoma:** "Last 30 days new arrivals" hoje é proxy: tudo que `movements.detected_at >= now() - 30d AND kind='added'`. Isso significa "primeira vez que vimos no scraping", não "data de chegada real ao depósito".

**Implicação:** se um cliente novo onboarda no dia 15 e roda o primeiro scrape no dia 20, todo o estoque vira "arrived in last 30d" no primeiro mês.

**Fix:**
- Para Stone Profits (encore/crs/nsr): payload tem `DateAdded` ou similar?
- Para os outros: idem.
- Mapear em coluna canônica `slab_arrived_at TIMESTAMPTZ`.
- Fallback: usar `min(slabs_history.scraped_at) per source_key` quando o fornecedor não fornece data.

**Esforço:** 4h de investigação + mapeamento. Depois usar coluna em vez de proxy nos relatórios.

---

## 3. Cross-cutting: o que a estrutura jsonb permite hoje

Mesmo SEM nenhum dos fixes acima, é possível **minerar dados retroativos** do `slabs_history.payload`:

```sql
-- Quantas chapas tinham flag "OnHold=true" em cada job?
SELECT job_id, count(*) FROM slabs_history
WHERE payload->>'OnHold' = 'true' AND scraper_id = $1
GROUP BY job_id;

-- Distribuição por location (mesmo se não mapeado em coluna):
SELECT payload->>'LocationName' AS loc, count(*)
FROM slabs_history
WHERE scraper_id = $1 AND job_id = $2
GROUP BY 1 ORDER BY 2 DESC;
```

Isso significa que **podemos prototipar os relatórios no painel novo SEM esperar o fix do scraper** — só perde performance (jsonb extraction não é indexada). Quando confirmamos que o relatório está correto, aí sim migra os fields para colunas + cria índice.

---

## 4. Plano de ação proposto (ordem)

1. **Investigar payloads** (1 dia) — rodar cada scraper uma vez em modo debug, capturar 1 item de payload completo, identificar nomes reais dos fields para `location`, `on_hold`, `arrived_at`, `serial_number` (onde existir).
2. **Migration: novas colunas + estender movements.kind** (~2h)
3. **Atualizar `actions.columns` dos 6 scrapers** (~half-day)
4. **Refactor `computeMovements`** com novos kinds (~half-day)
5. **Backfill opcional**: re-extrair dados de `slabs_history.payload` para popular novas colunas em snapshots históricos (~1 dia, só se for crítico ter histórico)

**Total: ~3 dias úteis** para o pipeline ficar coerente com os relatórios.

Pode rodar em paralelo com o bootstrap do Next.js — não há dependência forte (o painel novo pode usar jsonb extraction como fallback enquanto os fixes não chegam).

---

## 5. Apêndice A — Validação real (job #1, encore, 2026-05-08)

Primeiro job rodado com migrations 005+006 aplicadas. 4130 slabs persistidos. Resultado:

| Campo                | Cobertura      | Conclusão                                           |
|----------------------|----------------|-----------------------------------------------------|
| `location` (TEXT)    | 4130 / 4130    | ✅ funciona, valores: Charleston/Austin/Birmingham/ATL/SA/Ecommerce — mesmos do PDF |
| `location_id` (INT)  | 4130 / 4130    | ✅ funciona                                          |
| `category_name`      | 4130 / 4130    | ✅ distribuição alinhada com o PDF Encore Feb 2026  |
| `on_hold`            | 0 / 4130       | ❌ **field não existe no payload do endpoint**       |
| `on_so`              | 0 / 4130       | ❌ idem                                              |
| `in_transit`         | 0 / 4130       | ❌ idem                                              |

### O que descobri ao inspecionar o endpoint diretamente

1. `getItemInventory` (Stone Profits Pacshore East, sem auth) retorna **só 19 fields**:
   `SELECTEDLocation, CategoryName, ProductFormValue, ItemName, ItemID, FileName, SerialNumber, Location, LocationID, CustomID, FileID, AverageLength, AverageWidth, AvailableQty, UOM, AvailableSlabs, WebCartID, Barcode, Price1`.
   Não inclui `OnHold`, `OnSO`, `Intransit`.

2. Os params da URL `&OnHold=null&OnSO=null&Intransit=null` são **filtros de query**, não campos do payload de resposta. Ao testar `&OnHold=true`, a API ignora o filtro (retorna o mesmo número de items/slabs).

3. Hipótese: o filtro só funciona com sessão autenticada do Pacshore East (Stone Profits cobra acesso a flags). Reports PDF do cliente provavelmente são gerados por alguém logado no admin que vê os flags na UI.

### Implicações

- Para **encore**: status flags (on_hold/on_so/in_transit) **não são acessíveis pelo fluxo público atual**. Precisaria sessão autenticada no admin do PSE — outra arquitetura de scrape.
- Para **crs** e **nsr** (também Stone Profits, mas com `auth_token` configurado): pode funcionar diferente porque têm Authorization header. **Precisa testar rodando 1 job de cada**.
- Para **vmcstone**: payload diferente (não Stone Profits). Field `Availability` é candidato. Precisa rodar 1 job pra confirmar.
- Os relatórios PDF que precisam de "On Hold" para Encore vão ficar com **gap de dado** até resolvermos a autenticação. Os outros relatórios (inventory por location, sales por categoria, top sellers, transferred) **funcionam 100%** com o que temos.

### Próxima ação recomendada

- Rodar CRS ou NSR (auth via token) e ver se OnHold/OnSO/Intransit aparecem no payload deles
- Rodar VMC e validar mapping de Availability
- Para Encore especificamente: ou aceitar gap, ou pedir credenciais do admin Pacshore East e re-arquitetar scraper com login

---

## 6. Apêndice B — Field-name inference (estática, pré-job)

**Contexto:** sem acesso ao Postgres rodando, não consegui rodar `payload-inspection.sql`. Os nomes abaixo são inferidos de:
- URL params usados em cada scraper (sinaliza o que a API entende como filterável)
- Padrão das APIs que reconheço (Stone Profits, Salesforce Apex)
- Convenção do que JÁ está mapeado em `actions.columns`

Confiança: 🟢 alta · 🟡 média · 🔴 chute educado. **Confirmar TUDO** com o script SQL antes de mexer no scraper.

### Stone Profits (encore, crs, nsr)

URL pattern dos 3: `act=getItemInventory&InventoryGroupBy=...&OnHold=null&OnSO=null&Intransit=null`. A presença desses 3 params na URL é forte indício de que cada item do retorno traz esses 3 campos.

| Field necessário      | Field name provável     | Confiança | Tipo esperado          |
|------------------------|-------------------------|-----------|------------------------|
| location               | `Location`              | 🟢        | TEXT (já mapeado em encore) |
| location_id            | `LocationID`            | 🟢        | INT (já mapeado em encore)  |
| serial individual      | `SerialNumber`          | 🟢        | TEXT (já mapeado)       |
| **on_hold**            | `OnHold`                | 🟢        | string `"true"`/`"false"` ou `"1"`/`"0"` (varia entre instalações Stone Profits) |
| **on_so** (sales order pending) | `OnSO`        | 🟡        | mesmo tipo de OnHold    |
| **in_transit**         | `Intransit`             | 🟡        | mesmo                  |
| arrived/created date   | `CreatedDate` ou `DateAdded` ou `EntryDate` | 🟡 | timestamp ISO ou Stone Profits date string |
| price                  | `Price1`                | 🟢        | NUMERIC (já mapeado)    |

**Recomendação:** mapear `on_hold`, `on_so`, `in_transit` em coluna canônica. Os 3 juntos formam o "status pipeline" da slab e enriquecem muito os relatórios além do que os PDFs atuais já mostram.

### VMC (vmcstone)

URL POST `instock_bundles` com body `LocationName: "All"` e `Availability: "all"`. Sugere que cada item retorna esses 2 campos populados.

| Field necessário      | Field name provável            | Confiança | Notas                     |
|------------------------|--------------------------------|-----------|---------------------------|
| location               | `LocationName`                 | 🟢        | mais específico que "Location" |
| ou alternativamente    | `Location`                     | 🟡        | fallback                  |
| **on_hold/availability** | `Availability`               | 🟢        | provavelmente string: `"InStock"`, `"OnHold"`, `"Reserved"` |
| serial individual      | (provavelmente NÃO existe)    | 🔴        | VMC parece operar em granularidade de bundle |
| arrived/date           | `DateReceived` ou `LastUpdated` | 🔴       | confirmar                 |

### Granite Distributor

Site Everest Stone. JSON inline em `JSON.parse('[{...}]')`. Sem URL params para ajudar a inferir.

| Field necessário      | Field name provável     | Confiança |
|------------------------|-------------------------|-----------|
| location               | `Location` ou `Warehouse` | 🔴      |
| on_hold                | desconhecido — talvez não exista | 🔴 |
| arrived                | desconhecido            | 🔴       |

**Plano:** abrir o site no DevTools quando o ambiente subir e ver 1 item do JSON inline. 5min de trabalho.

### Zucchi (Salesforce Apex)

Fields seguem padrão SF custom `__c`. Já mapeado: `prod.Stock_Item__r.Produto__r.NomeMaterialEn__c`, `Espessura__c`, `MetragemLiquidaFt2__c`, `QuantidadeChapas__c`.

| Field necessário      | Field name provável                                          | Confiança |
|------------------------|--------------------------------------------------------------|-----------|
| location               | `prod.Stock_Item__r.Local__c` ou `Warehouse__c` ou `Filial__c` | 🔴      |
| on_hold                | `prod.Stock_Item__r.Status__c` ou `OnHold__c`                | 🔴       |
| serial individual      | provavelmente o `prod.Stock_Item__r.Name` que já é o bundle  | 🟡       |

**Plano:** abrir o response do Apex execute no DevTools, expand 1 item.

---

## 7. Riscos e ressalvas

- **Re-running scrapers para investigar payload** consome rate-limit dos fornecedores. Aproveitar resultados de jobs já existentes: `SELECT payload FROM slabs_history WHERE scraper_id=$1 LIMIT 1` retorna um exemplo real do que cada API enviou. Não precisa rodar de novo.
- **Nomes dos fields podem variar entre items do mesmo scraper** (ex.: alguns slabs sem location). Usar COALESCE no SQL.
- **`on_hold` pode ser numeric (0/1) em vez de boolean**, ou string ("Y"/"N"). Coerção no save_rows pipeline ou no SQL de migration.
- **Encore tem `location_id` int além do `location` text** — bom para join estável; outros não. Padronização futura: mapear scrapers para uma `locations` normalizada por `org_id`.
