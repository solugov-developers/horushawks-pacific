# HorusHawks · Wireframes

Cinco telas principais: **Overview · Inventory · Sales · Movements · Reports**.
Para cada uma: layout desktop (1280+) e mobile (375+).
Filtros globais (Period, Location, Category) persistem no topo de todas.

ASCII conventions:
- `█` = filled bar / KPI emphasis
- `░` = subtle bg / blob
- `▾` = dropdown caret
- `·` = separator (also visual dot)
- `→` = transfer
- linhas verticais para box drawing

---

## Shell global (todas as telas)

### Desktop
```
┌────────────────────────────────────────────────────────────────────────────────┐
│ [PSS logo]                                          [⌘K Search]   [☾]  [👤 PSS]│
├────────────────────────────────────────────────────────────────────────────────┤
│  Overview   Inventory   Sales   Movements   Reports          Last sync · 12m   │
├────────────────────────────────────────────────────────────────────────────────┤
│  [ Period · Feb 2026 ▾ ]  [ Location · All ▾ ]  [ Category · All ▾ ]  [ + ]    │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│                              page content                                       │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Mobile
```
┌────────────────────────┐
│ PSS              ☾  👤 │
├────────────────────────┤
│ Overview ┊ Inventory… ▸│  ← horizontal scroll tabs
├────────────────────────┤
│ Feb 2026 ▾  All ▾  ⋯   │  ← chips compactos
├────────────────────────┤
│                        │
│      page content      │
│                        │
└────────────────────────┘
```

---

## 1. Overview (OPR v2)

Substitui o "OPR editorial" atual. Resumo executivo: o que mais importa em 5 segundos.

### Desktop
```
┌────────────────────────────────────────────────────────────────────────────────┐
│  Welcome back, Pacific Shore Stones                          February 2026     │  ← Fraunces display-md
│                                                                                │
│  ╔════════════════════════════════╗  ╔══════════════════════════════════════╗  │
│  ║ TOTAL SLABS                    ║  ║ SOLD THIS PERIOD                     ║  │
│  ║                                ║  ║                                      ║  │
│  ║   8,133                        ║  ║   2,041                              ║  │  ← metric-xl
│  ║                                ║  ║                                      ║  │
│  ║   ↓ 571 (-6.5%) vs Jan         ║  ║   25.1% sell-through                 ║  │  ← caption + delta
│  ║   ░░░░ blob emerald ░░░░       ║  ║   ░░░░ blob sky ░░░░                 ║  │
│  ╚════════════════════════════════╝  ╚══════════════════════════════════════╝  │
│                                                                                │
│  ╔════════════════════════════════╗  ╔══════════════════════════════════════╗  │
│  ║ NEW ARRIVALS · 30D             ║  ║ ON HOLD                              ║  │
│  ║   731                          ║  ║   295                                ║  │  ← metric-lg
│  ║   679 sold or assigned (92.9%) ║  ║   3.6% of inventory                  ║  │
│  ╚════════════════════════════════╝  ╚══════════════════════════════════════╝  │
│                                                                                │
│  Inventory trend                                            [ 30d  90d  YTD ]  │
│  ┌────────────────────────────────────────────────────────────────────────────┐│
│  │                                                                            ││
│  │   ╱╲                          ╱╲                                ←  area    ││
│  │  ╱  ╲___                    ╱   ╲___                                       ││
│  │                ╲___  __╱                ╲                                   ││
│  │                                                                            ││
│  │  Nov            Dec           Jan           Feb                            ││
│  └────────────────────────────────────────────────────────────────────────────┘│
│                                                                                │
│  ┌──────────────────────────────────┐  ┌────────────────────────────────────┐  │
│  │ Top categories            [ → ]  │  │ Top locations              [ → ]   │  │
│  │                                  │  │                                    │  │
│  │ Natural Granite    2,858  ↓ -240 │  │ Dallas, TX         5,182  ↓ -505   │  │
│  │ Santa. Quartz      1,372  ↓ -150 │  │ Tulsa, OK          1,037  ↓  -68   │  │
│  │ Natural Quartzite  1,290  ↓  -91 │  │ Lowell, AR           993  ↑   51   │  │
│  │ Vadara Quartz        665  ↓ -104 │  │ Fort Worth, TX       571  ↓  -55   │  │
│  │ Natural Marble       723  ↓  -12 │  │ The Colony, TX       350  ↑    6   │  │
│  └──────────────────────────────────┘  └────────────────────────────────────┘  │
│                                                                                │
│  Last 30 days movements                                                        │
│  [+] 731 arrived · [↻] 142 transferred · [⏸] 295 on hold · [-] 2,041 sold       │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Mobile (Overview)
```
┌────────────────────────┐
│ Welcome back           │
│ Pacific Shore Stones   │  ← Fraunces display-md
│ February 2026          │
├────────────────────────┤
│ ╔════════════════════╗ │
│ ║ TOTAL SLABS        ║ │
│ ║   8,133            ║ │
│ ║   ↓ 571 (-6.5%)    ║ │
│ ║   ░░ blob ░░       ║ │
│ ╚════════════════════╝ │
│ ╔════════════════════╗ │
│ ║ SOLD · FEB         ║ │
│ ║   2,041            ║ │
│ ║   25.1% sell-thru  ║ │
│ ╚════════════════════╝ │
│ ╔════════════════════╗ │
│ ║ NEW ARRIVALS · 30D ║ │
│ ║   731              ║ │
│ ║   92.9% sold/used  ║ │
│ ╚════════════════════╝ │
├────────────────────────┤
│ Top categories     →   │
│ Natural Granite        │
│ ▆▆▆▆▆▆▆▆▆ 2,858  -240  │
│ Santa. Quartz          │
│ ▆▆▆▆▆▆ 1,372     -150  │
│ ...                    │
├────────────────────────┤
│ Movements last 30d     │
│ [+] 731                │
│ [↻] 142                │
│ [⏸] 295                │
│ [-] 2,041              │
└────────────────────────┘
```

