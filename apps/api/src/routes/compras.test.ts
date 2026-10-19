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

describe('Fase 4 — Compras, Proveedores, Kardex de Stock y Cuentas a Pagar', () => {
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

  it('1. Crea y lista proveedores con saldo en vivo e información fiscal', async () => {
    const resAlta = await app.inject({
      method: 'POST',
      url: '/proveedores',
      headers: { Authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        codigo: 'PRV-001',
        razonSocial: 'Distribuidora Loma Negra SA',
        nombreFantasia: 'Loma Negra',
        cuit: '30-50000000-9',
        condicionIva: 'responsable_inscripto',
        telefono: '011-4000-0000',
        contactoNombre: 'Martín Vendedor',
        diasPlazoPago: 30,
      },
    });

    expect(resAlta.statusCode).toBe(201);
    const provCreado = resAlta.json<{ id: string; codigo: string; razonSocial: string }>();
    expect(provCreado.codigo).toBe('PRV-001');

    // Listar proveedores
    const resListado = await app.inject({
      method: 'GET',
      url: '/proveedores?q=Loma',
      headers: { Authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    expect(resListado.statusCode).toBe(200);
    const lista = resListado.json<
      Array<{
        id: string;
        codigo: string;
        saldoDeudor: string;
        totalCompras: string;
        totalPagos: string;
      }>
    >();
    expect(lista.length).toBe(1);
    expect(lista[0]?.codigo).toBe('PRV-001');
    expect(lista[0]?.saldoDeudor).toBe('0.00');
    expect(lista[0]?.totalCompras).toBe('0.00');
    expect(lista[0]?.totalPagos).toBe('0.00');
  });

  it('2. Emite una orden de compra y recibe mercadería actualizando kardex de stock y costos', async () => {
    // 1. Crear producto con stock inicial 10 unidades
    const prodId = randomUUID();
    await adminPool.query(
      `insert into producto (id, negocio_id, codigo, nombre, rubro_id, costo_base, unidad_principal)
       values ($1, $2, 'CEM-50', 'Cemento Loma Negra 50kg', $3, '5000.00', 'bolsa')`,
      [prodId, negocioA.negocioId, negocioA.rubroId],
    );
    await adminPool.query(
      `insert into movimiento_stock (negocio_id, producto_id, tipo, sentido, cantidad, unidad, cantidad_base, costo_unitario, notas, creado_por)
       values ($1, $2, 'ajuste_sobrante', 'in', 10, 'bolsa', 10, '5000.00', 'Stock inicial', $3)`,
      [negocioA.negocioId, prodId, negocioA.duenoId],
    );

    // Obtener proveedor
    const resProv = await app.inject({
      method: 'GET',
      url: '/proveedores?q=Loma',
      headers: { Authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    const provId = resProv.json<Array<{ id: string }>>()[0]?.id as string;

    // 2. Crear Orden de Compra por 20 bolsas a $ 5.200,00 c/u (total $ 104.000,00) a cuenta corriente
    const resOC = await app.inject({
      method: 'POST',
      url: '/compras',
      headers: { Authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        numero: 'OC-1001',
        proveedorId: provId,
        condicionPago: 'cuenta_corriente',
        total: '104000.00',
        notas: 'Entrega en depósito central',
        items: [
          {
            productoId: prodId,
            descripcion: 'Cemento Loma Negra 50kg',
            cantidadPedida: '20.000',
            costoUnitario: '5200.00',
            subtotal: '104000.00',
          },
        ],
      },
    });

    expect(resOC.statusCode).toBe(201);
    const ocCreada = resOC.json<{ id: string; numero: string; estado: string }>();
    expect(ocCreada.estado).toBe('borrador');

    // 3. Recibir la orden de compra
    const resRecepcion = await app.inject({
      method: 'POST',
      url: `/compras/${ocCreada.id}/recibir`,
      headers: { Authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        actualizarCostoBase: true,
        itemsRecibidos: [
          {
            productoId: prodId,
            cantidadRecibida: '20.000',
            costoUnitario: '5200.00',
          },
        ],
      },
    });

    expect(resRecepcion.statusCode).toBe(200);
    const ocRecibida = resRecepcion.json<{ estado: string }>();
    expect(ocRecibida.estado).toBe('recibida');

    // 4. Verificar kardex de stock: stock inicial 10 + recepción 20 = 30
    const resStock = await adminPool.query<{ stock_actual_base: string; costo_base: string }>(
      'select stock_actual_base, costo_base from v_stock_actual where producto_id = $1 and negocio_id = $2',
      [prodId, negocioA.negocioId],
    );
    expect(Number(resStock.rows[0]?.stock_actual_base)).toBe(30);
    expect(resStock.rows[0]?.costo_base).toBe('5200.00');

    // 5. Verificar cuenta corriente del proveedor: deuda de $ 104.000,00
    const resSaldoProv = await app.inject({
      method: 'GET',
      url: `/proveedores/${provId}`,
      headers: { Authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    const provActualizado = resSaldoProv.json<{
      saldoDeudor: string;
      totalCompras: string;
      totalPagos: string;
    }>();
    expect(provActualizado.totalCompras).toBe('104000.00');
    expect(provActualizado.totalPagos).toBe('0.00');
    expect(provActualizado.saldoDeudor).toBe('104000.00');
  });

  it('3. Registra pago a proveedor imputado en turno de caja y cancela saldo de cuenta corriente', async () => {
    // 1. Abrir turno de caja con $ 200.000,00 en efectivo
    const resAbrir = await app.inject({
      method: 'POST',
      url: '/turnos/abrir',
      headers: { Authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        cajaId: negocioA.cajaId,
        efectivoInicial: '200000.00',
      },
    });
    expect(resAbrir.statusCode).toBe(201);
    const turnoId = resAbrir.json<{ turno: { id: string } }>().turno.id;

    // Obtener proveedor
    const resProv = await app.inject({
      method: 'GET',
      url: '/proveedores?q=Loma',
      headers: { Authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    const provId = resProv.json<Array<{ id: string }>>()[0]?.id as string;

    // 2. Pagar $ 40.000,00 al proveedor desde el turno de caja
    const pagoId = randomUUID();
    const resPago = await app.inject({
      method: 'POST',
      url: `/proveedores/${provId}/pagos`,
      headers: { Authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        id: pagoId,
        turnoId,
        medioPagoId: negocioA.medioEfectivoId,
        monto: '40000.00',
        descripcion: 'Pago parcial factura Loma Negra',
      },
    });

    expect(resPago.statusCode).toBe(201);

    // 3. Verificar que la caja física refleja el egreso de $ 40.000,00 (esperado: 200.000 - 40.000 = 160.000)
    const resTurno = await app.inject({
      method: 'GET',
      url: `/turnos/${turnoId}/resumen`,
      headers: { Authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    const { resumen } = resTurno.json<{
      resumen: { efectivoEsperado: string; salidasEfectivo: string };
    }>();
    expect(resumen.salidasEfectivo).toBe('40000.00');
    expect(resumen.efectivoEsperado).toBe('160000.00');

    // 4. Verificar que la deuda con el proveedor se redujo a $ 64.000,00 (104.000 - 40.000)
    const resExtracto = await app.inject({
      method: 'GET',
      url: `/proveedores/${provId}/cuenta-corriente`,
      headers: { Authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    const extracto = resExtracto.json<{
      saldoDeudor: string;
      movimientos: Array<{ tipo: string; sentido: string; monto: string }>;
    }>();
    expect(extracto.saldoDeudor).toBe('64000.00');
    expect(extracto.movimientos.length).toBe(2); // 1 compra débito + 1 pago crédito
  });

  it('4. Bloquea modificación o borrado en el libro inmutable de proveedores', async () => {
    const resMov = await adminPool.query<{ id: string }>(
      'select id from movimiento_cta_cte_proveedor where negocio_id = $1 limit 1',
      [negocioA.negocioId],
    );
    const movId = resMov.rows[0]?.id;
    expect(movId).toBeDefined();

    // UPDATE bloqueado por trigger
    await expect(
      adminPool.query(
        'update movimiento_cta_cte_proveedor set monto = 9999 where id = $1',
        [movId],
      ),
    ).rejects.toThrow(/solo agregar/i);

    // DELETE bloqueado por trigger
    await expect(
      adminPool.query('delete from movimiento_cta_cte_proveedor where id = $1', [
        movId,
      ]),
    ).rejects.toThrow(/solo agregar/i);
  });

  it('5. Aislamiento multi-negocio estricto con RLS en compras y proveedores', async () => {
    // Negocio B no debe ver a Loma Negra SA de Negocio A
    const resListadoB = await app.inject({
      method: 'GET',
      url: '/proveedores',
      headers: { Authorization: `Bearer ${negocioB.tokenEncargado}` },
    });
    expect(resListadoB.statusCode).toBe(200);
    const proveedoresB = resListadoB.json<Array<{ razonSocial: string }>>();
    expect(proveedoresB.some((p) => p.razonSocial.includes('Loma Negra'))).toBe(false);
  });
});
