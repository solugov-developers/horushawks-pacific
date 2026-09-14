import { getThumbObject } from '@/lib/s3';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Proxy do thumbnail (bucket S3 privado -> URL estável e cacheável pro app).
// Sem auth de propósito: as imagens de origem já são públicas nos sites dos
// fornecedores, e o hash (sha1 da URL de origem) não é adivinhável. A API de
// DADOS continua protegida por token; só a imagem é aberta.
export async function GET(_req: Request, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params;
  const obj = await getThumbObject(hash);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.bytes as BodyInit, {
    headers: {
      'Content-Type': obj.contentType,
      'Cache-Control': 'public, max-age=604800, immutable',
    },
  });
}
