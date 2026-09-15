import { withToken, OPTIONS } from '@/lib/mobile/auth';
import { respondCachedOr503 } from '@/lib/mobile/cache';
import { getErpPurchasing } from '@/lib/queries/erp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

/** GET /erp/purchasing — Compras (contrato v2). Cache 300 s; RDS fora => último payload bom com stale: true, ou 503. */
export const GET = withToken(async (req) => respondCachedOr503(req, getErpPurchasing));
