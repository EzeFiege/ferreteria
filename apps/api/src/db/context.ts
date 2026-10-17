import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import * as schema from './schema.js';

export type TenantDb = NodePgDatabase<typeof schema>;

export interface TenantTransactionContext {
  db: TenantDb;
  client: pg.PoolClient;
}

/**
 * Reglas 8 y 9 de AGENTS.md:
 * Ejecuta una transacción bajo el rol `app_user` (sin superusuario ni bypassrls)
 * y fija `app.negocio_id` tomando el valor verificado del token.
 */
export async function withTenantTransaction<T>(
  pool: pg.Pool,
  negocioId: string,
  fn: (ctx: TenantTransactionContext) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role app_user');
    await client.query("select set_config('app.negocio_id', $1, true)", [
      negocioId,
    ]);

    const db = drizzle(client, { schema });
    const result = await fn({ db, client });

    await client.query('commit');
    return result;
  } catch (err: unknown) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
