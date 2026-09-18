import { withToken, intParam, OPTIONS } from '@/lib/mobile/auth';
import { respondCachedOr503 } from '@/lib/mobile/cache';
import { getErpPurchaseSuggestions } from '@/lib/queries/erp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

/** GET /erp/purchase-suggestions?limit=30 — fast movers e chapas sugeridas (contrato v2.2). */
export const GET = withToken(async (req) => {
  const limit = intParam(req.nextUrl.searchParams.get('limit'), 30, 1, 100);
  return respondCachedOr503(req, () => getErpPurchaseSuggestions(limit));
});
