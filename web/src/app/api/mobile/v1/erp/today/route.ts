import { withToken, OPTIONS } from '@/lib/mobile/auth';
import { respondCached } from '@/lib/mobile/cache';
import { getErpToday } from '@/lib/queries/erp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

/** GET /erp/today — tela Hoje (contrato v2). Cache 300 s; RDS fora => último payload bom com stale: true. */
export const GET = withToken(async (req) => (await respondCached(req, getErpToday))!);
