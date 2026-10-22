import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthToken } from '../auth.js';
import { runBackupAndVerifyRestore } from '../db/backup-restore.js';
import { runMigrations } from '../db/migrate.js';
import {
  createIsolatedTestDatabase,
  type TestDatabaseHandle,
} from '../db/test-db.js';
import { buildServer } from '../server.js';

const { Pool } = pg;

interface SeedBusiness {
  negocioId: string;
  tokenCajero: string;
  tokenEncargado: string;
  tokenDueno: string;
}

describe('Etapa 4 — Configuración real del negocio, monitoreo y backup/restore', () => {
  let testDb: TestDatabaseHandle;
  let adminPool: pg.Pool;
  let app: FastifyInstance;
  let negocioA: SeedBusiness;
  let negocioB: SeedBusiness;

  async function sembrarNegocioPrueba(nombre: string): Promise<SeedBusiness> {
    const negocioId = randomUUID();
    const sucursalId = randomUUID();
    const cajaId = randomUUID();
    const cajeroId = randomUUID();
    const encargadoId = randomUUID();
    const duenoId = randomUUID();

    await adminPool.query('insert into negocio (id, nombre) values ($1, $2)', [
      negocioId,
      nombre,
    ]);
    await adminPool.query(
      'insert into sucursal (id, negocio_id, nombre) values ($1, $2, $3)',
      [sucursalId, negocioId, 'Sucursal Central'],
    );
    await adminPool.query(
      'insert into caja (id, negocio_id, sucursal_id, nombre) values ($1, $2, $3, $4)',
      [cajaId, negocioId, sucursalId, 'Caja Piloto'],
    );
    await adminPool.query(
      `insert into usuario (id, negocio_id, proveedor_uid, nombre, rol) values
        ($1, $4, $5, 'Cajero', 'cajero'),
        ($2, $4, $6, 'Encargado', 'encargado'),
        ($3, $4, $7, 'Dueño', 'dueno')`,
      [
        cajeroId,
        encargadoId,
        duenoId,
        negocioId,
        `uid-caj-${cajeroId}`,
        `uid-enc-${encargadoId}`,
        `uid-due-${duenoId}`,
      ],
    );
    await adminPool.query('select sembrar_negocio($1)', [negocioId]);

    return {
      negocioId,
      tokenCajero: createAuthToken({
        negocio_id: negocioId,
        usuario_id: cajeroId,
        rol: 'cajero',
      }),
      tokenEncargado: createAuthToken({
        negocio_id: negocioId,
        usuario_id: encargadoId,
        rol: 'encargado',
      }),
      tokenDueno: createAuthToken({
        negocio_id: negocioId,
        usuario_id: duenoId,
        rol: 'dueno',
      }),
    };
  }

  beforeAll(async () => {
    testDb = await createIsolatedTestDatabase();
    await runMigrations({ connectionString: testDb.url });
    adminPool = new Pool({ connectionString: testDb.url });
    app = buildServer({ pool: adminPool, logger: false });
    await app.ready();

    negocioA = await sembrarNegocioPrueba('Ferretería Piloto A');
    negocioB = await sembrarNegocioPrueba('Ferretería Piloto B');
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await adminPool.end();
    await testDb.cleanup();
  });

  it('verifica readiness de la base y rol RLS en GET /health/ready', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      status: string;
      db: string;
      dbRole: string;
    }>();
    expect(body.status).toBe('ready');
    expect(body.db).toBe('ok');
    expect(body.dbRole).toBe('app_user');
  });

  it('impide a cajero y encargado modificar medios de pago, rubros o categorías (403) y permite al dueño (200)', async () => {
    const intentoCajero = await app.inject({
      method: 'POST',
      url: '/configuracion/medios-pago',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        nombre: 'Tarjeta Naranja',
        esEfectivo: false,
        diasAcreditacion: 14,
        comisionPct: '4.50',
        activo: true,
      },
    });
    expect(intentoCajero.statusCode).toBe(403);

    const intentoEncargado = await app.inject({
      method: 'POST',
      url: '/configuracion/rubros',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        nombre: 'Sanitarios',
      },
    });
    expect(intentoEncargado.statusCode).toBe(403);

    // El dueño crea un medio de pago real con días de acreditación y comisión
    const crearMedioRes = await app.inject({
      method: 'POST',
      url: '/configuracion/medios-pago',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        nombre: 'Tarjeta Naranja Plan Z',
        esEfectivo: false,
        diasAcreditacion: 14,
        comisionPct: '4.50',
        activo: true,
      },
    });
    expect(crearMedioRes.statusCode).toBe(200);
    const { medioPago: medioCreado } = crearMedioRes.json<{
      medioPago: {
        id: string;
        nombre: string;
        esEfectivo: boolean;
        diasAcreditacion: number;
        comisionPct: string;
        activo: boolean;
      };
    }>();
    expect(medioCreado.nombre).toBe('Tarjeta Naranja Plan Z');
    expect(medioCreado.diasAcreditacion).toBe(14);
    expect(medioCreado.comisionPct).toBe('4.50');

    // El dueño actualiza días de acreditación y comisión de un medio existente
    const editarMedioRes = await app.inject({
      method: 'POST',
      url: '/configuracion/medios-pago',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        id: medioCreado.id,
        nombre: 'Tarjeta Naranja Plan Z',
        esEfectivo: false,
        diasAcreditacion: 10,
        comisionPct: '3.85',
        activo: true,
      },
    });
    expect(editarMedioRes.statusCode).toBe(200);
    expect(
      editarMedioRes.json<{
        medioPago: { diasAcreditacion: number; comisionPct: string };
      }>().medioPago,
    ).toMatchObject({
      diasAcreditacion: 10,
      comisionPct: '3.85',
    });

    // El dueño crea rubro y categoría reales de la ferretería
    const crearRubroRes = await app.inject({
      method: 'POST',
      url: '/configuracion/rubros',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        nombre: 'Sanitarios y Gas',
      },
    });
    expect(crearRubroRes.statusCode).toBe(200);

    const crearCatRes = await app.inject({
      method: 'POST',
      url: '/configuracion/categorias',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        nombre: 'Viáticos y Cadetería',
        tipo: 'egreso',
      },
    });
    expect(crearCatRes.statusCode).toBe(200);
  });

  it('mantiene aislamiento multi-negocio en los catálogos configurados', async () => {
    const catARes = await app.inject({
      method: 'GET',
      url: '/configuracion/catalogos',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    expect(catARes.statusCode).toBe(200);
    const catalogosA = catARes.json<{
      mediosPago: { id: string; nombre: string }[];
      rubros: { id: string; nombre: string }[];
    }>();
    expect(
      catalogosA.mediosPago.some((m) => m.nombre === 'Tarjeta Naranja Plan Z'),
    ).toBe(true);
    expect(
      catalogosA.rubros.some((r) => r.nombre === 'Sanitarios y Gas'),
    ).toBe(true);

    // Negocio B no ve los catálogos agregados en Negocio A ni puede editarlos
    const catBRes = await app.inject({
      method: 'GET',
      url: '/configuracion/catalogos',
      headers: { authorization: `Bearer ${negocioB.tokenDueno}` },
    });
    expect(catBRes.statusCode).toBe(200);
    const catalogosB = catBRes.json<{
      mediosPago: { id: string; nombre: string }[];
      rubros: { id: string; nombre: string }[];
    }>();
    expect(
      catalogosB.mediosPago.some((m) => m.nombre === 'Tarjeta Naranja Plan Z'),
    ).toBe(false);

    const medioIdDeA = catalogosA.mediosPago.find(
      (m) => m.nombre === 'Tarjeta Naranja Plan Z',
    )?.id;
    const intentoEditarCruzado = await app.inject({
      method: 'POST',
      url: '/configuracion/medios-pago',
      headers: { authorization: `Bearer ${negocioB.tokenDueno}` },
      payload: {
        id: medioIdDeA,
        nombre: 'Intento Cruzado',
        esEfectivo: false,
        diasAcreditacion: 0,
        comisionPct: '0.00',
        activo: true,
      },
    });
    expect(intentoEditarCruzado.statusCode).toBe(404);
  });

  it('ejecuta backup lógico y verifica restauración íntegra en base temporal con RLS activo', async () => {
    const tempBackupDir = path.join(
      os.tmpdir(),
      `ferreteria-backups-${randomUUID()}`,
    );
    try {
      const resultado = await runBackupAndVerifyRestore({
        connectionString: testDb.url,
        backupDir: tempBackupDir,
      });

      expect(resultado.tablasVerificadas).toBe(11);
      expect(resultado.rlsActivo).toBe(true);
      expect(resultado.vistasOperativas).toBe(true);
      expect(resultado.filasRestauradas['negocio']).toBeGreaterThanOrEqual(2);
      expect(resultado.filasRestauradas['medio_pago']).toBeGreaterThanOrEqual(
        7,
      );
    } finally {
      await rm(tempBackupDir, { recursive: true, force: true });
    }
  });
});
