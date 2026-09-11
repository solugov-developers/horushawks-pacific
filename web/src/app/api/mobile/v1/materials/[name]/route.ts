import { NextResponse } from 'next/server';
import { withToken, bad } from '@/lib/mobile/auth';
import { getMobileMaterial } from '@/lib/queries/mobile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withToken<{ params: Promise<{ name: string }> }>(async (_req, ctx) => {
  const { name } = await ctx.params;
  const itemName = decodeURIComponent(name).trim();
  if (!itemName) return bad('nome vazio');
  const detail = await getMobileMaterial(itemName);
  if (!detail) return bad('material não encontrado', 404);
  return NextResponse.json(detail);
});
