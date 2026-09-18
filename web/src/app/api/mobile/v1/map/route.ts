import { withToken, OPTIONS } from '@/lib/mobile/auth';
import { respondCached } from '@/lib/mobile/cache';
import { getMap } from '@/lib/queries/map';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

/** GET /map — cobertura geográfica: concorrentes (inventory_latest) + Pacific (erp.stock), contrato v2.3. */
export const GET = withToken(async (req) => (await respondCached(req, getMap))!);
