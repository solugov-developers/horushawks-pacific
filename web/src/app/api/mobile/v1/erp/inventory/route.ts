import { withToken, bad, intParam, OPTIONS } from '@/lib/mobile/auth';
import { respondCachedOr503 } from '@/lib/mobile/cache';
import { getErpInventory, INVENTORY_STATUS, INVENTORY_SORT, type InventoryStatus, type InventorySort } from '@/lib/queries/erp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

/** "a, b,,c" -> ["a","b","c"]; ausente -> null. */
function listParam(v: string | null): string[] | null {
  if (v == null) return null;
  const out = v.split(',').map(s => s.trim()).filter(Boolean);
  return out.length ? out : null;
}

/**
 * GET /erp/inventory?q=&type=&thickness=&region=&location=&velocity=&age=&status=&sort=&page=&pageSize=
 * Estoque · Pacific (contrato v2 + filtros v2.1). type = erp.stock.category
 * (Quartzite, Marble…); thickness normalizada ("2 cm"); region via erp.locations.
 */
export const GET = withToken(async (req) => {
  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const sort = sp.get('sort');
  if (status && !(INVENTORY_STATUS as readonly string[]).includes(status)) return bad(`status deve ser um de: ${INVENTORY_STATUS.join(', ')}`);
  if (sort && !(INVENTORY_SORT as readonly string[]).includes(sort)) return bad(`sort deve ser um de: ${INVENTORY_SORT.join(', ')}`);
  const opts = {
    q: sp.get('q'),
    location: listParam(sp.get('location')),
    region: listParam(sp.get('region')),
    type: listParam(sp.get('type')),
    thickness: listParam(sp.get('thickness')),
    velocity: listParam(sp.get('velocity')),
    age: listParam(sp.get('age')),
    status: (status as InventoryStatus | null) ?? null,
    sort: (sort as InventorySort | null) ?? null,
    page: intParam(sp.get('page'), 1, 1, 10_000),
    pageSize: intParam(sp.get('pageSize'), 50, 1, 200),
  };
  return respondCachedOr503(req, () => getErpInventory(opts));
});
