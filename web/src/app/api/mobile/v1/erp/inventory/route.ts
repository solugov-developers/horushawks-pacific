import { withToken, intParam, OPTIONS } from '@/lib/mobile/auth';
import { respondCachedOr503 } from '@/lib/mobile/cache';
import { getErpInventory } from '@/lib/queries/erp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

/** GET /erp/inventory?q=&location=<code|all>&page=1&pageSize=50 — Estoque · Pacific (contrato v2). */
export const GET = withToken(async (req) => {
  const sp = req.nextUrl.searchParams;
  const opts = {
    q: sp.get('q'),
    location: sp.get('location'),
    page: intParam(sp.get('page'), 1, 1, 10_000),
    pageSize: intParam(sp.get('pageSize'), 50, 1, 200),
  };
  return respondCachedOr503(req, () => getErpInventory(opts));
});
