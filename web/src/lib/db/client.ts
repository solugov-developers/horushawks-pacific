import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

const pool = global.__pgPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

if (process.env.NODE_ENV !== 'production') {
  global.__pgPool = pool;
}

export const db = drizzle(pool, { schema });
