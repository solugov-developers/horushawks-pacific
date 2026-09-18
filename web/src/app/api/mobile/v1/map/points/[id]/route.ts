import { withToken, bad, OPTIONS } from '@/lib/mobile/auth';
import { respondCached } from '@/lib/mobile/cache';
import { getMapPoint } from '@/lib/queries/map';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

/** GET /map/points/<id> — materiais da praça (top 20) e, para concorrentes, o gap local. 404 se a bolha não existir. */
export const GET = withToken<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const { id } = await ctx.params;
  const key = decodeURIComponent(id).trim();
  if (!key) return bad('id vazio');
  const res = await respondCached(req, () => getMapPoint(key), { extraKey: key });
  if (!res) return bad('ponto não encontrado', 404);
  return res;
});
