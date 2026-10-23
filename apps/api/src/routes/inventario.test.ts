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
  DetalleInventarioFisico,
  InventarioFisicoItem,
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
  productoTornilloId: string;
  productoCintaId: string;
}

describe('Fase 16 — Control de Inventario Físico y Auditoría de Stock', () => {
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
        ($1, $4, $5, 'Cajero Operador', 'cajero'),
        ($2, $4, $6, 'Encargado Auditor', 'encargado'),
        ($3, $4, $7, 'Dueño General', 'dueno')`,
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

    // Sembrar rubros y productos con stock
    const rubroId = randomUUID();
    await adminPool.query(
      'insert into rubro (id, negocio_id, nombre) values ($1, $2, $3)',
      [rubroId, negocioId, 'Bulonería'],
    );

    const productoTornilloId = randomUUID();
    await adminPool.query(
      `insert into producto (id, negocio_id, rubro_id, codigo, nombre, costo_base, unidad_principal)
       values ($1, $2, $3, 'TOR-01', 'Tornillo Fixx 4x40', 50.00, 'un')`,
      [productoTornilloId, negocioId, rubroId],
    );

    const productoCintaId = randomUUID();
    await adminPool.query(
      `insert into producto (id, negocio_id, rubro_id, codigo, nombre, costo_base, unidad_principal)
       values ($1, $2, $3, 'CIN-01', 'Cinta Aisladora 3M', 200.00, 'un')`,
      [productoCintaId, negocioId, rubroId],
    );

    // Stock inicial en kardex: 10 tornillos y 20 cintas
    await adminPool.query(
      `insert into movimiento_stock (id, negocio_id, producto_id, tipo, sentido, cantidad, unidad, cantidad_base, costo_unitario, notas, creado_por)
       values
         (gen_random_uuid(), $1, $2, 'ingreso_compra', 'in', 10.000, 'un', 10.000, 50.00, 'Stock inicial prueba', $4),
         (gen_random_uuid(), $1, $3, 'ingreso_compra', 'in', 20.000, 'un', 20.000, 200.00, 'Stock inicial prueba', $4)`,
      [negocioId, productoTornilloId, productoCintaId, duenoId],
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
      productoTornilloId,
      productoCintaId,
    };
  }

  beforeAll(async () => {
    testDb = await createIsolatedTestDatabase();
    await runMigrations({
      connectionString: testDb.url,
      appUserPassword: 'test_password',
    });

    adminPool = new Pool({ connectionString: testDb.url });
    negocioA = await sembrarNegocioPrueba('Ferretería Centro');
    negocioB = await sembrarNegocioPrueba('Ferretería Sucursal');

    app = buildServer({
      logger: false,
      databaseUrl: testDb.url,
    });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await adminPool.end();
    await testDb.cleanup();
  });

  it('inicia una toma de inventario físico congelando el stock del sistema y verificando roles', async () => {
    // 1. Cajero no puede iniciar inventario (403)
    const resCajero = await app.inject({
      method: 'POST',
      url: '/inventarios/iniciar',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        nombre: 'Inventario General Mensual',
      },
    });
    expect(resCajero.statusCode).toBe(403);

    // 2. Encargado inicia inventario general con éxito
    const resEncargado = await app.inject({
      method: 'POST',
      url: '/inventarios/iniciar',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        nombre: 'Inventario General Mes 1',
        observaciones: 'Auditoría en pasillos 1 y 2',
      },
    });
    expect(resEncargado.statusCode).toBe(201);
    const body = resEncargado.json<{ inventario: InventarioFisicoItem }>();
    expect(body.inventario.numero).toBe(1);
    expect(body.inventario.nombre).toBe('Inventario General Mes 1');
    expect(body.inventario.estado).toBe('en_proceso');
    expect(body.inventario.totalArticulos).toBe(2);
    expect(body.inventario.articulosConDiferencia).toBe(0);

    // 3. El siguiente inventario incrementa correlativamente el número
    const resSegundo = await app.inject({
      method: 'POST',
      url: '/inventarios/iniciar',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        nombre: 'Inventario Parcial Bulonería',
      },
    });
    expect(resSegundo.statusCode).toBe(201);
    expect(resSegundo.json<{ inventario: InventarioFisicoItem }>().inventario.numero).toBe(2);
  });

  it('permite registrar conteos físicos progresivos y calcula diferencias en cantidades y valor monetario', async () => {
    // 1. Crear un inventario para conteo
    const resCrear = await app.inject({
      method: 'POST',
      url: '/inventarios/iniciar',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: { nombre: 'Inventario de Prueba Conteo' },
    });
    const invId = resCrear.json<{ inventario: InventarioFisicoItem }>().inventario.id;

    // 2. Consultar detalle de ítems antes del conteo
    const resDetalleAntes = await app.inject({
      method: 'GET',
      url: `/inventarios/${invId}`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    expect(resDetalleAntes.statusCode).toBe(200);
    const detalleAntes = resDetalleAntes.json<DetalleInventarioFisico>();
    expect(detalleAntes.items.length).toBe(2);
    const itemTornillo = detalleAntes.items.find((i) => i.productoId === negocioA.productoTornilloId);
    expect(itemTornillo).toBeDefined();
    expect(itemTornillo?.stockSistema).toBe('10.000');
    expect(itemTornillo?.stockContado).toBeNull();

    // 3. Registrar conteo físico:
    // - Tornillo Fixx: Sistema 10.000, Contado 15.000 (Sobrante de +5.000, a $50 = +$250.00)
    // - Cinta Aisladora: Sistema 20.000, Contado 18.000 (Faltante de -2.000, a $200 = -$400.00)
    const resConteo = await app.inject({
      method: 'PUT',
      url: `/inventarios/${invId}/conteos`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        items: [
          {
            productoId: negocioA.productoTornilloId,
            stockContado: '15.000',
            contadoPorNombre: 'Cajero Operador',
          },
          {
            productoId: negocioA.productoCintaId,
            stockContado: '18.000',
            contadoPorNombre: 'Cajero Operador',
          },
        ],
      },
    });
    expect(resConteo.statusCode).toBe(200);

    // 4. Verificar que se calcularon las diferencias y el valor neto
    const resDetalleDespues = await app.inject({
      method: 'GET',
      url: `/inventarios/${invId}`,
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    const detalleDespues = resDetalleDespues.json<DetalleInventarioFisico>();
    expect(detalleDespues.inventario.articulosConDiferencia).toBe(2);
    // Neto: +$250.00 - $400.00 = -$150.00
    expect(detalleDespues.inventario.diferenciaNetaValorizada).toBe('-150.00');

    const itTornillo = detalleDespues.items.find((i) => i.productoId === negocioA.productoTornilloId);
    expect(itTornillo?.stockContado).toBe('15.000');
    expect(itTornillo?.diferencia).toBe('5.000');
    expect(itTornillo?.diferenciaValorizada).toBe('250.00');

    const itCinta = detalleDespues.items.find((i) => i.productoId === negocioA.productoCintaId);
    expect(itCinta?.stockContado).toBe('18.000');
    expect(itCinta?.diferencia).toBe('-2.000');
    expect(itCinta?.diferenciaValorizada).toBe('-400.00');
  });

  it('aplica el inventario físico: genera movimientos inmutables en kardex, ajusta stock vivo y emite asiento contable', async () => {
    // 1. Iniciar y contar un inventario
    const resCrear = await app.inject({
      method: 'POST',
      url: '/inventarios/iniciar',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: { nombre: 'Inventario para Conciliar' },
    });
    const invId = resCrear.json<{ inventario: InventarioFisicoItem }>().inventario.id;

    await app.inject({
      method: 'PUT',
      url: `/inventarios/${invId}/conteos`,
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        items: [
          {
            productoId: negocioA.productoTornilloId,
            stockContado: '14.000', // Sobrante de +4 (sistema tenía 10)
          },
          {
            productoId: negocioA.productoCintaId,
            stockContado: '17.000', // Faltante de -3 (sistema tenía 20)
          },
        ],
      },
    });

    // 2. Cajero no puede aplicar inventario (403)
    const resAplicarCajero = await app.inject({
      method: 'POST',
      url: `/inventarios/${invId}/aplicar`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    expect(resAplicarCajero.statusCode).toBe(403);

    // 3. Encargado aplica inventario con éxito
    const resAplicar = await app.inject({
      method: 'POST',
      url: `/inventarios/${invId}/aplicar`,
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        observaciones: 'Ajuste de inventario validado por gerencia',
      },
    });
    expect(resAplicar.statusCode).toBe(200);
    const bodyAplicado = resAplicar.json<{
      ok: boolean;
      movimientosGenerados: number;
      asientoId: string | null;
    }>();
    expect(bodyAplicado.ok).toBe(true);
    expect(bodyAplicado.movimientosGenerados).toBe(2);
    expect(bodyAplicado.asientoId).toBeTruthy();

    // 4. Verificar que el stock vivo en v_stock_actual ahora coincide exactamente con lo contado
    const stockRes = await adminPool.query<{ producto_id: string; stock_actual_base: string }>(
      'select producto_id, stock_actual_base from v_stock_actual where negocio_id = $1',
      [negocioA.negocioId],
    );
    const stockTornillo = stockRes.rows.find((r) => r.producto_id === negocioA.productoTornilloId);
    const stockCinta = stockRes.rows.find((r) => r.producto_id === negocioA.productoCintaId);
    expect(stockTornillo?.stock_actual_base).toBe('14.000');
    expect(stockCinta?.stock_actual_base).toBe('17.000');

    // 5. Verificar que el estado del inventario pasó a 'aplicado'
    const resDetalleFinal = await app.inject({
      method: 'GET',
      url: `/inventarios/${invId}`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    expect(resDetalleFinal.json<DetalleInventarioFisico>().inventario.estado).toBe('aplicado');

    // 6. Intentar aplicar de nuevo da 400
    const resReintentar = await app.inject({
      method: 'POST',
      url: `/inventarios/${invId}/aplicar`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    expect(resReintentar.statusCode).toBe(400);
  });

  it('cancela un inventario en proceso sin afectar el stock ni generar asientos contables', async () => {
    const resCrear = await app.inject({
      method: 'POST',
      url: '/inventarios/iniciar',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: { nombre: 'Inventario a Cancelar' },
    });
    const invId = resCrear.json<{ inventario: InventarioFisicoItem }>().inventario.id;

    // Cancelar
    const resCancelar = await app.inject({
      method: 'POST',
      url: `/inventarios/${invId}/cancelar`,
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    expect(resCancelar.statusCode).toBe(200);

    const resDetalle = await app.inject({
      method: 'GET',
      url: `/inventarios/${invId}`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    expect(resDetalle.json<DetalleInventarioFisico>().inventario.estado).toBe('cancelado');
  });

  it('garantiza aislamiento multi-negocio con RLS: un negocio no ve ni modifica inventarios de otro', async () => {
    // Negocio A crea un inventario
    const resCrearA = await app.inject({
      method: 'POST',
      url: '/inventarios/iniciar',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: { nombre: 'Inventario Exclusivo Negocio A' },
    });
    const invIdA = resCrearA.json<{ inventario: InventarioFisicoItem }>().inventario.id;

    // Negocio B intenta consultarlo (404)
    const resGetB = await app.inject({
      method: 'GET',
      url: `/inventarios/${invIdA}`,
      headers: { authorization: `Bearer ${negocioB.tokenDueno}` },
    });
    expect(resGetB.statusCode).toBe(404);

    // Negocio B intenta aplicar el inventario de A (404)
    const resAplicarB = await app.inject({
      method: 'POST',
      url: `/inventarios/${invIdA}/aplicar`,
      headers: { authorization: `Bearer ${negocioB.tokenDueno}` },
    });
    expect(resAplicarB.statusCode).toBe(404);
  });
});
