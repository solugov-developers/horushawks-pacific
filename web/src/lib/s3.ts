import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// Credenciais vêm do ambiente (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY),
// resolvidas pelo provider padrão do SDK. Bucket privado; só este proxy lê.
const REGION = process.env.AWS_REGION ?? 'us-east-1';
const BUCKET = process.env.S3_BUCKET ?? '';

let _client: S3Client | null = null;
function client(): S3Client {
  return (_client ??= new S3Client({ region: REGION }));
}

export interface ThumbObject {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Lê thumbs/<hash>.jpg do S3 (thumbnail já processado pelo pipeline). hash é o
 * sha1 (40 hex) da image_url de origem. Thumbnails são pequenos (~30 KB), então
 * bufferizar é trivial. Retorna null se bucket ausente, hash inválido ou 404.
 */
export async function getThumbObject(hash: string): Promise<ThumbObject | null> {
  if (!BUCKET || !/^[0-9a-f]{40}$/.test(hash)) return null;
  try {
    const out = await client().send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `thumbs/${hash}.jpg` }),
    );
    if (!out.Body) return null;
    const bytes = await out.Body.transformToByteArray();
    return { bytes, contentType: out.ContentType ?? 'image/jpeg' };
  } catch {
    return null;
  }
}
