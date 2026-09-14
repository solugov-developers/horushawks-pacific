import { withToken, intParam, OPTIONS } from '@/lib/mobile/auth';
import { respondCached } from '@/lib/mobile/cache';
import { getMobileInventory } from '@/lib/queries/mobile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

export const GET = withToken(async (req) => {
  const sp = req.nextUrl.searchParams;
  const opts = {
    q: sp.get('q'),
    source: sp.get('source'),
    page: intParam(sp.get('page'), 1, 1, 10_000),
    pageSize: intParam(sp.get('pageSize'), 50, 1, 200),
  };
  return (await respondCached(req, () => getMobileInventory(opts)))!;
});
