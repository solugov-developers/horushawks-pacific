# HorusHawks · Design Tokens

Linguagem visual: **Apple HIG aligned** — hairlines, vidro sutil, ar generoso, sobriedade.
Identidade HorusHawks: pomba poligonal + serif clássico (Cinzel/Trajan-derived) + navy `#14213D` + tagline "Precision Intelligence Extraction".
Light + dark como cidadãos de primeira classe.

---

## 1. Paleta

### Neutros (cool gray, Apple-style)

| Token     | Hex       | Uso                                          |
|-----------|-----------|----------------------------------------------|
| gray-50   | #F5F5F7   | Background light (Apple off-white)           |
| gray-100  | #EFEFF1   | Surface-2 light                              |
| gray-200  | #E5E5EA   | Hover backgrounds                            |
| gray-300  | #D1D1D6   | Borders enfatizadas                          |
| gray-400  | #A1A1A6   | Text soft                                    |
| gray-500  | #6E6E73   | Text muted                                   |
| gray-600  | #48484A   | Text body dark mode                          |
| gray-700  | #2C2C2E   | Text strong / body light                     |
| gray-800  | #1F1F22   | Surface-2 dark                               |
| gray-900  | #161618   | Surface dark                                 |
| gray-950  | #0A0A0C   | Background dark (NÃO #000)                   |

### Navy (accent — brand anchor)

`#14213D` é o brand anchor — fica no tom **700**, não 500.

| Token       | Hex      | Uso                                            |
|-------------|----------|------------------------------------------------|
| accent-50   | #EEF1F6  | Subtle tints                                   |
| accent-100  | #DCE2EC  | Hover backgrounds claros                       |
| accent-200  | #B9C5D6  | Borders accent                                 |
| accent-400  | #4D6388  | Dark mode link / accent visível                |
| accent-500  | #2D426B  | Focus border, welcome span                     |
| accent-600  | #1F2F52  | Hover/pressed em botão primário                |
| accent-700  | #14213D  | **BRAND** — botões primários, pills, ícones    |
| accent-800  | #0D1729  | Active state                                   |
| accent-900  | #070C18  | (uso raro)                                     |
| accent-on   | #FFFFFF  | Texto sobre accent-700                         |

### Sentiment (cool re-tints)

| Token         | Light bg | Light fg | Dark bg (rgba w/ navy)    | Dark fg |
|---------------|----------|----------|---------------------------|---------|
| positive      | #E3F1E8  | #2F6E3C  | rgba(143,186,126,0.12)    | #A6D6A0 |
| negative      | #F2E1DC  | #8C3D2E  | rgba(216,150,132,0.12)    | #E9A89A |
| info          | #E0E8F1  | #3A5A7C  | rgba(122,154,200,0.12)    | #94B0CE |
| warn          | #F0EAD8  | #7A5E22  | rgba(196,168,108,0.12)    | #D1B97E |

### Hairlines (border tokens)

| Modo  | --border       | --border-strong |
|-------|----------------|-----------------|
| light | rgba(0,0,0,.08)| rgba(0,0,0,.14) |
| dark  | rgba(255,255,255,.10) | rgba(255,255,255,.16) |

---

## 2. Tipografia

| Role     | Família           | Uso                                              |
|----------|-------------------|--------------------------------------------------|
| display  | **Cinzel** (Google) | Wordmark (login), H1 ("Welcome back", "Sales"), overlines de seção |
| sans     | **Inter** (Google)  | UI, body, **números KPI** (tabular-nums), labels |
| mono     | JetBrains Mono    | Editor SQL, cron, dados crus                     |

**Regra crítica**: números (4.290, %) **NÃO** vão em serif. Apple usa SF Pro pra tudo, mesmo princípio: Inter Light com `tracking-tight` + `tabular`.

**font-display permitido em**:
- Logo wordmark (login)
- Page H1 ("Welcome back", "Sales", "Inventory", "Scrapers", "SQL", "Data", "Reports", "Movements")

**font-display PROIBIDO em**:
- Hero numbers (KPI cards) → Inter font-light
- Labels curtas em tabela (location, scraper name) → Inter font-medium
- Sublabels ("Saved queries") → Inter font-medium

### Escala

- H1 hero: `text-4xl md:text-5xl` Cinzel 500
- H2: `text-2xl` Cinzel 500 ou `text-xl` Inter font-medium
- KPI hero number xl: `text-6xl md:text-7xl` Inter font-light tracking-tight tabular
- KPI hero number lg: `text-5xl md:text-6xl`
- Overline: `text-[11px] uppercase tracking-[0.08em]` Inter font-medium
- Body: `text-sm` Inter

---

## 3. Border-radius (Apple-like)

- 8px (`rounded-lg`) — chips, inputs pequenos
- 12px (`rounded-xl`) — buttons, inputs principais
- 16px (`rounded-2xl`) — cards, surfaces
- 22px (`rounded-3xl`) — uso raro (não usar mais; preferir `2xl`)

---

## 4. Shadows

Cool, sutis. Light:

```
--shadow-xs:  0 1px 2px rgba(0,0,0,0.04)
--shadow-sm:  0 2px 6px rgba(0,0,0,0.05)
--shadow-md:  0 4px 14px rgba(0,0,0,0.06)
--shadow-lg:  0 12px 32px rgba(0,0,0,0.08)
--shadow-xl:  0 24px 48px rgba(0,0,0,0.10)
```

Dark: adiciona `inset 0 1px 0 rgba(255,255,255,0.04)` (highlight superior) + sombra preta mais forte.

---

## 5. Motion

- Duração: `duration-150` (snappy) ou `duration-200` (refinado)
- Easing: padrão CSS `ease-out` (Apple feel)
- Hover backgrounds: `transition-colors duration-150`

---

## 6. Marble overlay (login only)

```
--marble-overlay-light: linear-gradient(180deg, rgba(245,245,247,0.85), rgba(245,245,247,0.95))
--marble-radial-dark:   radial-gradient(circle at top left, rgba(20,33,61,0.10), transparent 60%)
```

Light mode: aplica `linear-gradient` overlay sobre `/horushawks-marble.svg` no `<main>` do login (classe `marble-bg`). Dark mode: usa só o `radial` navy (sem mármore).

---

## 7. Tenant

`Pacific Shore Stones` é o tenant atual. Aparece como overline acima do H1 "Welcome back" (não como parte do H1). Quando virar multi-tenant, sai do hardcode pra context/session.

---

## Logo assets

- `/horushawks-mark.svg` — pomba poligonal só (24px no nav, 56px no login, 40px no empty state)
- `/horushawks-marble.svg` — textura para `marble-bg` no login (pendente — pode usar mármore real WebP futuramente)

---

## Componentes

Ver `design/components.md` (atualizar separadamente).
