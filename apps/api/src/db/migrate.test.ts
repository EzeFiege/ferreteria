import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { runMigrations } from './migrate.js';
import {
  createIsolatedTestDatabase,
  type TestDatabaseHandle,
} from './test-db.js';

const { Client } = pg;

describe('API & Migraciones de base de datos', () => {
  let dbHandle: TestDatabaseHandle | undefined;

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase();
  }, 60_000);

  afterAll(async () => {
    if (dbHandle !== undefined) {
      await dbHandle.cleanup();
    }
  });

  it(
    'responde /health correctamente',
    async () => {
      const server = buildServer({
        logger: false,
        databaseUrl: dbHandle?.url,
      });
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'ok',
        rolesDisponibles: ['dueno', 'encargado', 'cajero'],
      });
      await server.close();
    },
    15_000,
  );

  it('contiene las migraciones numeradas en orden y define app_user sin privilegios elevados', async () => {
    const migrationsDir = path.resolve(
      import.meta.dirname,
      '../../../../db/migrations',
    );
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    expect(files).toEqual([
      '001_core_caja.sql',
      '002_rol_app_user.sql',
      '003_catalogo_stock.sql',
    ]);

    const sql002 = await readFile(
      path.join(migrationsDir, '002_rol_app_user.sql'),
      'utf8',
    );
    expect(sql002).toContain('create role app_user');
    expect(sql002).toContain('nosuperuser');
    expect(sql002).toContain('nobypassrls');
  });

  it('aplica migraciones en PostgreSQL real y verifica que app_user respeta RLS', async () => {
    const dbUrl = dbHandle?.url;
    expect(dbUrl).toBeDefined();
    if (dbUrl === undefined) {
      return;
    }

    const firstRun = await runMigrations({
      connectionString: dbUrl,
      appUserPassword: 'app_test_password',
    });
    expect(firstRun).toEqual([
      '001_core_caja.sql',
      '002_rol_app_user.sql',
      '003_catalogo_stock.sql',
    ]);

    // Ejecutar por segunda vez debe ser idempotente (0 nuevas migraciones)
    const secondRun = await runMigrations({
      connectionString: dbUrl,
      appUserPassword: 'app_test_password',
    });
    expect(secondRun).toEqual([]);

    const client = new Client({ connectionString: dbUrl });
    await client.connect();

    try {
      const roleCheck = await client.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcanlogin: boolean;
      }>(
        "select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'app_user'",
      );

      expect(roleCheck.rowCount).toBe(1);
      expect(roleCheck.rows[0]).toEqual({
        rolsuper: false,
        rolbypassrls: false,
        rolcanlogin: true,
      });

      // Verificar aislamiento multi-negocio con app_user
      await client.query('begin');
      await client.query('set local role app_user');

      const neg1 = await client.query<{ id: string }>(
        "insert into negocio (nombre) values ('Ferretería Norte') returning id",
      );
      const neg2 = await client.query<{ id: string }>(
        "insert into negocio (nombre) values ('Ferretería Sur') returning id",
      );

      const neg1Id = neg1.rows[0]?.id;
      const neg2Id = neg2.rows[0]?.id;
      expect(neg1Id).toBeDefined();
      expect(neg2Id).toBeDefined();

      await client.query("select set_config('app.negocio_id', $1, true)", [
        neg1Id,
      ]);
      await client.query('select sembrar_negocio($1)', [neg1Id]);

      await client.query("select set_config('app.negocio_id', $1, true)", [
        neg2Id,
      ]);
      await client.query('select sembrar_negocio($1)', [neg2Id]);

      // Estando en neg2, solo debemos ver los 3 medios de pago de neg2
      const mediosNeg2 = await client.query<{ negocio_id: string }>(
        'select negocio_id from medio_pago',
      );
      expect(mediosNeg2.rowCount).toBe(3);
      expect(mediosNeg2.rows.every((r) => r.negocio_id === neg2Id)).toBe(true);

      await client.query('rollback');
    } finally {
      await client.end();
    }
  });
});
