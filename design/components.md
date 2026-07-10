# HorusHawks · Components

Catálogo dos componentes base do design system. Cada um traz: propósito, anatomia, variantes, estados, ASCII preview.

Convenção do preview: `█` = filled, `░` = subtle bg, `─│┌┐└┘` = border, `▾` = caret, `…` = ellipsis.

---

## 1. KPI Card (hero)

**Uso:** número primário de uma seção (total slabs, sold, sell-through). Usa `metric-xl` ou `metric-lg`, com label `overline`, delta opcional, e blob decorativo no fundo.

### Anatomia
```
┌─────────────────────────────────────┐
│ TOTAL SLABS                         │  ← overline (caption uppercased)
│                                     │
│ 8,133                               │  ← metric-xl (Inter Light)
│                                     │
│ ↓ 571 vs Jan  (-6.5%)               │  ← delta chip + caption
└─────────────────────────────────────┘
   ░ blob radial em 1 dos cantos ░
```

### Variantes
- `size`: xl (hero único), lg (grid 2-col), md (grid 3+ col)
- `accent`: emerald | sky | violet | stone (define o blob)
- `delta`: positive | negative | neutral | none

### Estados
- default
- loading (skeleton com shimmer)
- empty ("—" no número, label "no data")

---

## 2. Pivot Table

**Uso:** o coração das telas Inventory e Sales. Replica os pivots dos PDFs (categoria × localização × material) com expandir/colapsar e Δ inline.

### Anatomia
```
┌──────────────────────┬────────┬────────┬───────┐
│                      │ Stock  │ Sold   │ Δ     │
├──────────────────────┼────────┼────────┼───────┤
│ ▾ Dallas, TX         │ 5,182  │ 1,046  │ -505  │
│   ▸ Natural Granite  │ 1,893  │   360  │ -184  │
│   ▾ Santa. Quartz    │   987  │   204  │ -148  │
│       Lyskamm 3cm    │    33  │   105  │ -102  │
│       Istria 2cm     │   124  │     2  │   -2  │
│   ▸ Natural Quartzite│   621  │   128  │  -59  │
├──────────────────────┼────────┼────────┼───────┤
│ ▸ Tulsa, OK          │ 1,037  │   384  │  -68  │
└──────────────────────┴────────┴────────┴───────┘
```

### Comportamento
- Header sticky
- Group rows clicáveis (toggle expansão)
- Δ colorido por sentiment (positive/negative)
- Ordenação por qualquer coluna numérica
- Hover destaca linha
- Number columns: `tabular-nums` + alinhamento right

### Variantes
- `density`: comfortable (16px row) | compact (12px) | dense (10px)
- `groupBy`: location | category | material — 3 níveis configuráveis

---

## 3. Filter Chip Bar

