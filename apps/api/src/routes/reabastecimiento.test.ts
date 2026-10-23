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
  GenerarOrdenesReabastecimientoResponse,
  SugerenciaReabastecimientoItem,
} from '@ferreteria/shared';

const { Pool } = pg;

interface NegocioPrueba {
  negocioId: string;
  duenoId: string;
  encargadoId: string;
  cajeroId: string;
  tokenDueno: string;
  tokenEncargado: string;
  tokenCajero: string;
  proveedorTornillosId: string;
  productoTornilloAId: string;
  productoTornilloBId: string;
  productoPinturaId: string;
}

describe('Fase 17B — Sugerencia Inteligente de Reabastecimiento y Órdenes de Compra Automáticas', () => {
  let testDb: TestDatabaseHandle;
  let adminPool: pg.Pool;
  let app: FastifyInstance;
  let negocioA: NegocioPrueba;
  let negocioB: NegocioPrueba;

  async function sembrarNegocioPrueba(nombre: string): Promise<NegocioPrueba> {
    const negocioId = randomUUID();
    const sucursalId = randomUUID();
    const cajaId = randomUUID();
    const duenoId = randomUUID();
    const encargadoId = randomUUID();
    const cajeroId = randomUUID();
    const rubroId = randomUUID();

    const proveedorTornillosId = randomUUID();
    const productoTornilloAId = randomUUID();
    const productoTornilloBId = randomUUID();
    const productoPinturaId = randomUUID();

    // 1. Negocio, sucursal, caja, usuarios
    await adminPool.query(
      `insert into negocio (id, nombre, cuit, condicion_iva) values ($1, $2, '30112233445', 'responsable_inscripto')`,
      [negocioId, nombre],
    );
    await adminPool.query(
      `insert into sucursal (id, negocio_id, nombre) values ($1, $2, 'Sucursal Central')`,
      [sucursalId, negocioId],
    );
    await adminPool.query(
      `insert into caja (id, negocio_id, sucursal_id, nombre) values ($1, $2, $3, 'Caja 1')`,
      [cajaId, negocioId, sucursalId],
    );
    await adminPool.query(
      `insert into usuario (id, negocio_id, proveedor_uid, email, password_hash, nombre, rol)
       values
         ($1, $2, $8, $3, 'hash_dueno', 'Dueño Prueba', 'dueno'),
         ($4, $2, $9, $5, 'hash_encargado', 'Encargado Prueba', 'encargado'),
         ($6, $2, $10, $7, 'hash_cajero', 'Cajero Prueba', 'cajero')`,
      [
        duenoId,
        negocioId,
        `dueno-${negocioId}@test.com`,
        encargadoId,
        `encargado-${negocioId}@test.com`,
        cajeroId,
        `cajero-${negocioId}@test.com`,
        `uid-dueno-${duenoId}`,
        `uid-enc-${encargadoId}`,
        `uid-caj-${cajeroId}`,
      ],
    );
    await adminPool.query(
      `insert into rubro (id, negocio_id, nombre) values ($1, $2, 'Ferretería General')`,
      [rubroId, negocioId],
    );

    // 2. Proveedor habitual
    await adminPool.query(
      `insert into proveedor (id, negocio_id, codigo, razon_social, nombre_fantasia, cuit)
       values ($1, $2, 'PRV-TOR', 'Tornillos y Bulones S.A.', 'Distribuidora Tornillos', '30998877665')`,
      [proveedorTornillosId, negocioId],
    );

    // 3. Productos con distintos estados de stock
    // Producto A: Stock 0, Stock Mínimo 20 -> Quiebre inminente
    await adminPool.query(
      `insert into producto (id, negocio_id, rubro_id, codigo, nombre, costo_base, unidad_principal, stock_minimo, punto_pedido, lead_time_dias)
       values ($1, $2, $3, 'TOR-A', 'Tornillo 4x40 Fixx', 50.00, 'un', 20.000, 25.000, 5)`,
      [productoTornilloAId, negocioId, rubroId],
    );
    // Vincular proveedor habitual
    await adminPool.query(
      `insert into producto_proveedor (id, negocio_id, producto_id, proveedor_id, costo_proveedor, es_principal)
       values (gen_random_uuid(), $1, $2, $3, 48.00, true)`,
      [negocioId, productoTornilloAId, proveedorTornillosId],
    );

    // Ventas en los últimos 30 días para Producto A: 60 unidades (consumo diario = 2 un/día)
    await adminPool.query(
      `insert into movimiento_stock (id, negocio_id, producto_id, tipo, sentido, cantidad, unidad, cantidad_base, costo_unitario, creado_por, creado_en)
       values (gen_random_uuid(), $1, $2, 'egreso_venta', 'out', 60.000, 'un', 60.000, 50.00, $3, now() - interval '5 days')`,
      [negocioId, productoTornilloAId, cajeroId],
    );

    // Producto B: Stock 10, Stock Mínimo 20 -> Crítico
    await adminPool.query(
      `insert into producto (id, negocio_id, rubro_id, codigo, nombre, costo_base, unidad_principal, stock_minimo, punto_pedido, lead_time_dias)
       values ($1, $2, $3, 'TOR-B', 'Tornillo 5x50 Fixx', 80.00, 'un', 20.000, 15.000, 7)`,
      [productoTornilloBId, negocioId, rubroId],
    );
    // Ingreso de 10 unidades de stock
    await adminPool.query(
      `insert into movimiento_stock (id, negocio_id, producto_id, tipo, sentido, cantidad, unidad, cantidad_base, costo_unitario, creado_por)
       values (gen_random_uuid(), $1, $2, 'ingreso_compra', 'in', 10.000, 'un', 10.000, 80.00, $3)`,
      [negocioId, productoTornilloBId, duenoId],
    );
    await adminPool.query(
      `insert into producto_proveedor (id, negocio_id, producto_id, proveedor_id, costo_proveedor, es_principal)
       values (gen_random_uuid(), $1, $2, $3, 75.00, true)`,
      [negocioId, productoTornilloBId, proveedorTornillosId],
    );

    // Producto C: Stock 100, Stock Mínimo 10 -> Normal (No debe salir en sugerencias críticas)
    await adminPool.query(
      `insert into producto (id, negocio_id, rubro_id, codigo, nombre, costo_base, unidad_principal, stock_minimo, punto_pedido)
       values ($1, $2, $3, 'PIN-01', 'Pintura Látex 4L', 4500.00, 'un', 10.000, 15.000)`,
      [productoPinturaId, negocioId, rubroId],
    );
    await adminPool.query(
      `insert into movimiento_stock (id, negocio_id, producto_id, tipo, sentido, cantidad, unidad, cantidad_base, costo_unitario, creado_por)
       values (gen_random_uuid(), $1, $2, 'ingreso_compra', 'in', 100.000, 'un', 100.000, 4500.00, $3)`,
      [negocioId, productoPinturaId, duenoId],
    );

    return {
      negocioId,
      duenoId,
      encargadoId,
      cajeroId,
      tokenDueno: createAuthToken({
        negocio_id: negocioId,
        usuario_id: duenoId,
        rol: 'dueno',
      }),
      tokenEncargado: createAuthToken({
        negocio_id: negocioId,
        usuario_id: encargadoId,
        rol: 'encargado',
      }),
      tokenCajero: createAuthToken({
        negocio_id: negocioId,
        usuario_id: cajeroId,
        rol: 'cajero',
      }),
      proveedorTornillosId,
      productoTornilloAId,
      productoTornilloBId,
      productoPinturaId,
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

  it('calcula sugerencias de reabastecimiento con rotación de venta, días de autonomía y proveedor asignado', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reabastecimiento/sugerencias',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    expect(res.statusCode).toBe(200);

    const data = res.json<{
      items: SugerenciaReabastecimientoItem[];
      resumen: {
        totalSugeridos: number;
        totalQuiebres: number;
        totalCriticos: number;
        resumenProveedores: Array<{ proveedorId: string; cantidadArticulos: number }>;
      };
    }>();

    expect(data.items.length).toBe(2); // Producto A y B (Pintura no debe salir por tener 100 de stock)
    expect(data.resumen.totalQuiebres).toBe(1);
    expect(data.resumen.totalCriticos).toBe(1);

    // Validar datos específicos de Producto A (Tornillo A con Quiebre)
    const itemA = data.items.find((it) => it.productoId === negocioA.productoTornilloAId);
    expect(itemA).toBeDefined();
    expect(itemA?.nivelUrgencia).toBe('quiebre');
    expect(itemA?.diasAutonomia).toBe(0);
    expect(Number(itemA?.unidadesVendidas30d)).toBe(60);
    expect(Number(itemA?.consumoDiarioPromedio)).toBe(2);
    expect(itemA?.proveedorNombre).toBe('Distribuidora Tornillos');
    expect(itemA?.costoCompraEstimado).toBe('48.00'); // Precio pactado del proveedor
    expect(parseFloat(itemA?.cantidadSugerida ?? '0')).toBeGreaterThan(0);

    // Validar datos específicos de Producto B (Tornillo B con Stock Crítico)
    const itemB = data.items.find((it) => it.productoId === negocioA.productoTornilloBId);
    expect(itemB).toBeDefined();
    expect(itemB?.nivelUrgencia).toBe('critico');
    expect(itemB?.stockActual).toBe('10.000');
    expect(itemB?.stockMinimo).toBe('20.000');
  });

  it('genera órdenes de compra automáticas en borrador agrupadas por proveedor con correlatividad de numeración', async () => {
    const resGenerar = await app.inject({
      method: 'POST',
      url: '/reabastecimiento/generar-ordenes',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        ordenes: [
          {
            proveedorId: negocioA.proveedorTornillosId,
            condicionPago: 'cuenta_corriente',
            items: [
              {
                productoId: negocioA.productoTornilloAId,
                cantidad: '40.000',
                costoUnitario: '48.00',
              },
              {
                productoId: negocioA.productoTornilloBId,
                cantidad: '20.000',
                costoUnitario: '75.00',
              },
            ],
            notas: 'Reposición automática quiebres de stock',
          },
        ],
      },
    });

    expect(resGenerar.statusCode).toBe(201);
    const body = resGenerar.json<GenerarOrdenesReabastecimientoResponse>();
    expect(body.ok).toBe(true);
    expect(body.ordenesCreadas.length).toBe(1);

    const oc = body.ordenesCreadas[0];
    expect(oc?.numero).toBe('OC-0001');
    expect(oc?.cantidadItems).toBe(2);
    // Total esperado: 40 * 48.00 ($1920) + 20 * 75.00 ($1500) = $3420.00
    expect(oc?.total).toBe('3420.00');

    // Verificar en base de datos que se haya insertado en orden_compra e item_orden_compra
    const ocDb = await adminPool.query<{ estado: string; total: string; notas: string }>(
      'select estado, total, notas from orden_compra where id = $1 and negocio_id = $2',
      [oc?.id, negocioA.negocioId],
    );
    expect(ocDb.rows[0]?.estado).toBe('borrador');
    expect(ocDb.rows[0]?.total).toBe('3420.00');

    const itemsDb = await adminPool.query<{ cantidad_pedida: string; subtotal: string }>(
      'select cantidad_pedida, subtotal from item_orden_compra where orden_compra_id = $1 and negocio_id = $2 order by subtotal desc',
      [oc?.id, negocioA.negocioId],
    );
    expect(itemsDb.rows.length).toBe(2);
    expect(itemsDb.rows[0]?.cantidad_pedida).toBe('40.000');
    expect(itemsDb.rows[0]?.subtotal).toBe('1920.00');
    expect(itemsDb.rows[1]?.cantidad_pedida).toBe('20.000');
    expect(itemsDb.rows[1]?.subtotal).toBe('1500.00');
  });

  it('garantiza aislamiento multi-negocio con RLS: Negocio B no ve sugerencias ni artículos de Negocio A', async () => {
    const resB = await app.inject({
      method: 'GET',
      url: '/reabastecimiento/sugerencias',
      headers: { authorization: `Bearer ${negocioB.tokenEncargado}` },
    });
    expect(resB.statusCode).toBe(200);
    const dataB = resB.json<{ items: SugerenciaReabastecimientoItem[] }>();

    // No debe contener ninguno de los productos de Negocio A
    expect(dataB.items.find((it) => it.productoId === negocioA.productoTornilloAId)).toBeUndefined();
    expect(dataB.items.find((it) => it.productoId === negocioA.productoTornilloBId)).toBeUndefined();
  });
});
