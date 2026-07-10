# HorusHawks · Stone Intelligence

Plataforma de coleta de inventário (chapas de mármore, granito, quartzito, porcelanato) de fornecedores. Engine declarativa em Playwright + Postgres + Redis + worker BullMQ + painel EJS com tipografia editorial.

## Capacidades

- **6 robôs** prontos: encore, crs, nsr, granitedistributor, vmcstone, zucchistones
- **Engine declarativa** com actions JSON: `fetch_json`, `fetch_text`, `extract_match`, `loop`, `accumulate`, `save_rows`
- **Snapshots históricos** + **diffs automáticos** (added / removed / price_changed / qty_changed)
- **OPR editorial** (One Page Report) como tela inicial
- **API v1** com Bearer tokens
- **Webhooks** ao concluir job
- **⌘K spotlight** cross-tabela
- **Cron builder** com presets
- **Audit log** das ações no painel
- **Export CSV** de qualquer tabela

## Stack

- Engine: Node + Playwright (Chromium headless)
- Worker: Node + BullMQ
- Painel: Node + Express + EJS + Tailwind via CDN + HTMX + Chart.js
- DB: Postgres 16
- Queue: Redis 7

## Setup

```bash
# 1. .env
cp .env.example .env
# edite os valores

# 2. Subir
docker compose up -d --build

# 3. Aplicar schema base
docker compose exec -T postgres psql -U scraper -d scrapers < db/init.sql
docker compose exec -T postgres psql -U scraper -d scrapers < db/002_encore.sql
docker compose exec -T postgres psql -U scraper -d scrapers < db/003_more_scrapers.sql
docker compose exec -T postgres psql -U scraper -d scrapers < db/004_platform.sql
docker compose exec -T postgres psql -U scraper -d scrapers < db/005_movement_kinds_and_status.sql
docker compose exec -T postgres psql -U scraper -d scrapers < db/006_update_scraper_actions.sql
docker compose exec -T postgres psql -U scraper -d scrapers < db/007_saved_queries.sql

# 4. (opcional) tokens dos robôs Stone Profits autenticados
cp db/secrets.sql.example db/secrets.sql
# edite os tokens
docker compose exec -T postgres psql -U scraper -d scrapers < db/secrets.sql
```

Painel: <http://localhost:3001>.

## Estrutura

```
scrape-api/
├── docker-compose.yml
├── .env                    # (gitignored)
├── db/
│   ├── init.sql            # tabelas base: scrapers, jobs, results
│   ├── 002_encore.sql      # primeiro robô + tabela encore_slabs
│   ├── 003_more_scrapers.sql  # crs, nsr, granitedistributor, vmcstone, zucchistones
│   ├── 004_platform.sql    # snapshots, movements, api_tokens, webhooks, audit
│   ├── secrets.sql         # (gitignored) tokens de produção
│   └── secrets.sql.example
├── engine/                 # Playwright API
│   └── backend.js
├── worker/                 # BullMQ worker + scheduler
│   ├── worker.js
│   └── scheduler.js
└── panel/                  # Express + EJS UI
    ├── server.js
    ├── lib/
    └── views/
```

## Linguagem de actions

Cada robô é um JSON de actions executado pela engine. Vocabulário:

- `fetch_json` / `fetch_text` — GET/POST com headers, body_json, body_form, query_params. Templates: `{{vars.X}}`, `{{item.X}}`, `{{now}}`, `{{random_int}}`
- `extract_match` — regex sobre string do state, opcional `parse: "json"`
- `loop` — itera array do state com `concurrency` opt-in e `dedupe_by`
- `accumulate` — acumula array de path do state em outro array
- `save_rows` — declarativo: o worker insere em SQL na tabela alvo, mapeando colunas + extras pra `extra jsonb`
- `set_var` — atribui variável runtime
- `wait_for_selector / click / type / extract_text / extract_html / screenshot` — interações de browser

## API

```bash
TOKEN="hh_..."
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/v1/scrapers
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3001/api/v1/slabs?source=encore&limit=100"
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3001/api/v1/movements?limit=50"
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3001/api/v1/jobs?limit=50"
```

Tokens são gerados em `/api-tokens`.

## Webhooks

POST automático ao concluir job (eventos `job.done`, `job.failed`):

```json
{
  "event": "job.done",
  "payload": { "job_id": 12, "scraper": "encore", "rows": 4136, "movements": { "added": 3, "removed": 1, "changed": 0 } },
  "sent_at": "2026-05-07T18:32:00.000Z"
}
```

Configurar em `/webhooks`. Header `X-HorusHawks-Secret` quando o secret é definido.
