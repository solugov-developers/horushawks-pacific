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
    receivableOverdue: number; receivableTotal: number;
    inventoryValue: number; inventorySlabs: number;
    inTransitSlabs: number; inTransitContainers: number;
  };
  attention: ErpAttention[];
  market: { totalSlabs: number; weekDeltaPct: number | null; arrived7d: number; removed7d: number } | null;
}

const ATTENTION_MAX = 6;
const OVERDUE_90_MIN = 50_000;

/** Filtro de "ainda não recebido" para in_transit (status é texto livre do ERP). */
const NOT_RECEIVED = `coalesce(status, '') !~* 'receiv|closed|cancel'`;

/**
 * Vendas: só faturas com sale_date <= snapshot_date (o ERP tem faturas
 * pós-datadas; ficam fora até a data chegar). `date` = último dia com vendas.
 */
const SALES_SQL = `
WITH base AS (
  SELECT sale_date, invoice, sale_total, slabs
  FROM erp.sales_lines
  WHERE sale_date IS NOT NULL AND sale_date <= snapshot_date
),
d AS (SELECT max(sale_date) AS day FROM base),
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
  (SELECT coalesce(sum(coalesce(d1_30,0)+coalesce(d31_60,0)+coalesce(d61_90,0)+coalesce(d90plus,0)), 0)
     FROM erp.ar_aging)                                                                AS ar_overdue,
  (SELECT coalesce(sum(balance_due), 0) FROM erp.ar_aging)                             AS ar_total,
  (SELECT coalesce(sum(asset_value), 0) FROM erp.stock)                                AS inv_value,
  (SELECT coalesce(sum(instock_qty), 0) FROM erp.stock
     WHERE coalesce(units, '') ~* 'slab' OR coalesce(serial, '') <> '')                 AS inv_slabs,
  (SELECT coalesce(sum(slabs), 0) FROM erp.in_transit WHERE ${NOT_RECEIVED})           AS transit_slabs,
  (SELECT count(DISTINCT container) FROM erp.in_transit
     WHERE ${NOT_RECEIVED} AND coalesce(btrim(container), '') <> '')                    AS transit_containers`;

const OVERDUE_CUSTOMERS_SQL = `
SELECT customer, customer_code,
       coalesce(sum(d90plus), 0) AS d90plus, coalesce(sum(balance_due), 0) AS balance
FROM erp.ar_aging
GROUP BY customer, customer_code
HAVING coalesce(sum(d90plus), 0) > $1
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
      receivableOverdue: usd(k.ar_overdue), receivableTotal: usd(k.ar_total),
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
    overdue: number; customers: number;
  };
  topOverdue: { customer: string; code: string | null; balance: number; d90plus: number; location: string | null; salesRep: string | null }[];
  received: { date: string | null; total: number; count: number; mtd: number };
  byLocation: { code: string; label: string; receivable: number; overdue: number }[];
  bankTransfers7d: { date: string | null; from: string | null; to: string | null; amount: number }[];
}

const AR_TOTALS_SQL = `
SELECT max(snapshot_date) AS snapshot,
       coalesce(sum(balance_due), 0) AS total,
       coalesce(sum("current"), 0)   AS current,
       coalesce(sum(d1_30), 0)       AS d1_30,
       coalesce(sum(d31_60), 0)      AS d31_60,
       coalesce(sum(d61_90), 0)      AS d61_90,
       coalesce(sum(d90plus), 0)     AS d90plus,
       count(DISTINCT coalesce(nullif(btrim(customer_code), ''), customer)) AS customers
FROM erp.ar_aging`;

const TOP_OVERDUE_SQL = `
SELECT customer, customer_code,
       coalesce(sum(balance_due), 0) AS balance, coalesce(sum(d90plus), 0) AS d90plus,
       mode() WITHIN GROUP (ORDER BY location)  AS location,
       mode() WITHIN GROUP (ORDER BY sales_rep) AS sales_rep
FROM erp.ar_aging
GROUP BY customer, customer_code
HAVING coalesce(sum(d90plus), 0) > 0 OR coalesce(sum(coalesce(d1_30,0)+coalesce(d31_60,0)+coalesce(d61_90,0)), 0) > 0
ORDER BY d90plus DESC, balance DESC
LIMIT 10`;

/** Recebimentos = payments type=Customer, até o snapshot (sem pós-datados). */
const RECEIVED_SQL = `
WITH base AS (
  SELECT payment_date, payment_amt
  FROM erp.payments
  WHERE coalesce(type, '') ~* 'customer' AND payment_date IS NOT NULL AND payment_date <= snapshot_date
),
d AS (SELECT max(payment_date) AS day FROM base)
SELECT (SELECT day FROM d) AS day,
       coalesce(sum(payment_amt) FILTER (WHERE payment_date = d.day), 0) AS total,
       count(*) FILTER (WHERE payment_date = d.day)                       AS n,
       coalesce(sum(payment_amt) FILTER (WHERE payment_date >= date_trunc('month', d.day)::date
                                           AND payment_date <= d.day), 0) AS mtd
FROM base, d`;

const AR_BY_LOCATION_SQL = `
SELECT coalesce(nullif(btrim(location), ''), '(sem loja)') AS code,
       coalesce(sum(balance_due), 0) AS receivable,
       coalesce(sum(coalesce(d1_30,0)+coalesce(d31_60,0)+coalesce(d61_90,0)+coalesce(d90plus,0)), 0) AS overdue
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
    erpQuery(RECEIVED_SQL),
    erpQuery(AR_BY_LOCATION_SQL),
    erpQuery(BANK_TRANSFERS_SQL),
    locationLabels(),
  ]);
  const t = totals[0] ?? {};
  const r = received[0] ?? {};
  const d1 = usd(t.d1_30), d2 = usd(t.d31_60), d3 = usd(t.d61_90), d4 = usd(t.d90plus);

  return {
    asOf: dayOf(t.snapshot) ?? '',
    stale: false,
    receivable: {
      total: usd(t.total), current: usd(t.current),
      d1_30: d1, d31_60: d2, d61_90: d3, d90plus: d4,
      overdue: d1 + d2 + d3 + d4,
      customers: int(t.customers),
    },
    topOverdue: top.map(x => ({
      customer: String(x.customer ?? '').trim(),
      code: (x.customer_code as string | null)?.trim() || null,
      balance: usd(x.balance), d90plus: usd(x.d90plus),
      location: (x.location as string | null) ?? null,
      salesRep: (x.sales_rep as string | null) ?? null,
    })),
    received: { date: dayOf(r.day), total: usd(r.total), count: int(r.n), mtd: usd(r.mtd) },
    byLocation: byLoc.map(x => ({
      code: String(x.code), label: labelOf(labels, String(x.code)),
      receivable: usd(x.receivable), overdue: usd(x.overdue),
    })),
    bankTransfers7d: transfers.map(x => ({
      date: dayOf(x.transfer_date),
      from: (x.from_account as string | null) ?? null,
      to: (x.to_account as string | null) ?? null,
      amount: usd(x.amount),
    })),
  };
}
