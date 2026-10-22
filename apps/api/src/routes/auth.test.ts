import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import {
  createIsolatedTestDatabase,
  type TestDatabaseHandle,
} from '../db/test-db.js';
import { buildServer } from '../server.js';
import type { LoginResponse } from '@ferreteria/shared';
import { hashPassword } from '../services/password.js';

const { Pool } = pg;

describe('Fase 13 — Autenticación Directa, Sesión y Roles', () => {
  let testDb: TestDatabaseHandle;
  let adminPool: pg.Pool;
  let app: FastifyInstance;

  const negocioAId = randomUUID();
  const negocioBId = randomUUID();
  const usuarioCajeroId = randomUUID();
  const usuarioEncargadoId = randomUUID();

  beforeAll(async () => {
    testDb = await createIsolatedTestDatabase();
    await runMigrations({
      connectionString: testDb.url,
      appUserPassword: 'app_test_password',
    });

    adminPool = new Pool({ connectionString: testDb.url });

    // Sembrar Negocio A
    await adminPool.query('insert into negocio (id, nombre) values ($1, $2)', [
      negocioAId,
      'Ferretería Central',
    ]);
    await adminPool.query('select sembrar_negocio($1)', [negocioAId]);

    // Sembrar Negocio B
    await adminPool.query('insert into negocio (id, nombre) values ($1, $2)', [
      negocioBId,
      'Corralón Norte',
    ]);
    await adminPool.query('select sembrar_negocio($1)', [negocioBId]);

    // Crear usuarios en Negocio A
    const passCajero = hashPassword('clave123');
    await adminPool.query(
      `insert into usuario (id, negocio_id, proveedor_uid, nombre, email, password_hash, rol, activo)
       values ($1, $2, $3, $4, $5, $6, 'cajero', true)`,
      [
        usuarioCajeroId,
        negocioAId,
        'uid-cajero-test',
        'Cajero Prueba',
        'cajero.test@ferreteria.local',
        passCajero,
      ],
    );

    const passEncargado = hashPassword('encargadoPass');
    await adminPool.query(
      `insert into usuario (id, negocio_id, proveedor_uid, nombre, email, password_hash, rol, activo)
       values ($1, $2, $3, $4, $5, $6, 'encargado', true)`,
      [
        usuarioEncargadoId,
        negocioAId,
        'uid-enc-test',
        'Marta Encargada',
        'marta@ferreteria.local',
        passEncargado,
      ],
    );

    app = buildServer({
      logger: false,
      pool: adminPool,
    });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await adminPool.end();
    await testDb.cleanup();
  });

  it('1. Inicia sesión correctamente con email y contraseña válida', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        usuario: 'cajero.test@ferreteria.local',
        password: 'clave123',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<LoginResponse>();
    expect(body.token).toBeDefined();
    expect(body.usuario.id).toBe(usuarioCajeroId);
    expect(body.usuario.rol).toBe('cajero');
    expect(body.usuario.negocioId).toBe(negocioAId);
    expect(body.usuario.negocioNombre).toBe('Ferretería Central');
  });

  it('2. Inicia sesión correctamente utilizando el nombre de usuario', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        usuario: 'Marta Encargada',
        password: 'encargadoPass',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<LoginResponse>();
    expect(body.usuario.rol).toBe('encargado');
    expect(body.usuario.nombre).toBe('Marta Encargada');
  });

  it('3. Rechaza login con contraseña incorrecta (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        usuario: 'cajero.test@ferreteria.local',
        password: 'password_invalida',
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toHaveProperty('error');
  });

  it('4. Rechaza login de usuario inexistente (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        usuario: 'no_existe@ferreteria.local',
        password: 'cualquiera',
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('5. Consulta /auth/me con token válido y recupera el perfil de sesión', async () => {
    const resLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        usuario: 'cajero.test@ferreteria.local',
        password: 'clave123',
      },
    });
    const token = resLogin.json<LoginResponse>().token;

    const resMe = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(resMe.statusCode).toBe(200);
    const body = resMe.json<{ usuario: { id: string; rol: string } }>();
    expect(body.usuario.id).toBe(usuarioCajeroId);
    expect(body.usuario.rol).toBe('cajero');
  });

  it('6. Rechaza login si se intenta forzar pertenencia a otro negocio id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        usuario: 'cajero.test@ferreteria.local',
        password: 'clave123',
        negocioId: negocioBId, // Negocio ajeno
      },
    });

    expect(res.statusCode).toBe(401);
  });
});
