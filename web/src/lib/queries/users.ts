import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';

export interface UserCredentials {
  id: number;
  username: string;
  role: string;
}

/**
 * Verifica username + password contra a tabela users (mesma do panel EJS).
 * Retorna { id, username, role } se OK, ou null.
 */
export async function verifyUserCredentials(
  username: string,
  password: string
): Promise<UserCredentials | null> {
  if (!username || !password) return null;

  const r = await db.execute(sql`
    SELECT id, username, password_hash, role FROM users WHERE username = ${username}
  `);
  if (r.rows.length === 0) return null;
  const row = r.rows[0] as { id: number; username: string; password_hash: string; role: string };
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return null;

  // Atualiza last_login_at em background, sem await
  db.execute(sql`UPDATE users SET last_login_at = now() WHERE id = ${row.id}`).catch(() => {});

  return { id: Number(row.id), username: row.username, role: row.role };
}
