const bcrypt = require('bcrypt');
const db = require('./db');

const BCRYPT_ROUNDS = 12;

/**
 * Hash de senha com bcrypt.
 */
async function hashPassword(plain) {
  return bcrypt.hash(String(plain), BCRYPT_ROUNDS);
}

/**
 * Verifica username + password contra a tabela users.
 * Retorna { id, username, role } se OK, ou null.
 */
async function verifyCredentials(username, password) {
  if (!username || !password) return null;
  const { rows } = await db.query(
    `SELECT id, username, password_hash, role FROM users WHERE username = $1`,
    [String(username)]
  );
  if (rows.length === 0) return null;
  const user = rows[0];
  const ok = await bcrypt.compare(String(password), user.password_hash);
  if (!ok) return null;

  // Atualiza last_login_at em background
  db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]).catch(() => {});

  return { id: user.id, username: user.username, role: user.role };
}

/**
 * Bootstrap: garante que existe pelo menos 1 admin no DB.
 * Se a tabela users estiver vazia, lê PANEL_USER/PANEL_PASSWORD do env
 * e cria o admin. Senão, no-op.
 *
 * Roda no startup do panel (server.js).
 */
async function bootstrapAdmin() {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM users`);
  if (rows[0].n > 0) return;

  const username = process.env.PANEL_USER;
  const password = process.env.PANEL_PASSWORD;
  if (!username || !password) {
    console.warn('[auth] users table vazia mas PANEL_USER/PASSWORD não definidos no env. Login bloqueado.');
    return;
  }

  const hash = await hashPassword(password);
  await db.query(
    `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (username) DO NOTHING`,
    [username, hash]
  );
  console.log(`[auth] admin "${username}" criado a partir de PANEL_PASSWORD (env). Mude a senha em /settings.`);
}

module.exports = { hashPassword, verifyCredentials, bootstrapAdmin };
