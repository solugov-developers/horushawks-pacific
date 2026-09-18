import { withToken, intParam, OPTIONS } from '@/lib/mobile/auth';
import { respondCachedOr503 } from '@/lib/mobile/cache';
import { getErpHolds } from '@/lib/queries/erp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

/** GET /erp/holds?location=&rep=&minDays=&maxDays=&page=&pageSize=50 — chapas em hold por idade da reserva (v2.2, rev. 2026-09-18). */
export const GET = withToken(async (req) => {
  const sp = req.nextUrl.searchParams;
  const days = (v: string | null) => (v == null || v === '' ? null : intParam(v, 0, 0, 100_000));
  const opts = {
    location: sp.get('location'), rep: sp.get('rep'),
    minDays: days(sp.get('minDays')), maxDays: days(sp.get('maxDays')),
    page: intParam(sp.get('page'), 1, 1, 10_000), pageSize: intParam(sp.get('pageSize'), 50, 1, 200),
  };
  return respondCachedOr503(req, () => getErpHolds(opts));
});
