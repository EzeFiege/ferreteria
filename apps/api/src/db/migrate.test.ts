import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.js';
import {
  createIsolatedTestDatabase,
  type TestDatabaseHandle,
} from './test-db.js';
import { buildServer } from '../server.js';

const { Client } = pg;

describe('API & Migraciones de base de datos', () => {
  let dbHandle: TestDatabaseHandle | null = null;

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase();
  }, 120_000);

  afterAll(async () => {
    if (dbHandle !== null) {
      await dbHandle.cleanup();
    }
  });

  it('responde /health correctamente', async () => {
    const server = buildServer({ logger: false });
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      rolesDisponibles: ['dueno', 'encargado', 'cajero'],
    });
    await server.close();
  });

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
      '004_clientes_cuenta_corriente.sql',
      '005_compras_proveedores.sql',
      '006_tesoreria_flujo.sql',
      '007_facturacion_fiscal.sql',
      '008_contabilidad.sql',
      '009_presupuestos.sql',
      '010_auditoria_cierre_ejercicio.sql',
      '011_items_factura_y_venta.sql',
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
      '004_clientes_cuenta_corriente.sql',
      '005_compras_proveedores.sql',
      '006_tesoreria_flujo.sql',
      '007_facturacion_fiscal.sql',
      '008_contabilidad.sql',
      '009_presupuestos.sql',
      '010_auditoria_cierre_ejercicio.sql',
      '011_items_factura_y_venta.sql',
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
      const res = await client.query<{ rol: string; super: boolean; rls: boolean }>(`
        select rolname as rol, rolsuper as super, rolbypassrls as rls
        from pg_roles
        where rolname = 'app_user';
      `);
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.super).toBe(false);
      expect(res.rows[0]?.rls).toBe(false);
    } finally {
      await client.end();
    }
  });
});
