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
type LocationInfo = { label: string; region: string | null };
async function locationLabels(): Promise<Map<string, LocationInfo>> {
  const rows = await erpQuery<{ code: string; label: string | null; region: string | null }>(
    'SELECT code, label, region FROM erp.locations',
  );
  return new Map(rows.map(r => [r.code, { label: r.label?.trim() || r.code, region: r.region?.trim() || null }]));
}
const labelOf = (labels: Map<string, LocationInfo>, code: string | null | undefined): string =>
  code ? (labels.get(code)?.label ?? code) : '';
const regionOf = (labels: Map<string, LocationInfo>, code: string | null | undefined): string | null =>
  code ? (labels.get(code)?.region ?? null) : null;

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
    /** Vendas PARCIAIS do dia do snapshot (sale_date = snapshot_date), até o último pulso (asOf = loaded_at); null sem venda. */
    today: { date: string; total: number; slabs: number; orders: number; asOf: string | null } | null;
  };
  kpis: {
    openSalesOrders: number; openSalesOrdersValue: number;
    receivableOverdue: number; receivableTotal: number; customerCredits: number;
    /** contas a pagar que vencem de hoje a +7 dias (erp.ap_aging, saldos positivos) */
    payableDue7d: number;
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
/**
 * REGRA ÚNICA de "chapas em estoque" (kpis.inventorySlabs do /erp/today e
 * totalSlabs do /erp/inventory): soma de available_slabs dos itens de chapa.
 * available_slabs já vem NULL para on_hold/on_so, então conta só o disponível.
 */
const INVENTORY_SLABS_EXPR = `coalesce(sum(available_slabs) FILTER (WHERE ${SLAB_ITEMS}), 0)`;

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

/** Vendas parciais do próprio dia do snapshot (o pulso intradiário recarrega sales_lines). */
const SALES_TODAY_SQL = `
SELECT max(snapshot_date) AS day, max(loaded_at) AS loaded_at,
       coalesce(sum(sale_total), 0) AS total, coalesce(sum(slabs), 0) AS slabs, count(DISTINCT invoice) AS orders
FROM erp.sales_lines WHERE sale_date = snapshot_date
HAVING count(*) > 0`;

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
  (SELECT coalesce(sum(balance_due) FILTER (WHERE balance_due > 0 AND due_date BETWEEN current_date AND current_date + 7), 0)
     FROM erp.ap_aging)                                                                AS ap_due7d,
  (SELECT coalesce(sum(asset_value), 0) FROM erp.stock)                                AS inv_value,
  (SELECT ${INVENTORY_SLABS_EXPR} FROM erp.stock)                                        AS inv_slabs,
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
SELECT po::text AS po, min(eta) AS eta, (current_date - min(eta))::int AS days_late,
       max(destination) AS destination, max(container) AS container, coalesce(sum(slabs), 0) AS slabs
FROM erp.in_transit
WHERE eta IS NOT NULL AND eta < current_date AND ${NOT_RECEIVED}
GROUP BY po::text
ORDER BY days_late DESC, slabs DESC
LIMIT $1`;

export async function getErpToday(): Promise<ErpToday> {
  const [sales, today, kpis, overdue, late, labels, market] = await Promise.all([
    erpQuery(SALES_SQL),
    erpQuery(SALES_TODAY_SQL),
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
      today: today[0] && dayOf(today[0].day)
        ? { date: dayOf(today[0].day)!, total: usd(today[0].total), slabs: int(today[0].slabs), orders: int(today[0].orders), asOf: isoOf(today[0].loaded_at) }
        : null,
    },
    kpis: {
      openSalesOrders: int(k.open_so), openSalesOrdersValue: usd(k.open_so_value),
      // Regra BRUTA (mesma conta do /erp/finance): só faturas em aberto (saldos
      // positivos), faixas arredondadas uma a uma e somadas; créditos à parte.
      receivableOverdue: usd(k.ar_d1_30) + usd(k.ar_d31_60) + usd(k.ar_d61_90) + usd(k.ar_d90plus),
      receivableTotal: usd(k.ar_current) + usd(k.ar_d1_30) + usd(k.ar_d31_60) + usd(k.ar_d61_90) + usd(k.ar_d90plus),
      customerCredits: usd(k.ar_credits),
      payableDue7d: usd(k.ap_due7d),
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
  /** Contas a pagar (erp.ap_aging), mesma regra bruta do a receber; due7d = vence de hoje a +7 dias. */
  payable: {
    total: number; current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number;
    credits: number; overdue: number; due7d: number; suppliers: number;
  };
  topPayables: { party: string; code: string | null; kind: string | null; category: string | null; balance: number; dueDate: string | null; overdue: number; location: string | null }[];
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

/**
 * Contas a pagar (erp.ap_aging: Aged Payables Detail, subtotais já excluídos na
 * view). Regra BRUTA igual ao a receber: faixas e total só de linhas com
 * balance_due > 0; linhas negativas (créditos com fornecedores) em `credits`
 * positivo; due7d = saldo positivo com due_date entre hoje e hoje + 7.
 */
const AP_TOTALS_SQL = `
SELECT coalesce(sum("current") FILTER (WHERE balance_due > 0), 0)    AS current,
       coalesce(sum(d1_30)     FILTER (WHERE balance_due > 0), 0)    AS d1_30,
       coalesce(sum(d31_60)    FILTER (WHERE balance_due > 0), 0)    AS d31_60,
       coalesce(sum(d61_90)    FILTER (WHERE balance_due > 0), 0)    AS d61_90,
       coalesce(sum(d90plus)   FILTER (WHERE balance_due > 0), 0)    AS d90plus,
       coalesce(-sum(balance_due) FILTER (WHERE balance_due <= 0), 0) AS credits,
       coalesce(sum(balance_due) FILTER (WHERE balance_due > 0
                 AND due_date BETWEEN current_date AND current_date + 7), 0) AS due7d,
       count(DISTINCT supplier)                                      AS suppliers   -- todas as partes do relatório (321)
FROM erp.ap_aging`;

/** Por fornecedor: saldo líquido, vencido (faixas das linhas positivas), próximo vencimento em aberto. */
const TOP_PAYABLES_SQL = `
SELECT supplier AS party, max(nullif(btrim(supplier_code), '')) AS code,
       max(nullif(btrim(party_kind), ''))     AS kind,
       max(nullif(btrim(party_category), '')) AS category,
       coalesce(sum(balance_due), 0) AS balance,
       min(due_date) FILTER (WHERE balance_due > 0) AS due_date,
       coalesce(sum(coalesce(d1_30,0)+coalesce(d31_60,0)+coalesce(d61_90,0)+coalesce(d90plus,0))
                FILTER (WHERE balance_due > 0), 0) AS overdue,
       mode() WITHIN GROUP (ORDER BY location) FILTER (WHERE coalesce(btrim(location), '') <> '') AS location
FROM erp.ap_aging
GROUP BY supplier
HAVING coalesce(sum(balance_due), 0) > 0
ORDER BY balance DESC, party
LIMIT 10`;

const BANK_TRANSFERS_SQL = `
SELECT transfer_date, from_account, to_account, coalesce(amount, 0) AS amount
FROM erp.bank_transfers
WHERE transfer_date IS NOT NULL AND transfer_date >= snapshot_date - 7 AND transfer_date <= snapshot_date
ORDER BY transfer_date DESC, amount DESC
LIMIT 50`;

export async function getErpFinance(): Promise<ErpFinance> {
  const [totals, top, received, byLoc, transfers, labels, ap, topAp] = await Promise.all([
    erpQuery(AR_TOTALS_SQL),
    erpQuery(TOP_OVERDUE_SQL),
    receivedFromView(),
    erpQuery(AR_BY_LOCATION_SQL),
    erpQuery(BANK_TRANSFERS_SQL),
    locationLabels(),
    erpQuery(AP_TOTALS_SQL),
    erpQuery(TOP_PAYABLES_SQL),
  ]);
  const p = ap[0] ?? {};
  const p1 = usd(p.d1_30), p2 = usd(p.d31_60), p3 = usd(p.d61_90), p4 = usd(p.d90plus), pc = usd(p.current);
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
    payable: {
      total: pc + p1 + p2 + p3 + p4, current: pc,
      d1_30: p1, d31_60: p2, d61_90: p3, d90plus: p4,
      credits: usd(p.credits), overdue: p1 + p2 + p3 + p4,
      due7d: usd(p.due7d), suppliers: int(p.suppliers),
    },
    topPayables: topAp.map(x => ({
      party: String(x.party ?? '').trim(),
      code: (x.code as string | null) ?? null,
      kind: (x.kind as string | null) ?? null,
      category: (x.category as string | null) ?? null,
      balance: usd(x.balance), dueDate: dayOf(x.due_date), overdue: usd(x.overdue),
      location: (x.location as string | null) ?? null,
    })),
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

export interface ErpSalesRow { key: string; label: string; sub: string | null; total: number; slabs: number; orders: number; marginPct: number; sharePct: number }
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
 *  month : [início do mês de D, D]      vs [início do mês anterior, D - 1 mês]  (mesmo dia; = mtdLastMonth)
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
          WHEN 'month' THEN (d.day - interval '1 month')::date
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

/**
 * Expressão de agrupamento por groupBy (whitelist; nunca vem do usuário direto).
 * `sub` = subtítulo: loja → região (erp.locations), vendedor → loja mais
 * frequente, material → categoria. label de loja é resolvido depois (erp.locations).
 */
const SALES_GROUP_EXPR: Record<SalesGroup, { key: string; sub: string }> = {
  location: { key: `coalesce(nullif(btrim(location), ''), '(sem loja)')`, sub: `NULL` },
  rep:      { key: `coalesce(nullif(btrim(sales_rep), ''), '(sem vendedor)')`,
              sub: `mode() WITHIN GROUP (ORDER BY location) FILTER (WHERE coalesce(btrim(location), '') <> '')` },
  material: { key: `coalesce(nullif(btrim(item), ''), '(sem item)')`,
              sub: `mode() WITHIN GROUP (ORDER BY category) FILTER (WHERE coalesce(btrim(category), '') <> '')` },
};

function salesRowsSql(groupBy: SalesGroup): string {
  const g = SALES_GROUP_EXPR[groupBy];
  return `
SELECT ${g.key} AS key, ${g.sub} AS sub,
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
    locationLabels(),
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
      const sub = (r.sub as string | null) ?? null;
      return {
        key,
        label: groupBy === 'location' ? labelOf(labels, key) : key,
        sub: groupBy === 'location' ? regionOf(labels, key)
           : groupBy === 'rep' ? (sub ? labelOf(labels, sub) : null)
           : sub,
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

/**
 * POs em trânsito (status é texto livre e hoje vem vazio no ERP), por ETA asc.
 * po::text: o load.py infere o tipo da coluna crua no primeiro dia (pode ser
 * bigint num banco e text noutro); em texto funciona nos dois.
 */
const INCOMING_SQL = `
SELECT po::text AS po,
       mode() WITHIN GROUP (ORDER BY supplier)    FILTER (WHERE coalesce(btrim(supplier), '') <> '')    AS supplier,
       string_agg(DISTINCT nullif(btrim(container), ''), ', ')                                         AS container,
       mode() WITHIN GROUP (ORDER BY destination) FILTER (WHERE coalesce(btrim(destination), '') <> '') AS destination,
       min(eta) AS eta,
       greatest(current_date - min(eta), 0)::int AS days_late,
       mode() WITHIN GROUP (ORDER BY status)      FILTER (WHERE coalesce(btrim(status), '') <> '')      AS status,
       coalesce(sum(slabs), 0) AS slabs, coalesce(sum(total_cost), 0) AS cost, count(*) AS items
FROM erp.in_transit
WHERE ${NOT_RECEIVED} AND coalesce(btrim(po::text), '') <> ''
GROUP BY po::text
ORDER BY min(eta) ASC NULLS LAST, po::text
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

/* ------------------------------------------------------------------ */
/* /erp/inventory e /erp/materials                                     */
/* ------------------------------------------------------------------ */

import { pacshoreThumbMap, thumbFor, nameKey, marketName, findCompetitorItemName } from '@/lib/queries/pacshore';
import { getMobileMaterial } from '@/lib/queries/mobile';

/** "2cm Taj Mahal - Premium" -> "2 cm"; "12mm Neolith" -> "12 mm"; sem espessura -> null. */
export function thicknessOf(product: string): string | null {
  const m = /\b(\d+(?:\.\d+)?)\s*(cm|mm)\b/i.exec(product);
  return m ? `${m[1]} ${m[2].toLowerCase()}` : null;
}

export type Velocity = 'fast' | 'normal' | 'slow' | 'dead';
export interface Aging { d0_90: number; d91_180: number; d181_365: number; d365plus: number }
export const AGE_BUCKETS = ['d0_90', 'd91_180', 'd181_365', 'd365plus'] as const;
export const VELOCITIES = ['fast', 'normal', 'slow', 'dead'] as const;
export interface ErpInventoryRow {
  product: string; category: string | null; type: string | null; thickness: string | null;
  slabs: number; available: number; onHold: number; onSo: number; inTransit: number;
  assetValue: number; avgSizeIn: [number, number] | null; locations: string[]; imageUrl: string | null;
  /** v2.2: idade (chapas em estoque por faixa desde received_date) e velocidade */
  aging: Aging; oldestReceivedAt: string | null; sold90d: number; daysOfStock: number | null; velocity: Velocity;
}

/**
 * Velocidade (contrato v2.2): daysOfStock = available / (sold90d / 90), null sem
 * venda em 90 d. fast <= 60 · normal · slow > 365 (ou sem venda em 90 d) ·
 * dead = sem venda em 365 d E chapa mais antiga com > 365 d.
 */
export function velocityOf(available: number, sold90d: number, sold365d: number, oldestAgeDays: number | null): { daysOfStock: number | null; velocity: Velocity } {
  const daysOfStock = sold90d > 0 ? Math.round(available / (sold90d / 90)) : null;
  if (sold365d === 0 && oldestAgeDays != null && oldestAgeDays > 365) return { daysOfStock, velocity: 'dead' };
  if (daysOfStock == null) return { daysOfStock, velocity: 'slow' };
  return { daysOfStock, velocity: daysOfStock <= 60 ? 'fast' : daysOfStock > 365 ? 'slow' : 'normal' };
}
export interface Facet { key: string; label: string; count: number }
export interface Facets { types: Facet[]; thicknesses: Facet[]; regions: Facet[]; locations: Facet[]; velocity?: Facet[]; age?: Facet[] }
export interface ErpInventory {
  asOf: string; stale: boolean;
  totalSlabs: number; totalValue: number; totalMaterials: number;
  page: number; pageSize: number;
  locations: { code: string; label: string }[];
  facets: Facets;
  /** v2.2: chapas mortas/lentas e idade média das chapas em estoque (sobre a base de q/region/location) */
  summary: { deadSlabs: number; deadValue: number; slowSlabs: number; slowValue: number; avgAgeDays: number | null };
  rows: ErpInventoryRow[];
}
export const INVENTORY_STATUS = ['available', 'hold', 'transit', 'photo'] as const;
export const INVENTORY_SORT = ['slabs', 'value', 'name', 'age', 'velocity'] as const;
export type InventoryStatus = typeof INVENTORY_STATUS[number];
export type InventorySort = typeof INVENTORY_SORT[number];
export interface ErpInventoryOpts {
  q?: string | null; location?: string[] | null; region?: string[] | null;
  type?: string[] | null; thickness?: string[] | null;
  velocity?: string[] | null; age?: string[] | null;
  status?: InventoryStatus | null; sort?: InventorySort | null;
  page: number; pageSize: number;
}

/**
 * Espessura da Pacific: erp.stock não tem coluna; vem do NOME do produto
 * ("2cm Taj Mahal", "1.2cm …", "12mm Neolith …") normalizada para "2 cm",
 * "1.2 cm", "12 mm". \y = limite de palavra no regex do Postgres. Sem
 * espessura no nome -> NULL (fora do facet e do filtro).
 */
const ERP_THICKNESS_SQL = `
  (SELECT CASE WHEN m IS NULL THEN NULL ELSE m[1] || ' ' || lower(m[2]) END
   FROM (SELECT regexp_match(product, '\\y(\\d+(?:\\.\\d+)?)\\s*(cm|mm)\\y', 'i') AS m) t)`;

/**
 * Estoque em mãos por produto: uma linha de erp.stock = uma chapa (serial).
 * Só itens de chapa (SLAB_ITEMS). slabs/available/onHold/onSo contam chapas
 * físicas por status; inTransit = chapas em POs não recebidos (erp.in_transit),
 * a MESMA medida do detalhe /erp/materials. Transferências entre lojas
 * (status in_transit do stock) ficam só em lots[].status.
 * totalSlabs = INVENTORY_SLABS_EXPR (igual a kpis.inventorySlabs).
 */
/**
 * base = estoque de chapas filtrado por q / location / region (os facets são
 * calculados sobre ela). type (= erp.stock.category: Quartzite, Marble…),
 * thickness, status e sort são aplicados em memória sobre as linhas agrupadas
 * (≤ 3 mil produtos), porque status=photo depende do índice de fotos e
 * porque assim os facets ficam consistentes com o contrato.
 */
const INVENTORY_SQL = `
WITH base AS (
  SELECT s.*, ${ERP_THICKNESS_SQL} AS thickness_n, l.region
  FROM erp.stock s LEFT JOIN erp.locations l ON l.code = btrim(s.location)
  WHERE ${SLAB_ITEMS}
    AND ($1::text[] IS NULL OR coalesce(btrim(s.location), '') = ANY($1))
    AND ($2::text IS NULL OR s.product ILIKE $2 OR coalesce(s.category, '') ILIKE $2 OR coalesce(s.type, '') ILIKE $2)
    AND ($3::text[] IS NULL OR l.region = ANY($3))
),
po AS (
  SELECT product, coalesce(sum(slabs), 0) AS in_transit FROM erp.in_transit
  WHERE ${NOT_RECEIVED} GROUP BY product
),
sold AS (
  SELECT item AS product,
         coalesce(sum(slabs) FILTER (WHERE sale_date > snapshot_date - 90), 0)  AS sold90,
         coalesce(sum(slabs), 0)                                               AS sold365
  FROM erp.sales_lines
  WHERE sale_date IS NOT NULL AND sale_date <= snapshot_date AND sale_date > snapshot_date - 365
  GROUP BY item
),
g AS (
  SELECT b.product,
         mode() WITHIN GROUP (ORDER BY category) FILTER (WHERE coalesce(btrim(category), '') <> '') AS category,
         mode() WITHIN GROUP (ORDER BY type)     FILTER (WHERE coalesce(btrim(type), '') <> '')     AS type,
         max(thickness_n)                                AS thickness,
         count(*)                                        AS slabs,
         count(*) FILTER (WHERE status = 'in_stock')     AS available,
         count(*) FILTER (WHERE status = 'on_hold')      AS on_hold,
         count(*) FILTER (WHERE status = 'on_so')        AS on_so,
         coalesce(max(po.in_transit), 0)                 AS in_transit,
         coalesce(sum(asset_value), 0)                   AS asset_value,
         ${INVENTORY_SLABS_EXPR}                         AS inv_slabs,
         count(*) FILTER (WHERE status = 'in_stock' AND received_date >  current_date - 90)                              AS age0,
         count(*) FILTER (WHERE status = 'in_stock' AND received_date <= current_date - 90  AND received_date > current_date - 180) AS age1,
         count(*) FILTER (WHERE status = 'in_stock' AND received_date <= current_date - 180 AND received_date > current_date - 365) AS age2,
         count(*) FILTER (WHERE status = 'in_stock' AND received_date <= current_date - 365)                              AS age3,
         min(received_date) FILTER (WHERE status = 'in_stock')                                                             AS oldest,
         coalesce(sum(current_date - received_date) FILTER (WHERE status = 'in_stock'), 0)                                AS age_sum,
         coalesce(max(sold.sold90), 0)                   AS sold90,
         coalesce(max(sold.sold365), 0)                  AS sold365,
         round(avg(length_in))                           AS avg_len,
         round(avg(width_in))                            AS avg_wid,
         array_remove(array_agg(DISTINCT nullif(btrim(location), '') ORDER BY nullif(btrim(location), '')), NULL) AS locations
  FROM base b LEFT JOIN po ON po.product = b.product LEFT JOIN sold ON sold.product = b.product
  WHERE coalesce(btrim(b.product), '') <> ''
  GROUP BY b.product
)
SELECT g.*, (SELECT max(snapshot_date) FROM erp.stock) AS snapshot
FROM g
ORDER BY slabs DESC, product`;

/** Facets (chapas = INVENTORY_SLABS_EXPR) sobre a mesma base de q/location/region; eixo locations só com lojas (region não nulo). */
const INVENTORY_FACETS_SQL = `
WITH base AS (
  SELECT s.*, ${ERP_THICKNESS_SQL} AS thickness_n, l.region
  FROM erp.stock s LEFT JOIN erp.locations l ON l.code = btrim(s.location)
  WHERE ${SLAB_ITEMS}
    AND ($1::text[] IS NULL OR coalesce(btrim(s.location), '') = ANY($1))
    AND ($2::text IS NULL OR s.product ILIKE $2 OR coalesce(s.category, '') ILIKE $2 OR coalesce(s.type, '') ILIKE $2)
    AND ($3::text[] IS NULL OR l.region = ANY($3))
)
SELECT axis, key, n FROM (
  SELECT 'types' AS axis, nullif(btrim(category), '') AS key, ${INVENTORY_SLABS_EXPR} AS n FROM base GROUP BY 2
  UNION ALL SELECT 'thicknesses', thickness_n, ${INVENTORY_SLABS_EXPR} FROM base GROUP BY 2
  UNION ALL SELECT 'regions', region, ${INVENTORY_SLABS_EXPR} FROM base GROUP BY 2
  UNION ALL SELECT 'locations', CASE WHEN region IS NOT NULL THEN nullif(btrim(location), '') END, ${INVENTORY_SLABS_EXPR} FROM base GROUP BY 2
) f WHERE key IS NOT NULL AND n > 0
ORDER BY axis, n DESC, key`;

/** Só LOJAS (códigos com region em erp.locations); depósitos e terceiros entram nas contagens, não no filtro. */
const STOCK_LOCATIONS_SQL = `
SELECT l.code FROM erp.locations l
WHERE l.region IS NOT NULL
  AND EXISTS (SELECT 1 FROM erp.stock s WHERE btrim(s.location) = l.code AND ${SLAB_ITEMS})
ORDER BY l.code`;

const listOrNull = (v?: string[] | null): string[] | null => (v && v.length ? v : null);
const FACET_MAX = 12;

/** Agrupa linhas (axis, key, n) em Facets com até 12 por eixo e label resolvido. */
export function buildFacets(rows: { axis: unknown; key: unknown; n: unknown }[], label: (axis: string, key: string) => string): Facets {
  const out: Facets = { types: [], thicknesses: [], regions: [], locations: [] };
  for (const r of rows) {
    const axis = String(r.axis) as keyof Facets;
    const list = out[axis];
    if (!list || list.length >= FACET_MAX) continue;
    const key = String(r.key);
    list.push({ key, label: label(axis, key), count: int(r.n) });
  }
  return out;
}

export async function getErpInventory(opts: ErpInventoryOpts): Promise<ErpInventory> {
  const { page, pageSize } = opts;
  const loc = listOrNull(opts.location?.filter(v => v && v !== 'all'));
  const region = listOrNull(opts.region);
  const q = opts.q?.trim() ? `%${opts.q.trim()}%` : null;
  const [grouped, facetRows, locs, labels, thumbs] = await Promise.all([
    erpQuery(INVENTORY_SQL, [loc, q, region]),
    erpQuery<{ axis: string; key: string | null; n: unknown }>(INVENTORY_FACETS_SQL, [loc, q, region]),
    erpQuery<{ code: string }>(STOCK_LOCATIONS_SQL),
    locationLabels(),
    pacshoreThumbMap(),
  ]);
  const snapshot = grouped[0]?.snapshot ?? (await erpQuery('SELECT max(snapshot_date) AS s FROM erp.stock'))[0]?.s;

  const today = new Date(dayOf(snapshot) ?? new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  let all = grouped.map(r => {
    const product = String(r.product);
    const available = int(r.available);
    const oldest = dayOf(r.oldest);
    const oldestAge = oldest ? Math.round((today - new Date(oldest + 'T00:00:00Z').getTime()) / 86_400_000) : null;
    const { daysOfStock, velocity } = velocityOf(available, int(r.sold90), int(r.sold365), oldestAge);
    return {
      row: {
        product,
        category: (r.category as string | null) ?? null,
        type: (r.type as string | null) ?? null,
        thickness: (r.thickness as string | null) ?? thicknessOf(product),
        slabs: int(r.slabs), available, onHold: int(r.on_hold), onSo: int(r.on_so), inTransit: int(r.in_transit),
        assetValue: usd(r.asset_value),
        avgSizeIn: (r.avg_len != null && r.avg_wid != null ? [int(r.avg_len), int(r.avg_wid)] : null) as [number, number] | null,
        locations: (r.locations as string[]) ?? [],
        imageUrl: thumbFor(thumbs, product),
        aging: { d0_90: int(r.age0), d91_180: int(r.age1), d181_365: int(r.age2), d365plus: int(r.age3) },
        oldestReceivedAt: oldest, sold90d: int(r.sold90), daysOfStock, velocity,
      } satisfies ErpInventoryRow,
      invSlabs: int(r.inv_slabs),
      ageSum: num(r.age_sum),
    };
  });
  // facets de velocidade/idade e summary: sobre a base (q/region/location), antes dos demais filtros
  const velCount: Record<string, number> = {}; const ageCount: Record<string, number> = {};
  let deadSlabs = 0, deadValue = 0, slowSlabs = 0, slowValue = 0, ageSum = 0, ageN = 0;
  for (const x of all) {
    velCount[x.row.velocity] = (velCount[x.row.velocity] ?? 0) + x.row.slabs;
    for (const b of AGE_BUCKETS) ageCount[b] = (ageCount[b] ?? 0) + x.row.aging[b];
    if (x.row.velocity === 'dead') { deadSlabs += x.row.slabs; deadValue += x.row.assetValue; }
    if (x.row.velocity === 'slow') { slowSlabs += x.row.slabs; slowValue += x.row.assetValue; }
    ageSum += x.ageSum; ageN += x.row.available;
  }
  const summary = { deadSlabs, deadValue, slowSlabs, slowValue, avgAgeDays: ageN > 0 ? Math.round(ageSum / ageN) : null };
  const velFacet = VELOCITIES.filter(v => velCount[v]).map(v => ({ key: v, label: v, count: velCount[v] }));
  const ageFacet = AGE_BUCKETS.filter(b => ageCount[b]).map(b => ({ key: b, label: b, count: ageCount[b] }));
  const types = listOrNull(opts.type?.map(nameKey));
  const thick = listOrNull(opts.thickness?.map(nameKey));
  if (types) all = all.filter(x => x.row.category && types.includes(nameKey(x.row.category)));
  if (thick) all = all.filter(x => x.row.thickness && thick.includes(nameKey(x.row.thickness)));
  const vel = listOrNull(opts.velocity?.map(v => v.trim().toLowerCase()));
  const age = listOrNull(opts.age?.map(v => v.trim().toLowerCase()));
  if (vel) all = all.filter(x => vel.includes(x.row.velocity));
  if (age) all = all.filter(x => age.some(b => (x.row.aging as unknown as Record<string, number>)[b] > 0));
  switch (opts.status) {
    case 'available': all = all.filter(x => x.row.available > 0); break;
    case 'hold':      all = all.filter(x => x.row.onHold > 0); break;
    case 'transit':   all = all.filter(x => x.row.inTransit > 0); break;
    case 'photo':     all = all.filter(x => x.row.imageUrl != null); break;
  }
  const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
  const velRank: Record<Velocity, number> = { dead: 0, slow: 1, normal: 2, fast: 3 };
  switch (opts.sort ?? 'slabs') {
    case 'value': all.sort((a, b) => b.row.assetValue - a.row.assetValue || byName(a.row.product, b.row.product)); break;
    case 'name':  all.sort((a, b) => byName(a.row.product, b.row.product)); break;
    // mais velho primeiro (sem data no fim)
    case 'age':   all.sort((a, b) => (a.row.oldestReceivedAt ?? '9999').localeCompare(b.row.oldestReceivedAt ?? '9999') || byName(a.row.product, b.row.product)); break;
    // mortas -> lentas -> normais -> rápidas; dentro da faixa, mais dias de estoque primeiro
    case 'velocity': all.sort((a, b) => velRank[a.row.velocity] - velRank[b.row.velocity] || (b.row.daysOfStock ?? 1e9) - (a.row.daysOfStock ?? 1e9) || byName(a.row.product, b.row.product)); break;
    default:      all.sort((a, b) => b.row.slabs - a.row.slabs || byName(a.row.product, b.row.product));
  }

  return {
    asOf: dayOf(snapshot) ?? '',
    stale: false,
    totalSlabs: all.reduce((n, x) => n + x.invSlabs, 0),
    totalValue: all.reduce((n, x) => n + x.row.assetValue, 0),
    totalMaterials: all.length,
    page, pageSize,
    locations: locs.map(l => ({ code: l.code, label: labelOf(labels, l.code) })),
    facets: { ...buildFacets(facetRows, (axis, key) => (axis === 'locations' ? labelOf(labels, key) : key)), velocity: velFacet, age: ageFacet },
    summary,
    rows: all.slice((page - 1) * pageSize, page * pageSize).map(x => x.row),
  };
}

export interface ErpLot {
  serial: string | null; lot: string | null; bundle: string | null; location: string | null;
  status: string; sizeIn: [number, number] | null; receivedAt: string | null;
  supplier: string | null; customer: string | null; holdUntil: string | null;
}
export interface ErpMaterial {
  asOf: string; stale: boolean;
  product: string; category: string | null; type: string | null; thickness: string | null; imageUrl: string | null;
  slabs: number; available: number; onHold: number; onSo: number; inTransit: number;
  assetValue: number; availableSf: number; avgSizeIn: [number, number] | null;
  avgCostSf: number | null; avgPriceSf: number | null; sold30d: number; sold30dValue: number;
  /** v2.2 */
  aging: Aging; oldestReceivedAt: string | null; sold90d: number; daysOfStock: number | null; velocity: Velocity;
  byLocation: { code: string; label: string; slabs: number; available: number }[];
  lots: ErpLot[];
  incoming: { po: string; supplier: string | null; eta: string | null; slabs: number; status: string | null }[];
  competitors: { itemName: string; slabs: number; sources: number; removed30d: number } | null;
}

/** Nome exato; fallback por caixa/espaços (mesma chave do cruzamento de fotos). */
const MATERIAL_NAME_SQL = `
SELECT product FROM erp.stock
WHERE product = $1 OR lower(regexp_replace(btrim(product), '\\s+', ' ', 'g')) = $2
GROUP BY product ORDER BY (product = $1) DESC, count(*) DESC LIMIT 1`;

const MATERIAL_SUMMARY_SQL = `
SELECT max(snapshot_date) AS snapshot,
       mode() WITHIN GROUP (ORDER BY category) FILTER (WHERE coalesce(btrim(category), '') <> '') AS category,
       mode() WITHIN GROUP (ORDER BY type)     FILTER (WHERE coalesce(btrim(type), '') <> '')     AS type,
       count(*) AS slabs,
       count(*) FILTER (WHERE status = 'in_stock')   AS available,
       count(*) FILTER (WHERE status = 'on_hold')    AS on_hold,
       count(*) FILTER (WHERE status = 'on_so')      AS on_so,
       count(*) FILTER (WHERE status = 'in_transit') AS transfer,
       coalesce(sum(asset_value), 0) AS asset_value,
       coalesce(sum(available_qty) FILTER (WHERE status = 'in_stock' AND coalesce(units, '') ~* '^sf$'), 0) AS available_sf,
       round(avg(length_in)) AS avg_len, round(avg(width_in)) AS avg_wid,
       avg(unit_landed_cost) FILTER (WHERE unit_landed_cost > 0) AS avg_cost_sf,
       count(*) FILTER (WHERE status = 'in_stock' AND received_date >  current_date - 90)                              AS age0,
       count(*) FILTER (WHERE status = 'in_stock' AND received_date <= current_date - 90  AND received_date > current_date - 180) AS age1,
       count(*) FILTER (WHERE status = 'in_stock' AND received_date <= current_date - 180 AND received_date > current_date - 365) AS age2,
       count(*) FILTER (WHERE status = 'in_stock' AND received_date <= current_date - 365)                              AS age3,
       min(received_date) FILTER (WHERE status = 'in_stock') AS oldest
FROM erp.stock WHERE product = $1`;

const MATERIAL_BY_LOCATION_SQL = `
SELECT btrim(location) AS code, count(*) AS slabs, count(*) FILTER (WHERE status = 'in_stock') AS available
FROM erp.stock WHERE product = $1 AND coalesce(btrim(location), '') <> ''
GROUP BY 1 ORDER BY slabs DESC, code`;

/** Lotes (uma linha por serial). customer/holdUntil vêm de on_hold/on_so pelo serial. */
const MATERIAL_LOTS_SQL = `
SELECT s.serial, nullif(btrim(s.lot), '') AS lot, nullif(btrim(s.bundle), '') AS bundle,
       nullif(btrim(s.location), '') AS location, s.status, s.length_in, s.width_in, s.received_date,
       nullif(btrim(s.supplier), '') AS supplier,
       coalesce(nullif(btrim(h.customer), ''), nullif(btrim(o.customer), '')) AS customer,
       h.expiry_date AS hold_until
FROM erp.stock s
LEFT JOIN LATERAL (SELECT customer, expiry_date FROM erp.on_hold x WHERE x.serial = s.serial AND x.product = s.product LIMIT 1) h ON s.status = 'on_hold'
LEFT JOIN LATERAL (SELECT customer FROM erp.on_so y WHERE y.serial = s.serial AND y.product = s.product LIMIT 1) o ON s.status = 'on_so'
WHERE s.product = $1
ORDER BY CASE s.status WHEN 'in_stock' THEN 0 WHEN 'on_hold' THEN 1 WHEN 'on_so' THEN 2 ELSE 3 END, s.received_date DESC NULLS LAST, s.serial
LIMIT 300`;

const MATERIAL_INCOMING_SQL = `
SELECT po::text AS po,
       mode() WITHIN GROUP (ORDER BY supplier) FILTER (WHERE coalesce(btrim(supplier), '') <> '') AS supplier,
       min(eta) AS eta, coalesce(sum(slabs), 0) AS slabs,
       mode() WITHIN GROUP (ORDER BY status) FILTER (WHERE coalesce(btrim(status), '') <> '') AS status
FROM erp.in_transit
WHERE product = $1 AND ${NOT_RECEIVED} AND coalesce(btrim(po::text), '') <> ''
GROUP BY po::text ORDER BY min(eta) ASC NULLS LAST, po::text LIMIT 20`;

/** Vendas do produto: 30 d para sold30d; 90 d para preço médio por SF (sale_total / qty em SF). */
const MATERIAL_SALES_SQL = `
SELECT coalesce(sum(slabs) FILTER (WHERE sale_date > snapshot_date - 30), 0)      AS sold30d,
       coalesce(sum(slabs) FILTER (WHERE sale_date > snapshot_date - 90), 0)      AS sold90d,
       coalesce(sum(slabs) FILTER (WHERE sale_date > snapshot_date - 365), 0)     AS sold365d,
       coalesce(sum(sale_total) FILTER (WHERE sale_date > snapshot_date - 30), 0) AS sold30d_value,
       sum(sale_total) FILTER (WHERE sale_date > snapshot_date - 90 AND coalesce(uom, '') ~* '^sf$' AND qty > 0) AS sf_total,
       sum(qty)        FILTER (WHERE sale_date > snapshot_date - 90 AND coalesce(uom, '') ~* '^sf$' AND qty > 0) AS sf_qty
FROM erp.sales_lines WHERE item = $1 AND sale_date IS NOT NULL AND sale_date <= snapshot_date`;

async function competitorSummary(name: string): Promise<ErpMaterial['competitors']> {
  if (!name) return null;
  try {
    const out = await cached<{ v: ErpMaterial['competitors'] }>(`competitors:${nameKey(name)}`, async () => {
      const canonical = await findCompetitorItemName(name);
      const m = canonical ? await getMobileMaterial(canonical) : null;
      return { v: m ? { itemName: m.itemName, slabs: m.slabs, sources: m.sources.length, removed30d: m.removed30d } : null };
    });
    return out.body?.v ?? null;
  } catch (err) {
    console.error('[erp/materials] concorrentes indisponíveis:', err instanceof Error ? err.message : err);
    return null;
  }
}

const sizeOf = (l: unknown, w: unknown): [number, number] | null =>
  l != null && w != null && num(l) > 0 && num(w) > 0 ? [int(l), int(w)] : null;

export async function getErpMaterial(productInput: string): Promise<ErpMaterial | null> {
  const found = await erpQuery<{ product: string }>(MATERIAL_NAME_SQL, [productInput, nameKey(productInput)]);
  const product = found[0]?.product;
  if (!product) return null;

  const [summary, byLoc, lots, incoming, sales, labels, thumbs] = await Promise.all([
    erpQuery(MATERIAL_SUMMARY_SQL, [product]),
    erpQuery(MATERIAL_BY_LOCATION_SQL, [product]),
    erpQuery(MATERIAL_LOTS_SQL, [product]),
    erpQuery(MATERIAL_INCOMING_SQL, [product]),
    erpQuery(MATERIAL_SALES_SQL, [product]),
    locationLabels(),
    pacshoreThumbMap(),
  ]);
  const s = summary[0] ?? {};
  const v = sales[0] ?? {};

  // Concorrentes: mesmo material pelo nome "de mercado" (sem espessura/acabamento/Premium).
  // Cacheado por nome (5 min): o resumo custa ~5 consultas ao Postgres dos scrapers.
  const competitors = await competitorSummary(marketName(product));

  const inTransit = incoming.reduce((a, r) => a + int(r.slabs), 0);
  return {
    asOf: dayOf(s.snapshot) ?? '',
    stale: false,
    product,
    category: (s.category as string | null) ?? null,
    type: (s.type as string | null) ?? null,
    thickness: thicknessOf(product),
    imageUrl: thumbFor(thumbs, product),
    slabs: int(s.slabs), available: int(s.available), onHold: int(s.on_hold), onSo: int(s.on_so), inTransit,
    assetValue: usd(s.asset_value), availableSf: int(s.available_sf),
    avgSizeIn: sizeOf(s.avg_len, s.avg_wid),
    avgCostSf: s.avg_cost_sf != null ? Number(num(s.avg_cost_sf).toFixed(1)) : null,
    avgPriceSf: num(v.sf_qty) > 0 ? Number((num(v.sf_total) / num(v.sf_qty)).toFixed(1)) : null,
    sold30d: int(v.sold30d), sold30dValue: usd(v.sold30d_value),
    aging: { d0_90: int(s.age0), d91_180: int(s.age1), d181_365: int(s.age2), d365plus: int(s.age3) },
    oldestReceivedAt: dayOf(s.oldest), sold90d: int(v.sold90d),
    ...velocityOf(int(s.available), int(v.sold90d), int(v.sold365d),
      dayOf(s.oldest) ? Math.round((new Date((dayOf(s.snapshot) ?? '') + 'T00:00:00Z').getTime() - new Date(dayOf(s.oldest) + 'T00:00:00Z').getTime()) / 86_400_000) : null),
    byLocation: byLoc.map(r => ({ code: String(r.code), label: labelOf(labels, String(r.code)), slabs: int(r.slabs), available: int(r.available) })),
    lots: lots.map(r => ({
      serial: (r.serial as string | null) ?? null,
      lot: (r.lot as string | null) ?? (typeof r.serial === 'string' && r.serial.includes('-') ? r.serial.split('-')[0] : null),
      bundle: (r.bundle as string | null) ?? null,
      location: (r.location as string | null) ?? null,
      status: String(r.status ?? 'other'),
      sizeIn: sizeOf(r.length_in, r.width_in),
      receivedAt: dayOf(r.received_date),
      supplier: (r.supplier as string | null) ?? null,
      customer: (r.customer as string | null) ?? null,
      holdUntil: dayOf(r.hold_until),
    })),
    incoming: incoming.map(r => ({
      po: String(r.po).trim(), supplier: (r.supplier as string | null) ?? null,
      eta: dayOf(r.eta), slabs: int(r.slabs), status: (r.status as string | null) ?? null,
    })),
    competitors,
  };
}
