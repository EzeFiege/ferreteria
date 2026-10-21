import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthToken } from '../auth.js';
import { runMigrations } from '../db/migrate.js';
import {
  createIsolatedTestDatabase,
  type TestDatabaseHandle,
} from '../db/test-db.js';
import { buildServer } from '../server.js';
import type {
  EjercicioContableItem,
  RegistroAuditoriaItem,
} from '@ferreteria/shared';

const { Pool } = pg;

interface SeedBusiness {
  negocioId: string;
  cajaId: string;
  cajeroId: string;
  encargadoId: string;
  duenoId: string;
  tokenCajero: string;
  tokenEncargado: string;
  tokenDueno: string;
}

describe('Fase 11 — Auditoría Centralizada Inmutable y Cierre de Ejercicio Contable', () => {
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
    await adminPool.query('select sembrar_negocio($1)', [negocioId]);
    await adminPool.query(
      'insert into sucursal (id, negocio_id, nombre) values ($1, $2, $3)',
      [sucursalId, negocioId, 'Casa Central'],
    );
    await adminPool.query(
      'insert into caja (id, negocio_id, sucursal_id, nombre) values ($1, $2, $3, $4)',
      [cajaId, negocioId, sucursalId, 'Caja Principal'],
    );
    await adminPool.query(
      "insert into usuario (id, negocio_id, proveedor_uid, nombre, rol) values ($1, $2, $3, 'Cajero Test', 'cajero')",
      [cajeroId, negocioId, `uid-${cajeroId}`],
    );
    await adminPool.query(
      "insert into usuario (id, negocio_id, proveedor_uid, nombre, rol) values ($1, $2, $3, 'Encargado Test', 'encargado')",
      [encargadoId, negocioId, `uid-${encargadoId}`],
    );
    await adminPool.query(
      "insert into usuario (id, negocio_id, proveedor_uid, nombre, rol) values ($1, $2, $3, 'Dueno Test', 'dueno')",
      [duenoId, negocioId, `uid-${duenoId}`],
    );

    return {
      negocioId,
      cajaId,
      cajeroId,
      encargadoId,
      duenoId,
      tokenCajero: createAuthToken({
        negocio_id: negocioId,
        usuario_id: cajeroId,
        rol: 'cajero',
        email: 'cajero@test.com',
      }),
      tokenEncargado: createAuthToken({
        negocio_id: negocioId,
        usuario_id: encargadoId,
        rol: 'encargado',
        email: 'encargado@test.com',
      }),
      tokenDueno: createAuthToken({
        negocio_id: negocioId,
        usuario_id: duenoId,
        rol: 'dueno',
        email: 'dueno@test.com',
      }),
    };
  }

  beforeAll(async () => {
    testDb = await createIsolatedTestDatabase();
    await runMigrations({
      connectionString: testDb.url,
      appUserPassword: 'app_test_password',
    });

    adminPool = new Pool({
      connectionString: testDb.url,
    });

    negocioA = await sembrarNegocioPrueba('Ferretería El Tornillo');
    negocioB = await sembrarNegocioPrueba('Corralón San Martín');

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

  it('1. Inmutabilidad de registro_auditoria: prohíbe UPDATE y DELETE mediante trigger', async () => {
    const auditId = randomUUID();
    await adminPool.query(
      `insert into registro_auditoria (id, negocio_id, usuario_id, rol, accion, entidad, detalles)
       values ($1, $2, $3, 'dueno', 'apertura_ejercicio', 'ejercicio_contable', '{"test": true}')`,
      [auditId, negocioA.negocioId, negocioA.duenoId],
    );

    // Intento de UPDATE
    await expect(
      adminPool.query(
        `update registro_auditoria set rol = 'cajero' where id = $1`,
        [auditId],
      ),
    ).rejects.toThrow(/los registros de auditoría son inmutables/i);

    // Intento de DELETE
    await expect(
      adminPool.query(
        `delete from registro_auditoria where id = $1`,
        [auditId],
      ),
    ).rejects.toThrow(/los registros de auditoría no pueden eliminarse/i);
  });

  it('2. Permisos en GET /auditoria: cajero es rechazado (403), encargado y dueño pueden acceder', async () => {
    const resCajero = await app.inject({
      method: 'GET',
      url: '/auditoria',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    expect(resCajero.statusCode).toBe(403);

    const resEncargado = await app.inject({
      method: 'GET',
      url: '/auditoria',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    expect(resEncargado.statusCode).toBe(200);
    const logs = JSON.parse(resEncargado.body) as RegistroAuditoriaItem[];
    expect(Array.isArray(logs)).toBe(true);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('3. Registro de auditoría ante arqueo de caja con diferencias', async () => {
    // Abrir turno
    const resAbrir = await app.inject({
      method: 'POST',
      url: '/turnos/abrir',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        cajaId: negocioA.cajaId,
        efectivoInicial: '15000.00',
      },
    });
    expect(resAbrir.statusCode).toBe(201);
    const turnoRes = JSON.parse(resAbrir.body) as { turno: { id: string } };
    const turno = turnoRes.turno;

    // Cerrar turno con arqueo (efectivo contado menor al esperado)
    const resCerrar = await app.inject({
      method: 'POST',
      url: `/turnos/${turno.id}/cerrar`,
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        efectivoContado: '14500.00',
        notas: 'Faltante de $500 por cambio',
      },
    });
    expect(resCerrar.statusCode).toBe(200);

    // Consultar auditoría filtrando por acción arqueo_caja
    const resAudit = await app.inject({
      method: 'GET',
      url: '/auditoria?accion=arqueo_caja',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    expect(resAudit.statusCode).toBe(200);
    const logs = JSON.parse(resAudit.body) as RegistroAuditoriaItem[];
    const logArqueo = logs.find((l) => l.entidadId === turno.id);
    expect(logArqueo).toBeDefined();
    expect(logArqueo?.accion).toBe('arqueo_caja');
    expect(logArqueo?.detalles['efectivoContado']).toBe('14500.00');
    expect(logArqueo?.detalles['diferencia']).toBe('-500.00');
  });

  it('4. Apertura, consulta y cierre de Ejercicio Contable con refundición de resultados', async () => {
    // Crear ejercicio contable para 2025
    const resCrear = await app.inject({
      method: 'POST',
      url: '/contabilidad/ejercicios',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        nombre: 'Ejercicio Económico Anual 2025',
        fechaInicio: '2025-01-01',
        fechaFin: '2025-12-31',
      },
    });
    expect(resCrear.statusCode).toBe(201);
    const ejercicio = JSON.parse(resCrear.body) as EjercicioContableItem;
    expect(ejercicio.estado).toBe('abierto');
    expect(ejercicio.numero).toBe(1);

    // Listar ejercicios
    const resListar = await app.inject({
      method: 'GET',
      url: '/contabilidad/ejercicios',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    expect(resListar.statusCode).toBe(200);
    const lista = JSON.parse(resListar.body) as EjercicioContableItem[];
    expect(lista.length).toBe(1);
    expect(lista[0]?.id).toBe(ejercicio.id);

    // Obtener cuentas para registrar asientos de resultado dentro de 2025
    const resCuentas = await app.inject({
      method: 'GET',
      url: '/contabilidad/cuentas',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    const cuentas = JSON.parse(resCuentas.body) as Array<{ id: string; codigo: string }>;
    const cuentaCaja = cuentas.find((c) => c.codigo === '1.1.01');
    const cuentaVentas = cuentas.find((c) => c.codigo === '4.1.01');
    const cuentaGastos = cuentas.find((c) => c.codigo === '5.1.02');
    expect(cuentaCaja).toBeDefined();
    expect(cuentaVentas).toBeDefined();
    expect(cuentaGastos).toBeDefined();
    if (!cuentaCaja || !cuentaVentas || !cuentaGastos) {
      throw new Error('Cuentas contables no encontradas');
    }

    // Asiento 1 dentro de 2025: Venta por $100.000 (Ingreso)
    const resVenta = await app.inject({
      method: 'POST',
      url: '/contabilidad/asientos',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        fecha: '2025-06-15T12:00:00Z',
        concepto: 'Ventas de mostrador junio 2025',
        renglones: [
          { cuentaId: cuentaCaja.id, debe: '100000.00', haber: '0.00' },
          { cuentaId: cuentaVentas.id, debe: '0.00', haber: '100000.00' },
        ],
      },
    });
    expect(resVenta.statusCode).toBe(201);

    // Asiento 2 dentro de 2025: Gastos operativos por $30.000 (Egreso)
    const resGasto = await app.inject({
      method: 'POST',
      url: '/contabilidad/asientos',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        fecha: '2025-08-20T15:00:00Z',
        concepto: 'Pago de fletes y servicios agosto 2025',
        renglones: [
          { cuentaId: cuentaGastos.id, debe: '30000.00', haber: '0.00' },
          { cuentaId: cuentaCaja.id, debe: '0.00', haber: '30000.00' },
        ],
      },
    });
    expect(resGasto.statusCode).toBe(201);

    // Cerrar el Ejercicio 2025 (debe generar refundición: Ganancia $70.000 y cierre patrimonial)
    const resCierre = await app.inject({
      method: 'POST',
      url: `/contabilidad/ejercicios/${ejercicio.id}/cerrar`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    expect(resCierre.statusCode).toBe(200);
    interface ResultadoCierreRes {
      estado: string;
      asientoRefundicionId: string | null;
      asientoCierreId: string | null;
      resultadoNeto: string;
    }
    const resultadoCierre = JSON.parse(resCierre.body) as ResultadoCierreRes;
    expect(resultadoCierre.estado).toBe('cerrado');
    expect(resultadoCierre.asientoRefundicionId).toBeDefined();
    expect(resultadoCierre.asientoCierreId).toBeDefined();
    expect(resultadoCierre.resultadoNeto).toBe('70000.00');

    // Verificar que el log de auditoría registró el cierre del ejercicio
    const resAuditCierre = await app.inject({
      method: 'GET',
      url: '/auditoria?accion=cierre_ejercicio',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    const logsCierre = JSON.parse(resAuditCierre.body) as RegistroAuditoriaItem[];
    expect(logsCierre.length).toBeGreaterThan(0);
    expect(logsCierre[0]?.detalles['resultadoNeto']).toBe('70000.00');
  });

  it('5. Regla contable: impide registrar asientos en un período o ejercicio cerrado', async () => {
    const resCuentas = await app.inject({
      method: 'GET',
      url: '/contabilidad/cuentas',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    const cuentas = JSON.parse(resCuentas.body) as Array<{ id: string; codigo: string }>;
    const cuentaCaja = cuentas.find((c) => c.codigo === '1.1.01');
    const cuentaVentas = cuentas.find((c) => c.codigo === '4.1.01');
    expect(cuentaCaja).toBeDefined();
    expect(cuentaVentas).toBeDefined();
    if (!cuentaCaja || !cuentaVentas) {
      throw new Error('Cuentas no encontradas');
    }

    // Intento de registrar un asiento fechado en 2025-05-10 (ejercicio ya cerrado)
    const resIntento = await app.inject({
      method: 'POST',
      url: '/contabilidad/asientos',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        fecha: '2025-05-10T10:00:00Z',
        concepto: 'Intento de venta extemporánea en ejercicio cerrado',
        renglones: [
          { cuentaId: cuentaCaja.id, debe: '5000.00', haber: '0.00' },
          { cuentaId: cuentaVentas.id, debe: '0.00', haber: '5000.00' },
        ],
      },
    });

    // Debe ser rechazado por la base de datos con código 400
    expect(resIntento.statusCode).toBe(400);
    const errorBody = JSON.parse(resIntento.body) as { error: string };
    expect(errorBody.error).toMatch(/No se pueden registrar asientos en un ejercicio contable cerrado/i);
  });

  it('6. Multi-tenant: Negocio B no ve registros de auditoría ni ejercicios de Negocio A', async () => {
    const resAuditB = await app.inject({
      method: 'GET',
      url: '/auditoria',
      headers: { authorization: `Bearer ${negocioB.tokenDueno}` },
    });
    expect(resAuditB.statusCode).toBe(200);
    const logsB = JSON.parse(resAuditB.body) as RegistroAuditoriaItem[];
    // Negocio B no debe tener los logs de Negocio A
    for (const log of logsB) {
      expect(log.negocioId).toBe(negocioB.negocioId);
    }

    const resEjerciciosB = await app.inject({
      method: 'GET',
      url: '/contabilidad/ejercicios',
      headers: { authorization: `Bearer ${negocioB.tokenDueno}` },
    });
    expect(resEjerciciosB.statusCode).toBe(200);
    const ejerciciosB = JSON.parse(resEjerciciosB.body) as EjercicioContableItem[];
    expect(ejerciciosB.length).toBe(0);
  });
});