---

## 2. Inventory

Pivot interativo categoria × localização × material. Esta tela substitui o "Data Explorer" atual.

### Desktop
```
┌────────────────────────────────────────────────────────────────────────────────┐
│  Inventory                                                                      │
│                                                                                │
│  Group by:  [ Location ▾ ]  →  [ Category ▾ ]  →  [ Material ▾ ]    [Export ▾] │
│  Compare:   Feb 28 vs Jan 31                                                    │
│                                                                                │
│  ┌──────────────────────────────────────┬─────────┬─────────┬─────────────────┐│
│  │                                      │ Stock   │ Stock   │ Δ               ││
│  │                                      │ Jan 31  │ Feb 28  │                 ││
│  ├──────────────────────────────────────┼─────────┼─────────┼─────────────────┤│
│  │ ▾ Dallas, TX                         │  5,687  │  5,182  │ -505  ▆▆▆▆▆▆ -8.9%│
│  │   ▾ Natural Granite                  │  2,077  │  1,893  │ -184  ▆▆▆▆ -8.9% ││
│  │       Dallas White 2cm               │    206  │    221  │  +15           ││
│  │       Steel Gray 2cm (Ice Finish)    │     99  │    112  │  +13           ││
│  │       Dallas White 3cm               │    205  │    112  │  -93  ▆▆▆      ││
│  │       Sedona Classic 3cm             │    133  │     88  │  -45           ││
│  │       Sedona 3cm (VV+)               │    121  │     83  │  -38           ││
│  │       [ + 1,373 more …  show all ]                                         ││
│  │   ▸ Santamargherita Quartz           │  1,135  │    987  │ -148           ││
│  │   ▸ Natural Quartzite                │    680  │    621  │  -59           ││
│  │   ▸ Santamargherita Marble           │    377  │    441  │  +64  ↑        ││
│  │   ▸ Lapitec Sintered Stone           │    354  │    363  │   +9           ││
│  │   ▸ Vadara Quartz                    │    456  │    355  │ -101           ││
│  │   ▸ Natural Marble                   │    367  │    315  │  -52           ││
│  │   ▸ Santamargherita Surfalite        │    241  │    207  │  -34           ││
│  ├──────────────────────────────────────┼─────────┼─────────┼─────────────────┤│
│  │ ▸ Tulsa, OK                          │  1,105  │  1,037  │  -68           ││
│  │ ▸ Lowell, AR                         │    942  │    993  │  +51  ↑        ││
│  │ ▸ Fort Worth, TX                     │    626  │    571  │  -55           ││
│  │ ▸ The Colony, TX                     │    344  │    350  │   +6  ↑        ││
│  ├──────────────────────────────────────┼─────────┼─────────┼─────────────────┤│
│  │ Total                                │  8,704  │  8,133  │ -571           ││
│  └──────────────────────────────────────┴─────────┴─────────┴─────────────────┘│
│                                                                                │
│  Showing 8 of 8 locations · 8 of 8 categories                                  │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Mobile (Inventory)
Mobile esconde a coluna "Stock Jan 31" (mostra só "Stock Feb 28" + Δ).
Group rows full-width, expand inline. Density compact.

```
┌────────────────────────┐
│ Inventory              │
│ Feb 28 vs Jan 31       │
├────────────────────────┤
│ Group: Loc › Cat       │
│ [ Loc ▾ ] [ Cat ▾ ]    │
├────────────────────────┤
│ ▾ Dallas, TX  -505 -9% │
│ ▆▆▆▆▆▆ 5,182           │
│   ▾ Natural Granite    │
│       1,893    -184    │
│       Dallas White 2cm │
│         221    +15     │
│       Steel Gray 2cm   │
│         112    +13     │
│       Dallas White 3cm │
│         112    -93     │
│       Sedona Classic   │
│          88    -45     │
│       [+ 5 more …]     │
│   ▸ Santa. Quartz      │
│       987     -148     │
│   ▸ ... 6 more         │
├────────────────────────┤
│ ▸ Tulsa, OK            │
│   1,037   -68          │
└────────────────────────┘
```

---

## 3. Sales

Espelha as páginas 8-19 dos PDFs. Foco em o que vendeu, com Pareto e cross-tabulações.

### Desktop
```
┌────────────────────────────────────────────────────────────────────────────────┐
│  Sales                                                                          │
│  February 2026 · 2,041 slabs sold (25.1% of inventory)                         │
│                                                                                │
│  ╔══════════════════════════╗  ╔══════════════════════════╗  ╔════════════════╗ │
│  ║ TOP 10 ITEMS COVER       ║  ║ TOP 50 ITEMS COVER       ║  ║ FROM NEW ARRIV.║ │
│  ║   48.1%                  ║  ║   84.7%                  ║  ║   8.1%         ║ │
│  ║   of total sales         ║  ║   of total sales         ║  ║   165 slabs    ║ │
│  ╚══════════════════════════╝  ╚══════════════════════════╝  ╚════════════════╝ │
│                                                                                │
│  Top-selling slabs                                       [ By category ▾ ]      │
│                                                                                │
│   1  Sedona Classic 3cm        Natural Granite      ▆▆▆▆▆▆▆▆▆▆▆ 111   ── 5.4%  │
│   2  Lyskamm 3cm               Santa. Quartz        ▆▆▆▆▆▆▆▆▆▆  105   ── 10.6% │
│   3  Dallas White 3cm          Natural Granite      ▆▆▆▆▆▆▆▆▆    95   ── 15.2% │
│   4  Ostara Dawn 3cm           Vadara Quartz        ▆▆▆▆▆▆▆▆     87   ── 19.4% │
│   5  Taj Mahal 3cm             Natural Quartzite    ▆▆▆▆▆        58   ── 22.3% │
│   ...                                                                          │
│  10  Fantasy Brown 3cm         Natural Marble       ▆▆▆▆          24   ── 48.1%│
│      ────────────────────────────────────────────  ←  cumulative line          │
│  50  Vendome 2cm               Santa. Marble        ▆              7   ── 84.7%│
│                                                                                │
│  [ Show full list (1,247 items) ]                                              │
│                                                                                │
│  ┌──────────────────────────────┐  ┌──────────────────────────────────────────┐│
│  │ Sales by category            │  │ Sales by location                        ││
│  │ Natural Granite       790    │  │ Dallas, TX           1,046  51%          ││
│  │ Vadara Quartz         389    │  │ Tulsa, OK              384  19%          ││
│  │ Natural Quartzite     323    │  │ Lowell, AR             337  17%          ││
│  │ Santa. Quartz         284    │  │ Fort Worth, TX         171   8%          ││
│  │ ...                          │  │ The Colony, TX         103   5%          ││
│  └──────────────────────────────┘  └──────────────────────────────────────────┘│
│                                                                                │
│  Sales from last 30 days arrivals                  165 of 731 arrivals (22.6%) │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │ Taj Mahal 3cm           Natural Quartzite     ▆▆▆▆ 20                    │  │
│  │ Taj Mahal 3cm (Brushed) Natural Quartzite     ▆▆▆▆ 17                    │  │
│  │ Sedona Classic 3cm      Natural Granite       ▆▆▆  17                    │  │
│  │ ...                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Mobile (Sales)
KPIs empilham. Pareto vira lista vertical com barra horizontal full-width.

