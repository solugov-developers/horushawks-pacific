import { erpQuery } from '@/lib/db/erp';
import { cached } from '@/lib/mobile/cache';
import { getMobileOverview } from '@/lib/queries/mobile';

/**
 * Consultas ao schema `erp.*` do RDS (views materializadas, 1 snapshot/dia,
 * definidas em stoneprofits_robot/sql/erp_views.sql). Uma função por endpoint.
 * Toda resposta traz asOf = snapshot_date da view principal do endpoint.
 * Dinheiro em USD; agregados arredondados para dólar inteiro.
 */

const ERP_STALE_HOURS = 30;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const usd = (v: unknown): number => Math.round(num(v));
const int = (v: unknown): number => Math.round(num(v));
const deltaPct = (cur: number, prev: number | null): number | null =>
  prev == null || prev === 0 ? null : Number((((cur - prev) / prev) * 100).toFixed(1));
const dayOf = (v: unknown): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const isoOf = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const money = (n: number): string => {
  const abs = Math.abs(n);
  const s = abs >= 1_000_000 ? (abs / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
    : abs >= 1_000 ? Math.round(abs / 1_000) + 'k'
    : String(Math.round(abs));
  return (n < 0 ? '-$' : '$') + s;
};

/** Sem cache do BFF: as views só mudam 1×/dia; a tabela é minúscula. */
async function locationLabels(): Promise<Map<string, string>> {
  const rows = await erpQuery<{ code: string; label: string | null }>('SELECT code, label FROM erp.locations');
  return new Map(rows.map(r => [r.code, r.label?.trim() || r.code]));
}
const labelOf = (labels: Map<string, string>, code: string | null | undefined): string =>
  code ? (labels.get(code) ?? code) : '';

/* ------------------------------------------------------------------ */
/* /status                                                             */
/* ------------------------------------------------------------------ */

export interface ErpStatus { snapshot: string; loadedAt: string | null; stale: boolean }

/**
 * Último snapshot carregado. `stale` = snapshot com mais de 30 h (a carga é
 * diária às ~06:00 BRT; 30 h cobre um dia perdido + folga).
 * Lança se o RDS não responder — quem chama decide o fallback.
 */
export async function getErpStatus(): Promise<ErpStatus | null> {
  const rows = await erpQuery<{ snapshot: unknown; loaded_at: unknown }>(
    'SELECT max(snapshot_date) AS snapshot, max(loaded_at) AS loaded_at FROM erp.sales_lines',
  );
  const snapshot = dayOf(rows[0]?.snapshot);
  if (!snapshot) return null; // view vazia: ERP ainda sem carga
  const loadedAt = isoOf(rows[0]?.loaded_at);
  // Referência de idade: loaded_at quando existe; senão o fim do dia do snapshot (UTC).
  const ref = loadedAt ? new Date(loadedAt).getTime() : new Date(snapshot + 'T23:59:59Z').getTime();
  return { snapshot, loadedAt, stale: Date.now() - ref > ERP_STALE_HOURS * 3600 * 1000 };
}

/* ------------------------------------------------------------------ */
/* /erp/today                                                          */
/* ------------------------------------------------------------------ */

export interface ErpAttention { kind: 'overdue_customer' | 'late_container'; title: string; detail: string; tone: 'bad' | 'warn' }
export interface ErpToday {
  asOf: string; stale: boolean;
  sales: {
    date: string | null; total: number; slabs: number; orders: number;
    sameWeekdayLastWeek: number; deltaPct: number | null; mtd: number; mtdLastMonth: number;
  };
  kpis: {
    openSalesOrders: number; openSalesOrdersValue: number;
    receivableOverdue: number; receivableTotal: number; customerCredits: number;
    inventoryValue: number; inventorySlabs: number;
    inTransitSlabs: number; inTransitContainers: number;
  };
  attention: ErpAttention[];
  market: { totalSlabs: number; weekDeltaPct: number | null; arrived7d: number; removed7d: number } | null;
}

const ATTENTION_MAX = 6;
const OVERDUE_90_MIN = 50_000;

/**
 * Itens de chapa em erp.stock: type SLAB (pedra natural, SF) e Quartz (chapas
 * de quartzo, EA). Nunca quantity em SF; tiles, ferramentas, pias etc. ficam
 * fora. available_slabs já é NULL para on_hold/on_so.
 */
const SLAB_ITEMS = `coalesce(kind, '') !~* 'non stock' AND coalesce(type, '') ~* '^(slab|quartz)$'`;

/** Filtro de "ainda não recebido" para in_transit (status é texto livre do ERP). */
const NOT_RECEIVED = `coalesce(status, '') !~* 'receiv|closed|cancel'`;

/**
 * Vendas: só faturas com sale_date <= snapshot_date (o ERP tem faturas
 * pós-datadas; ficam fora até a data chegar). `date` = último dia COMPLETO
 * com vendas: sale_date <= snapshot_date - 1 e total > 0 (a coleta roda às
 * 06:00 BRT, o próprio snapshot_date só tem vendas da madrugada; domingos e
 * feriados sem faturas são pulados). sameWeekdayLastWeek = date - 7.
 */
const SALES_SQL = `
WITH base AS (
  SELECT sale_date, invoice, sale_total, slabs
  FROM erp.sales_lines
  WHERE sale_date IS NOT NULL AND sale_date <= snapshot_date
),
d AS (
  SELECT max(sale_date) AS day FROM base
  WHERE sale_date <= (SELECT max(snapshot_date) FROM erp.sales_lines) - 1
  GROUP BY sale_date HAVING sum(sale_total) > 0
  ORDER BY 1 DESC LIMIT 1
),
agg AS (
  SELECT
    (SELECT day FROM d) AS day,
    coalesce(sum(sale_total) FILTER (WHERE sale_date = d.day), 0)                      AS total,
    coalesce(sum(slabs)      FILTER (WHERE sale_date = d.day), 0)                      AS slabs,
    count(DISTINCT invoice)  FILTER (WHERE sale_date = d.day)                          AS orders,
    coalesce(sum(sale_total) FILTER (WHERE sale_date = d.day - 7), 0)                  AS same_weekday_last_week,
    coalesce(sum(sale_total) FILTER (WHERE sale_date >= date_trunc('month', d.day)::date
                                       AND sale_date <= d.day), 0)                     AS mtd,
    coalesce(sum(sale_total) FILTER (WHERE sale_date >= date_trunc('month', d.day - interval '1 month')::date
                                       AND sale_date <= (d.day - interval '1 month')::date), 0) AS mtd_last_month
  FROM base, d
)
SELECT (SELECT max(snapshot_date) FROM erp.sales_lines) AS snapshot, agg.* FROM agg`;

const KPI_SQL = `
SELECT
  (SELECT count(DISTINCT so) FROM erp.on_so)                                           AS open_so,
  (SELECT coalesce(sum(total_price), 0) FROM erp.on_so)                                AS open_so_value,
  (SELECT coalesce(sum(d1_30)  FILTER (WHERE balance_due > 0), 0) FROM erp.ar_aging)  AS ar_d1_30,
  (SELECT coalesce(sum(d31_60) FILTER (WHERE balance_due > 0), 0) FROM erp.ar_aging)  AS ar_d31_60,
  (SELECT coalesce(sum(d61_90) FILTER (WHERE balance_due > 0), 0) FROM erp.ar_aging)  AS ar_d61_90,
  (SELECT coalesce(sum(d90plus) FILTER (WHERE balance_due > 0), 0) FROM erp.ar_aging) AS ar_d90plus,
  (SELECT coalesce(sum("current") FILTER (WHERE balance_due > 0), 0) FROM erp.ar_aging) AS ar_current,
  (SELECT coalesce(-sum(balance_due) FILTER (WHERE balance_due <= 0), 0) FROM erp.ar_aging) AS ar_credits,
  (SELECT coalesce(sum(asset_value), 0) FROM erp.stock)                                AS inv_value,
  (SELECT coalesce(sum(available_slabs), 0) FROM erp.stock WHERE ${SLAB_ITEMS})       AS inv_slabs,
  (SELECT coalesce(sum(slabs), 0) FROM erp.in_transit WHERE ${NOT_RECEIVED})           AS transit_slabs,
  (SELECT count(DISTINCT container) FROM erp.in_transit
     WHERE ${NOT_RECEIVED} AND coalesce(btrim(container), '') <> '')                    AS transit_containers`;

const OVERDUE_CUSTOMERS_SQL = `
SELECT customer, max(nullif(btrim(customer_code), '')) AS customer_code,
       coalesce(sum(d90plus) FILTER (WHERE balance_due > 0), 0) AS d90plus,
       coalesce(sum(balance_due), 0) AS balance
FROM erp.ar_aging
GROUP BY customer
HAVING coalesce(sum(d90plus) FILTER (WHERE balance_due > 0), 0) > $1
ORDER BY d90plus DESC, balance DESC
LIMIT $2`;

const LATE_CONTAINERS_SQL = `
SELECT po, min(eta) AS eta, (current_date - min(eta))::int AS days_late,
       max(destination) AS destination, max(container) AS container, coalesce(sum(slabs), 0) AS slabs
FROM erp.in_transit
WHERE eta IS NOT NULL AND eta < current_date AND ${NOT_RECEIVED}
GROUP BY po
ORDER BY days_late DESC, slabs DESC
LIMIT $1`;

export async function getErpToday(): Promise<ErpToday> {
  const [sales, kpis, overdue, late, labels, market] = await Promise.all([
    erpQuery(SALES_SQL),
    erpQuery(KPI_SQL),
    erpQuery(OVERDUE_CUSTOMERS_SQL, [OVERDUE_90_MIN, ATTENTION_MAX]),
    erpQuery(LATE_CONTAINERS_SQL, [ATTENTION_MAX]),
    locationLabels(),
    // Bloco "Mercado." reaproveita o overview (mesma chave de cache da rota /overview).
    cached('/api/mobile/v1/overview?', getMobileOverview).then(o => o.body).catch(() => null),
  ]);

  const s = sales[0] ?? {};
  const k = kpis[0] ?? {};
  const total = usd(s.total);
  const sameWeekday = usd(s.same_weekday_last_week);

  const attention: ErpAttention[] = [];
  const overdueItems: ErpAttention[] = overdue.map(r => ({
    kind: 'overdue_customer', title: 'Vencido há 90+ dias',
    detail: `${String(r.customer ?? r.customer_code ?? '').trim()} · ${money(num(r.d90plus))}`,
    tone: 'bad',
  }));
  const lateItems: ErpAttention[] = late.map(r => ({
    kind: 'late_container', title: 'Contêiner atrasado',
    detail: `PO ${String(r.po ?? '').trim()} · ${labelOf(labels, r.destination as string | null) || '—'} · +${int(r.days_late)} d`,
    tone: 'warn',
  }));
  // Até 6 itens: metade de cada tipo, o restante preenchido pelo que sobrar.
  const half = Math.ceil(ATTENTION_MAX / 2);
  attention.push(...overdueItems.slice(0, half), ...lateItems.slice(0, half));
  for (const extra of [...overdueItems.slice(half), ...lateItems.slice(half)]) {
    if (attention.length >= ATTENTION_MAX) break;
    attention.push(extra);
  }

  return {
    asOf: dayOf(s.snapshot) ?? '',
    stale: false,
    sales: {
      date: dayOf(s.day),
      total, slabs: int(s.slabs), orders: int(s.orders),
      sameWeekdayLastWeek: sameWeekday,
      deltaPct: deltaPct(total, sameWeekday),
      mtd: usd(s.mtd), mtdLastMonth: usd(s.mtd_last_month),
    },
    kpis: {
      openSalesOrders: int(k.open_so), openSalesOrdersValue: usd(k.open_so_value),
      // Regra BRUTA (mesma conta do /erp/finance): só faturas em aberto (saldos
      // positivos), faixas arredondadas uma a uma e somadas; créditos à parte.
      receivableOverdue: usd(k.ar_d1_30) + usd(k.ar_d31_60) + usd(k.ar_d61_90) + usd(k.ar_d90plus),
      receivableTotal: usd(k.ar_current) + usd(k.ar_d1_30) + usd(k.ar_d31_60) + usd(k.ar_d61_90) + usd(k.ar_d90plus),
      customerCredits: usd(k.ar_credits),
      inventoryValue: usd(k.inv_value), inventorySlabs: int(k.inv_slabs),
      inTransitSlabs: int(k.transit_slabs), inTransitContainers: int(k.transit_containers),
    },
    attention: attention.slice(0, ATTENTION_MAX),
    market: market ? {
      totalSlabs: market.totalSlabs, weekDeltaPct: market.weekDeltaPct,
      arrived7d: market.arrived7d, removed7d: market.removed7d,
    } : null,
  };
}

/* ------------------------------------------------------------------ */
/* /erp/finance                                                        */
/* ------------------------------------------------------------------ */

export interface ErpFinance {
  asOf: string; stale: boolean;
  receivable: {
    total: number; current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number;
    overdue: number; credits: number; net: number; customers: number;
  };
  topOverdue: { customer: string; code: string | null; balance: number; d90plus: number; location: string | null; salesRep: string | null }[];
  /** null enquanto não existir a view erp.receipts (eod_receipts_deposits). */
  received: { date: string | null; total: number; count: number; mtd: number } | null;
  byLocation: { code: string; label: string; receivable: number; overdue: number; credits: number }[];
  bankTransfers7d: { date: string | null; from: string | null; to: string | null; amount: number }[];
}

/**
 * A RECEBER É BRUTO (decisão do usuário, 2026-09-14): total = só faturas em
 * aberto (balance_due > 0) = current + d1_30 + d31_60 + d61_90 + d90plus.
 * Linhas negativas (Deposit, Receipt, Return Order, Credit Memo, Journal…) são
 * dinheiro já recebido e não casado com fatura: ficam fora do total e vão em
 * `credits`, expresso POSITIVO. net = total - credits. Verificado no snapshot
 * 2026-09-14: nenhuma linha mista (saldo positivo com faixa negativa).
 */
const AR_TOTALS_SQL = `
SELECT max(snapshot_date) AS snapshot,
       coalesce(sum("current") FILTER (WHERE balance_due > 0), 0)    AS current,
       coalesce(sum(d1_30)     FILTER (WHERE balance_due > 0), 0)    AS d1_30,
       coalesce(sum(d31_60)    FILTER (WHERE balance_due > 0), 0)    AS d31_60,
       coalesce(sum(d61_90)    FILTER (WHERE balance_due > 0), 0)    AS d61_90,
       coalesce(sum(d90plus)   FILTER (WHERE balance_due > 0), 0)    AS d90plus,
       coalesce(-sum(balance_due) FILTER (WHERE balance_due <= 0), 0) AS credits,
       count(DISTINCT customer) FILTER (WHERE balance_due > 0)       AS customers
FROM erp.ar_aging`;

/** Por cliente: saldo líquido (inclui créditos), 90+ só das linhas positivas; code = customer_code do ERP (vazio em parte das linhas, por isso max por cliente). */
const TOP_OVERDUE_SQL = `
SELECT customer, max(nullif(btrim(customer_code), '')) AS customer_code,
       coalesce(sum(balance_due), 0) AS balance,
       coalesce(sum(d90plus) FILTER (WHERE balance_due > 0), 0) AS d90plus,
       mode() WITHIN GROUP (ORDER BY location)  FILTER (WHERE coalesce(btrim(location), '') <> '')  AS location,
       mode() WITHIN GROUP (ORDER BY sales_rep) FILTER (WHERE coalesce(btrim(sales_rep), '') <> '') AS sales_rep
FROM erp.ar_aging
GROUP BY customer
HAVING coalesce(sum(d90plus) FILTER (WHERE balance_due > 0), 0) > 0
ORDER BY d90plus DESC, balance DESC
LIMIT 10`;

/**
 * Recebimentos: view erp.receipts (eod_receipts_deposits; type Receipt/Deposit/
 * Refund com amount negativo, 194 linhas sem valor = NULL). erp.payments
 * (payments_all_methods) é dinheiro que SAI e não serve. Se a view sumir:
 * received = null. Regras: date = max(receipt_date) (um dia atrás do
 * snapshot, como sales); total = soma líquida do dia (refund negativo);
 * count = linhas com amount não nulo; mtd = soma do mês de receipt_date.
 */
const RECEIPTS_VIEW = 'erp.receipts';
const RECEIPTS_SQL = `
WITH base AS (
  SELECT receipt_date, amount FROM ${RECEIPTS_VIEW}
  WHERE receipt_date IS NOT NULL AND receipt_date <= snapshot_date
),
d AS (SELECT max(receipt_date) AS day FROM base)
SELECT (SELECT day FROM d) AS day,
       coalesce(sum(amount) FILTER (WHERE receipt_date = d.day), 0) AS total,
       count(amount) FILTER (WHERE receipt_date = d.day)             AS n,   -- só linhas com valor
       coalesce(sum(amount) FILTER (WHERE receipt_date >= date_trunc('month', d.day)::date
                                      AND receipt_date <= d.day), 0) AS mtd
FROM base, d`;

async function receivedFromView(): Promise<ErpFinance['received']> {
  const exists = await erpQuery<{ ok: unknown }>('SELECT to_regclass($1) AS ok', [RECEIPTS_VIEW]);
  if (!exists[0]?.ok) return null;
  const rows = await erpQuery(RECEIPTS_SQL);
  const r = rows[0] ?? {};
  if (!r.day) return null;
  return { date: dayOf(r.day), total: usd(r.total), count: int(r.n), mtd: usd(r.mtd) };
}

/** Por loja, mesma regra bruta: receivable e overdue só de saldos positivos; credits (positivo) à parte. */
const AR_BY_LOCATION_SQL = `
SELECT coalesce(nullif(btrim(location), ''), '(sem loja)') AS code,
       coalesce(sum(balance_due) FILTER (WHERE balance_due > 0), 0) AS receivable,
       coalesce(-sum(balance_due) FILTER (WHERE balance_due <= 0), 0) AS credits,
       coalesce(sum(coalesce(d1_30,0)+coalesce(d31_60,0)+coalesce(d61_90,0)+coalesce(d90plus,0))
                FILTER (WHERE balance_due > 0), 0) AS overdue
FROM erp.ar_aging
GROUP BY 1
ORDER BY receivable DESC`;

const BANK_TRANSFERS_SQL = `
SELECT transfer_date, from_account, to_account, coalesce(amount, 0) AS amount
FROM erp.bank_transfers
WHERE transfer_date IS NOT NULL AND transfer_date >= snapshot_date - 7 AND transfer_date <= snapshot_date
ORDER BY transfer_date DESC, amount DESC
LIMIT 50`;

export async function getErpFinance(): Promise<ErpFinance> {
  const [totals, top, received, byLoc, transfers, labels] = await Promise.all([
    erpQuery(AR_TOTALS_SQL),
    erpQuery(TOP_OVERDUE_SQL),
    receivedFromView(),
    erpQuery(AR_BY_LOCATION_SQL),
    erpQuery(BANK_TRANSFERS_SQL),
    locationLabels(),
  ]);
  const t = totals[0] ?? {};
  const d1 = usd(t.d1_30), d2 = usd(t.d31_60), d3 = usd(t.d61_90), d4 = usd(t.d90plus);
  const current = usd(t.current);
  const total = current + d1 + d2 + d3 + d4;   // bruto: só faturas em aberto
  const credits = usd(t.credits);              // positivo

  return {
    asOf: dayOf(t.snapshot) ?? '',
    stale: false,
    receivable: {
      total, current,
      d1_30: d1, d31_60: d2, d61_90: d3, d90plus: d4,
      overdue: d1 + d2 + d3 + d4,
      credits,
      net: total - credits,
      customers: int(t.customers),
    },
    topOverdue: top.map(x => ({
      customer: String(x.customer ?? '').trim(),
      code: (x.customer_code as string | null)?.trim() || null,
      balance: usd(x.balance), d90plus: usd(x.d90plus),
      location: (x.location as string | null) ?? null,
      salesRep: (x.sales_rep as string | null) ?? null,
    })),
    received,
    byLocation: byLoc.map(x => ({
      code: String(x.code), label: labelOf(labels, String(x.code)),
      receivable: usd(x.receivable), overdue: usd(x.overdue), credits: usd(x.credits),
    })),
    bankTransfers7d: transfers.map(x => ({
      date: dayOf(x.transfer_date),
      from: (x.from_account as string | null) ?? null,
      to: (x.to_account as string | null) ?? null,
      amount: usd(x.amount),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* /erp/sales                                                          */
/* ------------------------------------------------------------------ */

export const SALES_PERIODS = ['day', 'month', 'year'] as const;
export const SALES_GROUPS = ['location', 'rep', 'material'] as const;
export type SalesPeriod = typeof SALES_PERIODS[number];
export type SalesGroup = typeof SALES_GROUPS[number];

export interface ErpSalesRow { key: string; label: string; total: number; slabs: number; orders: number; marginPct: number; sharePct: number }
export interface ErpSales {
  asOf: string; stale: boolean; period: SalesPeriod; groupBy: SalesGroup;
  total: number; prevTotal: number | null; deltaPct: number | null; slabs: number; orders: number;
  avgTicket: number; avgTicketPrev: number | null; avgTicketDeltaPct: number | null; marginPct: number;
  rows: ErpSalesRow[];
}

/**
 * Janelas por período, ancoradas em D = último dia completo com vendas (o
 * mesmo `sales.date` do /erp/today):
 *  day   : [D, D]                       vs [D-7, D-7]
 *  month : [início do mês de D, D]      vs mês anterior completo
 *  year  : [1/jan do ano de D, D]       vs [1/jan do ano anterior, D - 1 ano]
 * Faturas pós-datadas (sale_date > snapshot_date) ficam fora.
 */
const SALES_WINDOW_SQL = `
WITH snap AS (SELECT max(snapshot_date) AS snapshot FROM erp.sales_lines),
d AS (
  SELECT sale_date AS day FROM erp.sales_lines, snap
  WHERE sale_date IS NOT NULL AND sale_date <= snap.snapshot - 1
  GROUP BY sale_date HAVING sum(sale_total) > 0
  ORDER BY sale_date DESC LIMIT 1
)
SELECT snap.snapshot, d.day,
  CASE $1 WHEN 'day' THEN d.day
          WHEN 'month' THEN date_trunc('month', d.day)::date
          ELSE date_trunc('year', d.day)::date END                                   AS cur_from,
  d.day                                                                              AS cur_to,
  CASE $1 WHEN 'day' THEN d.day - 7
          WHEN 'month' THEN date_trunc('month', d.day - interval '1 month')::date
          ELSE date_trunc('year', d.day - interval '1 year')::date END               AS prev_from,
  CASE $1 WHEN 'day' THEN d.day - 7
          WHEN 'month' THEN (date_trunc('month', d.day) - interval '1 day')::date
          ELSE (d.day - interval '1 year')::date END                                 AS prev_to
FROM snap LEFT JOIN d ON true`;

const SALES_TOTALS_SQL = `
SELECT
  coalesce(sum(sale_total) FILTER (WHERE sale_date BETWEEN $1 AND $2), 0) AS total,
  coalesce(sum(slabs)      FILTER (WHERE sale_date BETWEEN $1 AND $2), 0) AS slabs,
  count(DISTINCT invoice)  FILTER (WHERE sale_date BETWEEN $1 AND $2)     AS orders,
  coalesce(sum(margin)     FILTER (WHERE sale_date BETWEEN $1 AND $2), 0) AS margin,
  count(*)                 FILTER (WHERE sale_date BETWEEN $3 AND $4)     AS prev_rows,
  coalesce(sum(sale_total) FILTER (WHERE sale_date BETWEEN $3 AND $4), 0) AS prev_total,
  count(DISTINCT invoice)  FILTER (WHERE sale_date BETWEEN $3 AND $4)     AS prev_orders
FROM erp.sales_lines
WHERE sale_date IS NOT NULL AND sale_date <= snapshot_date`;

/** Expressão de agrupamento por groupBy (whitelist; nunca vem do usuário direto). */
const SALES_GROUP_EXPR: Record<SalesGroup, { key: string; label: string }> = {
  location: { key: `coalesce(nullif(btrim(location), ''), '(sem loja)')`, label: `NULL` },
  rep:      { key: `coalesce(nullif(btrim(sales_rep), ''), '(sem vendedor)')`, label: `NULL` },
  material: { key: `coalesce(nullif(btrim(item), ''), '(sem item)')`,
              label: `mode() WITHIN GROUP (ORDER BY category) FILTER (WHERE coalesce(btrim(category), '') <> '')` },
};

function salesRowsSql(groupBy: SalesGroup): string {
  const g = SALES_GROUP_EXPR[groupBy];
  return `
SELECT ${g.key} AS key, ${g.label} AS label,
       coalesce(sum(sale_total), 0) AS total, coalesce(sum(slabs), 0) AS slabs,
       count(DISTINCT invoice) AS orders, coalesce(sum(margin), 0) AS margin
FROM erp.sales_lines
WHERE sale_date IS NOT NULL AND sale_date <= snapshot_date AND sale_date BETWEEN $1 AND $2
GROUP BY 1
ORDER BY total DESC, key
LIMIT 50`;
}

export async function getErpSales(period: SalesPeriod, groupBy: SalesGroup): Promise<ErpSales> {
  const [win] = await erpQuery(SALES_WINDOW_SQL, [period]);
  const asOf = dayOf(win?.snapshot) ?? '';
  const empty: ErpSales = {
    asOf, stale: false, period, groupBy,
    total: 0, prevTotal: null, deltaPct: null, slabs: 0, orders: 0,
    avgTicket: 0, avgTicketPrev: null, avgTicketDeltaPct: null, marginPct: 0, rows: [],
  };
  if (!win?.day) return empty; // sem nenhum dia com vendas

  const range = [dayOf(win.cur_from), dayOf(win.cur_to), dayOf(win.prev_from), dayOf(win.prev_to)];
  const [totals, rows, labels] = await Promise.all([
    erpQuery(SALES_TOTALS_SQL, range),
    erpQuery(salesRowsSql(groupBy), range.slice(0, 2)),
    groupBy === 'location' ? locationLabels() : Promise.resolve(new Map<string, string>()),
  ]);
  const t = totals[0] ?? {};
  const total = usd(t.total);
  const orders = int(t.orders);
  const hasPrev = num(t.prev_rows) > 0;
  const prevTotal = hasPrev ? usd(t.prev_total) : null;
  const prevOrders = int(t.prev_orders);
  const avgTicket = orders > 0 ? usd(total / orders) : 0;
  const avgTicketPrev = hasPrev && prevOrders > 0 ? usd(num(t.prev_total) / prevOrders) : null;
  const marginPct = (m: unknown, tot: number) => (tot > 0 ? Number(((num(m) / tot) * 100).toFixed(1)) : 0);

  return {
    ...empty,
    total, prevTotal, deltaPct: deltaPct(total, prevTotal),
    slabs: int(t.slabs), orders,
    avgTicket, avgTicketPrev, avgTicketDeltaPct: deltaPct(avgTicket, avgTicketPrev),
    marginPct: marginPct(t.margin, num(t.total)),
    rows: rows.map(r => {
      const key = String(r.key);
      const rowTotal = usd(r.total);
      return {
        key,
        label: groupBy === 'location' ? labelOf(labels, key) : groupBy === 'material' ? String(r.label ?? '') : key,
        total: rowTotal, slabs: int(r.slabs), orders: int(r.orders),
        marginPct: marginPct(r.margin, num(r.total)),
        sharePct: total > 0 ? Number(((rowTotal / total) * 100).toFixed(1)) : 0,
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* /erp/purchasing                                                     */
/* ------------------------------------------------------------------ */

export interface ErpPurchasing {
  asOf: string; stale: boolean;
  incoming: {
    po: string; supplier: string | null; container: string | null;
    destination: string | null; destinationLabel: string | null;
    eta: string | null; daysLate: number; status: string | null;
    slabs: number; cost: number; items: number;
  }[];
  received30d: { slabs: number; cost: number; pos: number };
  pipeline: { slabsOnHold: number; openSalesOrders: number; posNotReceived: number; inTransitSlabs: number; inTransitContainers: number };
}

/** POs em trânsito (status é texto livre e hoje vem vazio no ERP), por ETA asc. */
const INCOMING_SQL = `
SELECT max(snapshot_date) OVER () AS snapshot, po,
       mode() WITHIN GROUP (ORDER BY supplier)    FILTER (WHERE coalesce(btrim(supplier), '') <> '')    AS supplier,
       string_agg(DISTINCT nullif(btrim(container), ''), ', ')                                         AS container,
       mode() WITHIN GROUP (ORDER BY destination) FILTER (WHERE coalesce(btrim(destination), '') <> '') AS destination,
       min(eta) AS eta,
       greatest(current_date - min(eta), 0)::int AS days_late,
       mode() WITHIN GROUP (ORDER BY status)      FILTER (WHERE coalesce(btrim(status), '') <> '')      AS status,
       coalesce(sum(slabs), 0) AS slabs, coalesce(sum(total_cost), 0) AS cost, count(*) AS items
FROM erp.in_transit
WHERE ${NOT_RECEIVED} AND coalesce(btrim(po), '') <> ''
GROUP BY po
ORDER BY min(eta) ASC NULLS LAST, po
LIMIT 50`;

const RECEIVED_30D_SQL = `
SELECT coalesce(sum(slabs), 0) AS slabs,
       coalesce(sum(coalesce(landed_total_cost, fob_total_cost)), 0) AS cost,
       count(DISTINCT po) AS pos
FROM erp.received
WHERE received_date IS NOT NULL AND received_date > snapshot_date - 30 AND received_date <= snapshot_date`;

const PIPELINE_SQL = `
SELECT
  (SELECT coalesce(sum(slabs), 0) FROM erp.on_hold)                                    AS slabs_on_hold,
  (SELECT count(DISTINCT so) FROM erp.on_so)                                           AS open_so,
  (SELECT count(DISTINCT po) FROM erp.in_transit WHERE ${NOT_RECEIVED})                AS pos_not_received,
  (SELECT coalesce(sum(slabs), 0) FROM erp.in_transit WHERE ${NOT_RECEIVED})           AS transit_slabs,
  (SELECT count(DISTINCT container) FROM erp.in_transit
     WHERE ${NOT_RECEIVED} AND coalesce(btrim(container), '') <> '')                    AS transit_containers,
  (SELECT max(snapshot_date) FROM erp.in_transit)                                      AS snapshot`;

export async function getErpPurchasing(): Promise<ErpPurchasing> {
  const [incoming, received, pipeline, labels] = await Promise.all([
    erpQuery(INCOMING_SQL), erpQuery(RECEIVED_30D_SQL), erpQuery(PIPELINE_SQL), locationLabels(),
  ]);
  const p = pipeline[0] ?? {};
  const r = received[0] ?? {};
  return {
    asOf: dayOf(p.snapshot) ?? '',
    stale: false,
    incoming: incoming.map(x => {
      const destination = (x.destination as string | null) ?? null;
      return {
        po: String(x.po).trim(),
        supplier: (x.supplier as string | null) ?? null,
        container: (x.container as string | null) ?? null,
        destination, destinationLabel: destination ? labelOf(labels, destination) : null,
        eta: dayOf(x.eta), daysLate: int(x.days_late),
        status: (x.status as string | null) ?? null,
        slabs: int(x.slabs), cost: usd(x.cost), items: int(x.items),
      };
    }),
    received30d: { slabs: int(r.slabs), cost: usd(r.cost), pos: int(r.pos) },
    pipeline: {
      slabsOnHold: int(p.slabs_on_hold), openSalesOrders: int(p.open_so),
      posNotReceived: int(p.pos_not_received),
      inTransitSlabs: int(p.transit_slabs), inTransitContainers: int(p.transit_containers),
    },
  };
}
