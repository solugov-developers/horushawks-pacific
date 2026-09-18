import { withToken, intParam, OPTIONS } from '@/lib/mobile/auth';
import { respondCachedOr503 } from '@/lib/mobile/cache';
import { getErpHolds } from '@/lib/queries/erp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

/** GET /erp/holds?location=&rep=&page=&pageSize=50 — chapas em hold (contrato v2.2). */
export const GET = withToken(async (req) => {
  const sp = req.nextUrl.searchParams;
  const opts = { location: sp.get('location'), rep: sp.get('rep'), page: intParam(sp.get('page'), 1, 1, 10_000), pageSize: intParam(sp.get('pageSize'), 50, 1, 200) };
  return respondCachedOr503(req, () => getErpHolds(opts));
});