**Uso:** filtros globais persistentes (Period, Location, Category, Material).
Estilo inspirado em Synthex (mockup #3) e iOS segmented controls.

### Anatomia
```
[ Period · Feb 2026 ▾ ]  [ Location · All ▾ ]  [ Category · All ▾ ]  [ + Add filter ]
   pill ativo (accent)         pill default          pill default
```

### Variantes
- `variant`: pill (rounded-pill, accent quando ativo) | tab (rounded-md, segmented)
- `multi`: aceita múltiplas seleções (ex.: 3 locations) → mostra "Location · 3"
- `removable`: x para limpar

### Estados
- default
- active (selecionado, accent-500 bg)
- hover
- disabled
- loading (spinner mini)

---

## 4. Button

### Variantes
- `primary`: accent bg + white text + radius-md
- `secondary`: stone-100 bg + stone-700 text
- `ghost`: transparent + stone-700 text + hover stone-100 bg
- `outline`: 1px stone-300 border + transparent
- `danger`: negative-fg bg + white

### Tamanhos
- `sm` (32px h, 12px px)
- `md` (40px h, 16px px) — default
- `lg` (48px h, 20px px)
- `icon` (square, 40x40)

---

## 5. Trend / Sparkline Chart

**Uso:** mini-chart inline em KPI cards ou linhas de pivot, mostrando trajetória 30/90 dias.

### Variantes
- `sparkline`: 80x24px, sem axes, sem labels, só linha
- `area`: 100% width × 240px, eixo X com labels mensais, área com gradient fill
- `area-annotated`: mesmo + labels destacando deltas (referência mockup Synthex "+24%")

### Style
- Stroke: 2px, rounded-cap
- Color primary: stone-700 (light) / stone-100 (dark)
- Color secondary: accent-500
- Sem grid em sparkline; em area usar dashed muito sutil

---

## 6. Pareto Bar Chart

**Uso:** "Top-selling slabs" mostrando que X% das vendas vêm de Y itens. Replica páginas 9 e 10 dos PDFs.

### Anatomia
```
   slabs sold
111 ████████████████████████████  ── 11% cumulativo
105 ███████████████████████████   ── 21%
 95 ████████████████████████      ── 31%
 87 █████████████████████         ── 39%
 ...
                                              ▲ 48.1% covered by top 10
```

Barra horizontal por item + linha cumulativa overlay (curva de Pareto). Highlight automático onde a curva cruza 50%, 80%.

---

## 7. Movement Card

**Uso:** entrada individual no feed de movements (Last 30 days arrivals, transfers, on hold).

### Anatomia
```
┌────────────────────────────────────────────────────┐
│ [+]  Sedona Classic 3cm                  · 2 hours │  ← icon + name + relative time
│      Natural Granite · Dallas, TX        +17 slabs │  ← category · location + qty
│      Job #1247 from VMC scraper                    │  ← provenance link
└────────────────────────────────────────────────────┘
```

Variantes por kind: added (verde), removed (vermelho), transferred (azul, mostra origem→destino), on_hold (amber), price_change (violet).

---

## 8. Period Selector

**Uso:** chip principal de "Period: Feb 2026 ▾" abre dropdown.

### Dropdown content
```
┌───────────────────────────────┐
│ Quick                         │
│   Last 7 days                 │
│   Last 30 days                │
│   This month                  │
│   Last month               ✓  │  ← selected
│   YTD                         │
├───────────────────────────────┤
│ Compare to                    │
│   Previous period         [▾] │
│   Same period last year       │
├───────────────────────────────┤
│ Custom range                  │
│   [ from ]  →  [ to    ]      │
└───────────────────────────────┘
```

Sempre com **comparação** habilitada — todos os números mostram Δ vs período de comparação.

---

## 9. Data Source / Tenant Badge

**Uso:** mostrar de onde vem o dado (qual scraper / loja) na linha de uma tabela ou no header.

```
[VMC] Stock and sales · last sync 12 min ago      [healthy ●]
```

Status dot: verde (last_run_succeeded recente), amber (atrasado), vermelho (failing).

---

## 10. Empty States

### Pattern
```
        ┌────────────┐
        │     ▵      │   ← ilustração simples (sem 3D, sem caricatura)
        └────────────┘

        No movements yet
        First sync runs in 4 hours.
        [Run sync now]
```

Sempre: ilustração leve + título curto + descrição com próximo passo + CTA.

---

## 11. Sheet / Drawer

**Uso:** detalhamento de slab, configuração de filtro avançado, notificações.
Slide da direita em desktop (480px), bottom em mobile (full-width).

---

## 12. Toast / Notification

Bottom-right em desktop, top em mobile. Auto-dismiss 5s. Cor por sentiment.

---

## 13. Skeleton

Shimmer suave (não pulsante) usando `--stone-100` → `--stone-200` em loop 1.6s.
KPI hero: skeleton de número (200x60), label (80x12), delta (120x14).
Pivot row: 60x14 + 40x14 columns.

---

## 14. Code reference (em audit log e job logs)

Mono font, scrollable horizontal, line numbers opcionais. Usar para mostrar action JSON, error messages.
