/**
 * URL pública de uma miniatura a partir da chave S3 (thumbs/<sha1>.jpg).
 * IMG_CDN_BASE (ex.: https://d123.cloudfront.net): CloudFront com OAC na frente
 * do bucket, prefixo thumbs/ — o app recebe a URL da CDN e as imagens não
 * passam pelo Lightsail. Sem a variável, o proxy /api/mobile/v1/thumb/<sha1>
 * continua servindo (fallback). Sem barra final.
 */
const IMG_BASE = process.env.APP_PUBLIC_URL ?? 'https://app.horushawks.com';
const IMG_CDN_BASE = (process.env.IMG_CDN_BASE ?? '').replace(/\/+$/, '');

export function thumbUrl(thumbKey: unknown): string | null {
  if (typeof thumbKey !== 'string') return null;
  const m = /thumbs\/([0-9a-f]+)\.jpg$/.exec(thumbKey);
  if (!m) return null;
  return IMG_CDN_BASE ? `${IMG_CDN_BASE}/thumbs/${m[1]}.jpg` : `${IMG_BASE}/api/mobile/v1/thumb/${m[1]}`;
}