---

## 4. Movements

Feed cronológico + tabs para filtrar tipo. Espelha "Last 30 days arrivals/transferred/on hold/sold" do PDF.

### Desktop
```
┌────────────────────────────────────────────────────────────────────────────────┐
│  Movements                                                                      │
│                                                                                │
│  [ All  3,209 ]  [ Arrivals  731 ]  [ Transferred  142 ]  [ On hold  295 ]     │
│  [ Sold  2,041 ]                                                                │
│                                                                                │
│  Today, Mar 1                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │ [+]  Sedona Classic 3cm                              · 14m ago            │  │
│  │      Natural Granite · Dallas, TX                  +17 slabs              │  │
│  │      from VMC scraper · job #1247                                         │  │
│  ├──────────────────────────────────────────────────────────────────────────┤  │
│  │ [↻]  Taj Mahal 3cm                                  · 38m ago            │  │
│  │      Natural Quartzite · Dallas, TX → Lowell, AR    6 slabs               │  │
│  │      from VMC scraper · job #1247                                         │  │
│  ├──────────────────────────────────────────────────────────────────────────┤  │
│  │ [⏸]  Bianco Rhino HONED                             · 1h ago             │  │
│  │      Marble · Charleston                            5 slabs on hold       │  │
│  │      from Encore scraper · job #1246                                      │  │
│  ├──────────────────────────────────────────────────────────────────────────┤  │
│  │ [-]  Lyskamm 3cm                                    · 3h ago             │  │
│  │      Santa. Quartz · Dallas, TX                     -100 slabs            │  │
│  │      from VMC scraper · job #1245                                         │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  Yesterday, Feb 28                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │ ...                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  [ Load more ]                                                                  │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Mobile
Mesma lista com cards full-width, sem ícone à esquerda quando fica apertado.

---

## 5. Reports

Lista de relatórios mensais auto-gerados, com viewer interno e PDF download. Substitui o trabalho manual atual.

### Desktop — Lista
```
┌────────────────────────────────────────────────────────────────────────────────┐
│  Reports                                                                        │
│                                                                                │
│  Auto-generated on the 1st of each month · Last generated Mar 1, 2026          │
│                                                                                │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │ February 2026                                                  [PDF ↓]    │  │
│  │ Stock and sales · 01/31 → 02/28                                            │  │
│  │ 8,133 slabs · 2,041 sold · 731 arrivals                                    │  │
│  │                                                          [ Open report → ] │  │
│  ├──────────────────────────────────────────────────────────────────────────┤  │
│  │ January 2026                                                  [PDF ↓]    │  │
│  │ Stock and sales · 12/31 → 01/31                                            │  │
│  │ 8,704 slabs · 1,894 sold · 612 arrivals                                    │  │
│  │                                                          [ Open report → ] │  │
│  ├──────────────────────────────────────────────────────────────────────────┤  │
│  │ December 2025                                                 [PDF ↓]    │  │
│  │ ...                                                                       │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  Need a custom range? [ Build custom report ]                                   │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Desktop — Report viewer (web version of the PDF)
Tela cheia, layout idêntico ao PDF mas interativo. Cada tabela é clicável (drilldown), cada gráfico tem hover state. Sticky table of contents à esquerda.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  ◂ Reports                                                            [PDF ↓]  │
│  REPORT · stock and sales · 01/31 ~ 02/28                                       │
│                                                                                │
│  ┌─────────────────────┬──────────────────────────────────────────────────────┐│
│  │ 1  Cover            │                                                      ││
│  │ 2  Total inventory  │     ┌────────────────────────────────────────────┐  ││
│  │ 3  New arrivals     │     │  TOTAL SLABS (INVENTORY)                  │  ││
│  │ 4  Main by category │     │                                            │  ││
│  │ 5  Main by location │     │  per category    Jan 31  Feb 28   Δ        │  ││
│  │ 6  Transferred      │     │  Natural Granite  3,098  2,858   -240     │  ││
│  │ 7  On hold          │     │  Santa. Quartz    1,522  1,372   -150     │  ││
│  │ 8  Total sold       │     │  ...                                       │  ││
│  │ 9  Top selling      │     └────────────────────────────────────────────┘  ││
│  │ 10 From new arriv.  │                                                      ││
│  │ 11 Sold with hold   │                                                      ││
│  │ 12 Sold transferred │                                                      ││
│  │ 13 Stock vs sold    │                                                      ││
│  └─────────────────────┴──────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────────────────┘
```

### Mobile — Reports
Lista vertical de cards. Tap abre viewer fullscreen com swipe entre páginas.

---

## 6. Cross-cutting screens (não detalhar agora, mas reservados)

- **Settings** — perfil de usuário, mudança de senha, notificações
- **Team** — convite de outros usuários do mesmo tenant
- **Sources** — visualização readonly de quais scrapers alimentam os dados
- **Webhooks** (admin) — apenas role admin do tenant
- **API tokens** (admin) — geração de tokens

---

## 7. Empty / Loading / Error states (resumo)

- **Empty no Overview**: hero com ilustração mineral + "Aguardando primeiro sync. Próxima execução em 2h." + CTA "Run sync now"
- **Loading**: skeleton dos KPIs + skeleton de pivot row × 6
- **Erro de fetch**: card warn-bg com "Não consegui carregar [seção]. [Retry]"
- **Stale data**: badge sutil amber no header "Dados desatualizados · last sync 8h ago"
