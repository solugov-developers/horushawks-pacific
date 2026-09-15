import { withToken, bad, OPTIONS } from '@/lib/mobile/auth';
import { respondCachedOr503 } from '@/lib/mobile/cache';
import { getErpSales, SALES_PERIODS, SALES_GROUPS, type SalesPeriod, type SalesGroup } from '@/lib/queries/erp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

/** GET /erp/sales?period=day|month|year&groupBy=location|rep|material — Vendas · Pacific (contrato v2). */
export const GET = withToken(async (req) => {
  const sp = req.nextUrl.searchParams;
  const period = sp.get('period') ?? 'month';
  const groupBy = sp.get('groupBy') ?? 'location';
  if (!(SALES_PERIODS as readonly string[]).includes(period)) return bad(`period deve ser um de: ${SALES_PERIODS.join(', ')}`);
  if (!(SALES_GROUPS as readonly string[]).includes(groupBy)) return bad(`groupBy deve ser um de: ${SALES_GROUPS.join(', ')}`);
  return respondCachedOr503(req, () => getErpSales(period as SalesPeriod, groupBy as SalesGroup));
});
