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
  tokenCajero: string;
  tokenEncargado: string;
  tokenDueno: string;
  medioEfectivoId: string;
  medioCtaCteId: string;
  rubroId: string;
}

describe('Fase 3 — CRM, Personas Autorizadas y Cuenta Corriente Inmutable', () => {
  let testDb: TestDatabaseHandle;
  let adminPool: pg.Pool;
  let app: FastifyInstance;
  let negocioA: SeedBusiness;
  let negocioB: SeedBusiness;
  let turnoNegocioAId: string;

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
      [rubroId, negocioId, 'Bulonería y Fijaciones'],
    );

    const resEfectivo = await adminPool.query<{ id: string }>(
      `select id from medio_pago where negocio_id = $1 and nombre = 'Efectivo'`,
      [negocioId],
    );

    const resCtaCte = await adminPool.query<{ id: string }>(
      `select id from medio_pago where negocio_id = $1 and nombre = 'Cuenta Corriente'`,
      [negocioId],
    );

    return {
      negocioId,
      cajaId,
      cajeroId,
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
      medioEfectivoId: (resEfectivo.rows[0] as { id: string }).id,
      medioCtaCteId: (resCtaCte.rows[0] as { id: string }).id,
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
    app = buildServer({
      logger: false,
      pool: adminPool,
    });
    await app.ready();

    negocioA = await sembrarNegocioPrueba('Ferretería Centro');
    negocioB = await sembrarNegocioPrueba('Corralón Norte');
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await adminPool.end();
    await testDb.cleanup();
  });

  it('da de alta un cliente con personas autorizadas a retirar mercadería y consulta su saldo inicial', async () => {
    // 1. Crear cliente
    const resAlta = await app.inject({
      method: 'POST',
      url: '/clientes',
      headers: {
        authorization: `Bearer ${negocioA.tokenCajero}`,
        'content-type': 'application/json',
      },
      payload: {
        codigo: 'CLI-010',
        nombre: 'Constructora del Plata SRL',
        cuitDni: '30-71234567-9',
        condicionIva: 'responsable_inscripto',
        telefono: '11-4455-6677',
        limiteCredito: '200000.00',
        diasPlazoCredito: 30,
      },
    });

    expect(resAlta.statusCode).toBe(201);
    const clienteCreado = resAlta.json<{ id: string; codigo: string }>();
    expect(clienteCreado.codigo).toBe('CLI-010');

    // 2. Agregar persona autorizada a retirar
    const resAut = await app.inject({
      method: 'POST',
      url: `/clientes/${clienteCreado.id}/autorizados`,
      headers: {
        authorization: `Bearer ${negocioA.tokenCajero}`,
        'content-type': 'application/json',
      },
      payload: {
        nombre: 'Carlos Gómez',
        dni: '32.111.222',
        rolParentesco: 'Encargado de obra',
        telefono: '11-9988-7766',
      },
    });

    expect(resAut.statusCode).toBe(201);
    const autCreado = resAut.json<{ id: string; nombre: string }>();
    expect(autCreado.nombre).toBe('Carlos Gómez');

    // 3. Consultar detalle de cliente
    const resGet = await app.inject({
      method: 'GET',
      url: `/clientes/${clienteCreado.id}`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });

    expect(resGet.statusCode).toBe(200);
    const detalle = resGet.json<{
      cliente: {
        nombre: string;
        saldoDeudor: string;
        limiteCredito: string;
        creditoDisponible: string;
        excedidoLimite: boolean;
      };
      autorizados: Array<{ id: string; nombre: string }>;
    }>();

    expect(detalle.cliente.nombre).toBe('Constructora del Plata SRL');
    expect(detalle.cliente.saldoDeudor).toBe('0.00');
    expect(detalle.cliente.limiteCredito).toBe('200000.00');
    expect(detalle.cliente.creditoDisponible).toBe('200000.00');
    expect(detalle.cliente.excedidoLimite).toBe(false);
    expect(detalle.autorizados).toHaveLength(1);
    expect(detalle.autorizados[0]?.nombre).toBe('Carlos Gómez');
  });

  it('permite vender a cuenta corriente, genera débito inmutable y descuenta crédito disponible', async () => {
    // 1. Alta de cliente
    const resCli = await app.inject({
      method: 'POST',
      url: '/clientes',
      headers: {
        authorization: `Bearer ${negocioA.tokenCajero}`,
        'content-type': 'application/json',
      },
      payload: {
        codigo: 'CLI-020',
        nombre: 'Herrería El Yunque',
        cuitDni: '20-28111222-3',
        limiteCredito: '100000.00',
      },
    });
    const cli = resCli.json<{ id: string }>();

    // 2. Abrir turno
    const resTurno = await app.inject({
      method: 'POST',
      url: '/turnos/abrir',
      headers: {
        authorization: `Bearer ${negocioA.tokenCajero}`,
        'content-type': 'application/json',
      },
      payload: {
        cajaId: negocioA.cajaId,
        efectivoInicial: '5000.00',
      },
    });
    const turnoId = resTurno.json<{ turno: { id: string } }>().turno.id;
    turnoNegocioAId = turnoId;

    // 3. Venta a cuenta corriente por $ 35.000,00
    const ventaId = randomUUID();
    const movId = randomUUID();
    const resVenta = await app.inject({
      method: 'POST',
      url: '/ventas',
      headers: {
        authorization: `Bearer ${negocioA.tokenCajero}`,
        'content-type': 'application/json',
      },
      payload: {
        id: ventaId,
        turnoId,
        clienteId: cli.id,
        total: '35000.00',
        pagos: [
          {
            movimientoId: movId,
            medioPagoId: negocioA.medioCtaCteId,
            rubroId: negocioA.rubroId,
            monto: '35000.00',
            descripcion: 'Venta a cuenta corriente',
          },
        ],
      },
    });

    expect(resVenta.statusCode).toBe(201);

    // 4. Verificar resumen de cta cte del cliente
    const resCtaCte = await app.inject({
      method: 'GET',
      url: `/clientes/${cli.id}/cuenta-corriente`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });

    expect(resCtaCte.statusCode).toBe(200);
    const dataCtaCte = resCtaCte.json<{
      cliente: {
        totalDebitos: string;
        totalCreditos: string;
        saldoDeudor: string;
        creditoDisponible: string;
        excedidoLimite: boolean;
      };
      movimientos: Array<{
        tipo: string;
        sentido: string;
        monto: string;
        ventaId: string;
      }>;
    }>();

    expect(dataCtaCte.cliente.totalDebitos).toBe('35000.00');
    expect(dataCtaCte.cliente.totalCreditos).toBe('0.00');
    expect(dataCtaCte.cliente.saldoDeudor).toBe('35000.00');
    expect(dataCtaCte.cliente.creditoDisponible).toBe('65000.00');
    expect(dataCtaCte.cliente.excedidoLimite).toBe(false);
    expect(dataCtaCte.movimientos).toHaveLength(1);
    expect(dataCtaCte.movimientos[0]?.tipo).toBe('debito_venta');
    expect(dataCtaCte.movimientos[0]?.monto).toBe('35000.00');
  });

  it('cobra en caja la deuda del cliente, ingresa dinero al turno y reduce el saldo deudor', async () => {
    // 1. Obtener cliente creado anteriormente con deuda de $ 35.000,00
    const resList = await app.inject({
      method: 'GET',
      url: '/clientes?q=Herrería',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    const [cli] = resList.json<Array<{ id: string; saldoDeudor: string }>>();
    expect(cli?.saldoDeudor).toBe('35000.00');

    // 2. Registrar cobranza de $ 20.000,00 en Efectivo en el turno abierto de negocioA
    const cobroId = randomUUID();
    const clienteId = cli ? cli.id : '';
    const resCobro = await app.inject({
      method: 'POST',
      url: `/clientes/${clienteId}/cobranzas`,
      headers: {
        authorization: `Bearer ${negocioA.tokenCajero}`,
        'content-type': 'application/json',
      },
      payload: {
        id: cobroId,
        turnoId: turnoNegocioAId,
        medioPagoId: negocioA.medioEfectivoId,
        monto: '20000.00',
        descripcion: 'Pago parcial en efectivo en mostrador',
      },
    });

    expect(resCobro.statusCode).toBe(201);
    const dataCobro = resCobro.json<{
      movimientoCaja: { monto: string };
      movimientoCtaCte: { tipo: string; monto: string };
      saldo: { saldo_deudor: string; credito_disponible: string };
    }>();

    expect(dataCobro.movimientoCaja.monto).toBe('20000.00');
    expect(dataCobro.movimientoCtaCte.tipo).toBe('credito_cobranza');
    expect(dataCobro.movimientoCtaCte.monto).toBe('20000.00');
    expect(dataCobro.saldo.saldo_deudor).toBe('15000.00');
    expect(dataCobro.saldo.credito_disponible).toBe('85000.00');

    // 4. Verificar que el resumen de turno aumentó su efectivo
    const resResumen = await app.inject({
      method: 'GET',
      url: `/turnos/${turnoNegocioAId}/resumen`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    expect(resResumen.statusCode).toBe(200);
  });

  it('hace cumplir la Regla 1 de inmutabilidad bloqueando UPDATE o DELETE en movimiento_cta_cte', async () => {
    // Intentar update directo con adminPool
    await expect(
      adminPool.query(
        `update movimiento_cta_cte set monto = 99999.00 where negocio_id = $1`,
        [negocioA.negocioId],
      ),
    ).rejects.toThrow(/movimiento_cta_cte es un libro de solo agregar/);

    // Intentar delete directo con adminPool
    await expect(
      adminPool.query(
        `delete from movimiento_cta_cte where negocio_id = $1`,
        [negocioA.negocioId],
      ),
    ).rejects.toThrow(/movimiento_cta_cte es un libro de solo agregar/);
  });

  it('respeta el aislamiento estricto multi-negocio con RLS', async () => {
    // Negocio B intenta ver los clientes de Negocio A
    const resListB = await app.inject({
      method: 'GET',
      url: '/clientes',
      headers: { authorization: `Bearer ${negocioB.tokenCajero}` },
    });

    expect(resListB.statusCode).toBe(200);
    const clientesB = resListB.json<Array<{ nombre: string }>>();
    // Negocio B no debe ver Constructora del Plata ni Herrería El Yunque
    expect(
      clientesB.some((c) => c.nombre.includes('Constructora del Plata')),
    ).toBe(false);
    expect(clientesB.some((c) => c.nombre.includes('Herrería'))).toBe(false);
  });
});
