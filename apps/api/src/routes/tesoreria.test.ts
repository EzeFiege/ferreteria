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
  medioEfectivoId: string;
  rubroId: string;
}

describe('Fase 5 — Tesorería, Cartera de Cheques y Cash Flow Proyectado', () => {
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
    const rubroId = randomUUID();

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
      [cajaId, negocioId, sucursalId, 'Caja Mostrador'],
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
        `uid-caj-${negocioId}`,
        `uid-enc-${negocioId}`,
        `uid-due-${negocioId}`,
      ],
    );

    await adminPool.query('select sembrar_negocio($1)', [negocioId]);

    await adminPool.query(
      'insert into rubro (id, negocio_id, nombre) values ($1, $2, $3)',
      [rubroId, negocioId, 'Construcción'],
    );

    const resMp = await adminPool.query<{ id: string }>(
      "select id from medio_pago where negocio_id = $1 and nombre = 'Efectivo'",
      [negocioId],
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
      medioEfectivoId: resMp.rows[0]?.id as string,
      rubroId,
    };
  }

  beforeAll(async () => {
    testDb = await createIsolatedTestDatabase();
    await runMigrations({
      connectionString: testDb.url,
      appUserPassword: 'app_test_password',
    });

    adminPool = new Pool({ connectionString: testDb.url });
    app = buildServer({ pool: adminPool });

    negocioA = await sembrarNegocioPrueba('Ferretería El Tornillo A');
    negocioB = await sembrarNegocioPrueba('Ferretería B');
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await adminPool.end();
    await testDb.cleanup();
  });

  it('1. Registra un cheque físico en cartera y lo lista correctamente', async () => {
    const resAlta = await app.inject({
      method: 'POST',
      url: '/tesoreria/cheques',
      headers: { Authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        tipo: 'fisico',
        numero: '88492019',
        banco: 'Banco Galicia',
        cuitEmisor: '30-66778899-4',
        titular: 'Constructora del Sol SA',
        fechaPago: '2026-10-30',
        monto: '185000.00',
        notas: 'Cobro obra Barrio Norte',
      },
    });

    expect(resAlta.statusCode).toBe(201);
    const ch = resAlta.json<{ id: string; numero: string; estado: string }>();
    expect(ch.numero).toBe('88492019');
    expect(ch.estado).toBe('en_cartera');

    // Listar cheques
    const resListado = await app.inject({
      method: 'GET',
      url: '/tesoreria/cheques?estado=en_cartera',
      headers: { Authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    expect(resListado.statusCode).toBe(200);
    const lista = resListado.json<Array<{ id: string; banco: string; monto: string }>>();
    expect(lista.length).toBe(1);
    expect(lista[0]?.banco).toBe('Banco Galicia');
    expect(lista[0]?.monto).toBe('185000.00');
  });

  it('2. Deposita un cheque en cuenta bancaria y cambia su estado a depositado', async () => {
    // Obtener el cheque en cartera
    const resListado = await app.inject({
      method: 'GET',
      url: '/tesoreria/cheques?estado=en_cartera',
      headers: { Authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    const ch = resListado.json<Array<{ id: string }>>()[0];
    expect(ch).toBeDefined();

    const resDeposito = await app.inject({
      method: 'POST',
      url: `/tesoreria/cheques/${ch?.id}/depositar`,
      headers: { Authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        cuentaBancariaDestino: 'CC en Pesos Banco Nación 0492-38',
        fechaDeposito: '2026-10-20',
        notas: 'Buzón de depósito sucursal 104',
      },
    });

    expect(resDeposito.statusCode).toBe(200);
    const chDepositado = resDeposito.json<{
      estado: string;
      cuentaBancariaDestino: string;
    }>();
    expect(chDepositado.estado).toBe('depositado');
    expect(chDepositado.cuentaBancariaDestino).toBe('CC en Pesos Banco Nación 0492-38');
  });

  it('3. Registra cheque y lo endosa a un proveedor, cancelando saldo en su cuenta corriente', async () => {
    // 1. Crear un proveedor con deuda previa
    const resProv = await adminPool.query<{ id: string }>(
      `insert into proveedor (negocio_id, codigo, razon_social, cuit, condicion_iva, dias_plazo_pago)
       values ($1, 'PRV-100', 'Aceros Industriales SA', '30-71000000-8', 'responsable_inscripto', 30)
       returning id`,
      [negocioA.negocioId],
    );
    const provId = resProv.rows[0]?.id as string;

    // Registrar deuda inicial de $ 250.000,00 en cta cte proveedor
    await adminPool.query(
      `insert into movimiento_cta_cte_proveedor (negocio_id, proveedor_id, tipo, sentido, monto, descripcion, creado_por)
       values ($1, $2, 'debito_compra', 'debito', '250000.00', 'Factura A-0001-002', $3)`,
      [negocioA.negocioId, provId, negocioA.duenoId],
    );

    // 2. Registrar cheque diferido en cartera de $ 150.000,00
    const resCh = await app.inject({
      method: 'POST',
      url: '/tesoreria/cheques',
      headers: { Authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        tipo: 'echeq',
        numero: 'ECH-99001',
        banco: 'Banco Santander',
        cuitEmisor: '30-55443322-1',
        titular: 'Metalúrgica Quilmes SRL',
        fechaPago: '2026-11-15',
        monto: '150000.00',
      },
    });
    expect(resCh.statusCode).toBe(201);
    const chId = resCh.json<{ id: string }>().id;

    // 3. Endosar cheque al proveedor
    const resEndoso = await app.inject({
      method: 'POST',
      url: `/tesoreria/cheques/${chId}/endosar-proveedor`,
      headers: { Authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        proveedorId: provId,
        fechaEntrega: '2026-10-21',
        notas: 'Endoso eCheq pago parcial factura',
      },
    });

    expect(resEndoso.statusCode).toBe(200);
    const chEndosado = resEndoso.json<{ estado: string; proveedorId: string }>();
    expect(chEndosado.estado).toBe('entregado_proveedor');
    expect(chEndosado.proveedorId).toBe(provId);

    // 4. Verificar que la cuenta corriente del proveedor registra el crédito y el saldo queda en $ 100.000,00
    const resCtaCte = await app.inject({
      method: 'GET',
      url: `/proveedores/${provId}/cuenta-corriente`,
      headers: { Authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    const ctaCte = resCtaCte.json<{
      saldoDeudor: string;
      movimientos: Array<{ tipo: string; sentido: string; monto: string; descripcion: string }>;
    }>();

    expect(ctaCte.saldoDeudor).toBe('100000.00');
    expect(ctaCte.movimientos.some((m) => m.descripcion.includes('ECH-99001'))).toBe(true);
  });

  it('4. Calcula flujo de caja proyectado a 30 días consolidando cheques y vencimientos', async () => {
    // Agregar un cheque en cartera a cobrar en fecha futura
    await app.inject({
      method: 'POST',
      url: '/tesoreria/cheques',
      headers: { Authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        tipo: 'fisico',
        numero: '772211',
        banco: 'Banco Macro',
        fechaPago: new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10),
        monto: '80000.00',
      },
    });

    const resFlujo = await app.inject({
      method: 'GET',
      url: '/tesoreria/flujo-proyectado?dias=30',
      headers: { Authorization: `Bearer ${negocioA.tokenEncargado}` },
    });

    expect(resFlujo.statusCode).toBe(200);
    const flujo = resFlujo.json<{
      dias: number;
      totalIngresos: string;
      totalEgresos: string;
      saldoNetoProyectado: string;
      items: Array<{ fecha: string; tipo: string; sentido: string; monto: string }>;
    }>();

    expect(flujo.dias).toBe(30);
    expect(parseFloat(flujo.totalIngresos)).toBeGreaterThanOrEqual(80000);
    expect(flujo.items.some((i) => i.tipo === 'cheque_en_cartera')).toBe(true);
  });

  it('5. Aislamiento multi-negocio con RLS en tesorería', async () => {
    // Negocio B no debe ver ningún cheque de Negocio A
    const resB = await app.inject({
      method: 'GET',
      url: '/tesoreria/cheques',
      headers: { Authorization: `Bearer ${negocioB.tokenEncargado}` },
    });

    expect(resB.statusCode).toBe(200);
    const chequesB = resB.json<Array<{ id: string }>>();
    expect(chequesB.length).toBe(0);
  });
});
