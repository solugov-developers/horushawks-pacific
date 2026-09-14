import { withToken, bad, OPTIONS } from '@/lib/mobile/auth';
import { respondCached } from '@/lib/mobile/cache';
import { getMobileMaterial } from '@/lib/queries/mobile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

export const GET = withToken<{ params: Promise<{ name: string }> }>(async (req, ctx) => {
  const { name } = await ctx.params;
  const itemName = decodeURIComponent(name).trim();
  if (!itemName) return bad('nome vazio');
  // extraKey: o pathname já traz o nome codificado, mas a forma decodificada
  // evita duas entradas para "Taj%20Mahal" e "Taj+Mahal".
  const res = await respondCached(req, () => getMobileMaterial(itemName), { extraKey: itemName });
  if (!res) return bad('material não encontrado', 404);
  return res;
});
