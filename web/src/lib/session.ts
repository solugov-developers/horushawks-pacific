import { cookies } from 'next/headers';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const COOKIE_NAME = 'horushawks.session';
const SESSION_DAYS = 7;

// Validação lazy: só roda quando vai usar (em runtime, não no build).
let _secretKey: Uint8Array | null = null;
function getSecretKey(): Uint8Array {
  if (_secretKey) return _secretKey;
  const secret = process.env.AUTH_SECRET;
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && (!secret || secret.length < 32)) {
    throw new Error('AUTH_SECRET ausente ou curto demais em produção (>= 32 chars).');
  }
  _secretKey = new TextEncoder().encode(secret || 'dev-only-do-not-use-in-prod-please-please');
  return _secretKey;
}

export interface SessionPayload extends JWTPayload {
  userId: number;
  username: string;
  role: string;
}

export async function createSession(payload: { userId: number; username: string; role: string }): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * SESSION_DAYS;
  const token = await new SignJWT({ userId: payload.userId, username: payload.username, role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getSecretKey());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/** Lê e valida a sessão do cookie atual. Retorna null se ausente/inválida. */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ['HS256'] });
    if (typeof payload.userId !== 'number' || typeof payload.username !== 'string') return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Helper para o middleware Edge — usa Web Crypto via `jose` para evitar Node-only deps.
 * Recebe o JWT direto (string ou null) e devolve a sessão ou null.
 */
export async function verifySessionToken(token: string | null | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ['HS256'] });
    if (typeof payload.userId !== 'number') return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
