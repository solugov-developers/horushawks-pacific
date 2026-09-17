import { withToken, bad, intParam, OPTIONS } from '@/lib/mobile/auth';
import { respondCached } from '@/lib/mobile/cache';
import { getMobileInventory, MARKET_INVENTORY_STATUS, MARKET_INVENTORY_SORT } from '@/lib/queries/mobile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

function listParam(v: string | null): string[] | null {
  if (v == null) return null;
  const out = v.split(',').map(s => s.trim()).filter(Boolean);
  return out.length ? out : null;
}

/** GET /inventory?q=&source=&type=&thickness=&location=&status=&sort=&page=&pageSize= — concorrentes (v2 + filtros v2.1). */
export const GET = withToken(async (req) => {
  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const sort = sp.get('sort');
  if (status && !(MARKET_INVENTORY_STATUS as readonly string[]).includes(status)) return bad(`status deve ser um de: ${MARKET_INVENTORY_STATUS.join(', ')}`);
  if (sort && !(MARKET_INVENTORY_SORT as readonly string[]).includes(sort)) return bad(`sort deve ser um de: ${MARKET_INVENTORY_SORT.join(', ')}`);
  const opts = {
    q: sp.get('q'),
    source: sp.get('source'),
    location: listParam(sp.get('location')),
    type: listParam(sp.get('type')),
    thickness: listParam(sp.get('thickness')),
    status: (status as typeof MARKET_INVENTORY_STATUS[number] | null) ?? null,
    sort: (sort as typeof MARKET_INVENTORY_SORT[number] | null) ?? null,
    page: intParam(sp.get('page'), 1, 1, 10_000),
    pageSize: intParam(sp.get('pageSize'), 50, 1, 200),
  };
  return (await respondCached(req, () => getMobileInventory(opts)))!;
});
