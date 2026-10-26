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
  AcopioDetalleCompleto,
  AcopioResumenItem,
} from '@ferreteria/shared';

const { Pool } = pg;

interface NegocioPrueba {
  negocioId: string;
  duenoId: string;
  cajeroId: string;
  tokenDueno: string;
  tokenCajero: string;
  clienteId: string;
  productoCementoId: string;
  productoArenaId: string;
}

describe('Fase 18 — Acopio de Materiales y Entregas Parciales', () => {
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
    const cajeroId = randomUUID();
    const rubroId = randomUUID();
    const clienteId = randomUUID();
    const productoCementoId = randomUUID();
    const productoArenaId = randomUUID();

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
       values ($1, $2, $6, $3, 'hash_test', 'Dueño', 'dueno'),
              ($4, $2, $7, $5, 'hash_test', 'Cajero', 'cajero')`,
      [
        duenoId,
        negocioId,
        `dueno_${negocioId.slice(0, 8)}@ferre.com`,
        cajeroId,
        `cajero_${negocioId.slice(0, 8)}@ferre.com`,
        `uid_dueno_${negocioId.slice(0, 8)}`,
        `uid_cajero_${negocioId.slice(0, 8)}`,
      ],
    );

    // 2. Rubro y Cliente
    await adminPool.query(
      `insert into rubro (id, negocio_id, nombre) values ($1, $2, 'Materiales Gruesos')`,
      [rubroId, negocioId],
    );
    await adminPool.query(
      `insert into cliente (id, negocio_id, codigo, nombre, cuit_dni, condicion_iva, limite_credito)
       values ($1, $2, 'CLI-001', 'Constructora Los Andes S.A.', '30-71112223-8', 'responsable_inscripto', '500000.00')`,
      [clienteId, negocioId],
    );

    // 3. Productos
    await adminPool.query(
      `insert into producto (id, negocio_id, codigo, nombre, rubro_id, costo_base, unidad_principal, activo)
       values ($1, $2, 'CEM-50', 'Cemento Loma Negra 50kg', $3, '8500.00', 'bolsa', true),
              ($4, $2, 'ARE-M3', 'Arena Gruesa a Granel', $3, '12000.00', 'm3', true)`,
      [productoCementoId, negocioId, rubroId, productoArenaId],
    );

    // 4. Stock inicial en Kardex (50 bolsas de cemento y 20 m3 de arena)
    await adminPool.query(
      `insert into movimiento_stock (id, negocio_id, producto_id, tipo, sentido, cantidad, unidad, cantidad_base, costo_unitario, creado_por)
       values ($1, $2, $3, 'ingreso_compra', 'in', 50.000, 'principal', 50.000, '8500.00', $7),
              ($4, $5, $6, 'ingreso_compra', 'in', 20.000, 'principal', 20.000, '12000.00', $7)`,
      [
        randomUUID(),
        negocioId,
        productoCementoId,
        randomUUID(),
        negocioId,
        productoArenaId,
        duenoId,
      ],
    );

    const tokenDueno = createAuthToken({
      negocio_id: negocioId,
      usuario_id: duenoId,
      rol: 'dueno',
    });
    const tokenCajero = createAuthToken({
      negocio_id: negocioId,
      usuario_id: cajeroId,
      rol: 'cajero',
    });

    return {
      negocioId,
      duenoId,
      cajeroId,
      tokenDueno,
      tokenCajero,
      clienteId,
      productoCementoId,
      productoArenaId,
    };
  }

  beforeAll(async () => {
    testDb = await createIsolatedTestDatabase();
    await runMigrations({
      connectionString: testDb.url,
      appUserPassword: 'test_password',
    });

    adminPool = new Pool({ connectionString: testDb.url });
    negocioA = await sembrarNegocioPrueba('Ferretería Acopios A');
    negocioB = await sembrarNegocioPrueba('Ferretería Acopios B');

    app = buildServer({
      databaseUrl: testDb.url,
      logger: false,
    });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await adminPool.end();
    await testDb.cleanup();
  });

  it('1. Crea un acopio con múltiples artículos, calcula subtotales y asigna número correlativo', async () => {
    const payload = {
      clienteId: negocioA.clienteId,
      notas: 'Acopio para obra Edificio Libertad',
      items: [
        {
          productoId: negocioA.productoCementoId,
          cantidad: '30.000',
          precioUnitario: '10000.00',
        },
        {
          productoId: negocioA.productoArenaId,
          cantidad: '5.000',
          precioUnitario: '15000.00',
        },
      ],
    };

    const res = await app.inject({
      method: 'POST',
      url: '/acopios',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ ok: boolean; id: string; numero: string }>();
    expect(body.ok).toBe(true);
    expect(body.numero).toBe('ACP-0001');

    // Listar acopios y verificar resumen calculado
    const resList = await app.inject({
      method: 'GET',
      url: `/acopios?clienteId=${negocioA.clienteId}`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    expect(resList.statusCode).toBe(200);
    const bodyList = resList.json<{ acopios: AcopioResumenItem[] }>();
    expect(bodyList.acopios).toHaveLength(1);

    const acop = bodyList.acopios[0];
    if (!acop) throw new Error('No acopio');
    expect(acop.numero).toBe('ACP-0001');
    expect(acop.estado).toBe('activo');
    expect(acop.totalArticulos).toBe(2);
    expect(parseFloat(acop.totalUnidadesCompradas)).toBe(35);
    expect(parseFloat(acop.totalUnidadesEntregadas)).toBe(0);
    expect(parseFloat(acop.saldoUnidadesPendientes)).toBe(35);
    expect(parseFloat(acop.totalValorizado)).toBe(375000); // (30 * 10000) + (5 * 15000)
    expect(acop.pctEntregado).toBe(0);
  });

  it('2. Registra entrega parcial con remito: actualiza cantidades y descuenta del Kardex de stock', async () => {
    // Consultar el acopio para obtener los IDs de los ítems
    const resList = await app.inject({
      method: 'GET',
      url: `/acopios?clienteId=${negocioA.clienteId}`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    const acopioId = resList.json<{ acopios: AcopioResumenItem[] }>().acopios[0]?.id ?? '';

    const resDetalle = await app.inject({
      method: 'GET',
      url: `/acopios/${acopioId}`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    const detalle = resDetalle.json<AcopioDetalleCompleto>();
    const itemCemento = detalle.items.find((i) => i.productoId === negocioA.productoCementoId);
    if (!itemCemento) throw new Error('No cemento');

    // Entregar 10 bolsas de cemento de las 30 compradas
    const resEntrega = await app.inject({
      method: 'POST',
      url: `/acopios/${acopioId}/entregas`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        retiradoPorNombre: 'Juan Chofer',
        retiradoPorDni: '35123456',
        vehiculoPatente: 'AB123CD',
        observaciones: 'Primer retiro parcial para cimientos',
        items: [
          {
            itemAcopioId: itemCemento.id,
            productoId: negocioA.productoCementoId,
            cantidad: '10.000',
          },
        ],
      },
    });

    expect(resEntrega.statusCode).toBe(201);
    const bodyEntrega = resEntrega.json<{
      ok: boolean;
      remitoId: string;
      numeroRemito: string;
      acopioCompletado: boolean;
    }>();
    expect(bodyEntrega.ok).toBe(true);
    expect(bodyEntrega.numeroRemito).toBe('REM-0001');
    expect(bodyEntrega.acopioCompletado).toBe(false);

    // Verificar que en Kardex (movimiento_stock) se generó la salida física
    const resKardex = await adminPool.query<{ cantidad: string; tipo: string; sentido: string }>(
      `select cantidad::text, tipo, sentido from movimiento_stock
       where producto_id = $1 and tipo = 'entrega_acopio'`,
      [negocioA.productoCementoId],
    );
    expect(resKardex.rows).toHaveLength(1);
    expect(parseFloat(resKardex.rows[0]?.cantidad ?? '0')).toBe(10);
    expect(resKardex.rows[0]?.sentido).toBe('out');

    // Verificar detalle del acopio post-entrega parcial
    const resDetallePost = await app.inject({
      method: 'GET',
      url: `/acopios/${acopioId}`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    const detallePost = resDetallePost.json<AcopioDetalleCompleto>();
    expect(detallePost.acopio.estado).toBe('activo');
    expect(parseFloat(detallePost.acopio.totalUnidadesEntregadas)).toBe(10);
    expect(parseFloat(detallePost.acopio.saldoUnidadesPendientes)).toBe(25);
    expect(detallePost.remitos).toHaveLength(1);
    expect(detallePost.remitos[0]?.numero).toBe('REM-0001');
  });

  it('3. Impide entregar más del saldo pendiente y completa el acopio al entregar el total restante', async () => {
    const resList = await app.inject({
      method: 'GET',
      url: `/acopios?clienteId=${negocioA.clienteId}`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    const acopioId = resList.json<{ acopios: AcopioResumenItem[] }>().acopios[0]?.id ?? '';

    const resDetalle = await app.inject({
      method: 'GET',
      url: `/acopios/${acopioId}`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    const detalle = resDetalle.json<AcopioDetalleCompleto>();
    const itemCemento = detalle.items.find((i) => i.productoId === negocioA.productoCementoId);
    if (!itemCemento) throw new Error('No cemento');
    const itemArena = detalle.items.find((i) => i.productoId === negocioA.productoArenaId);
    if (!itemArena) throw new Error('No arena');

    // Intento de entregar más del saldo pendiente (quedan 20 bolsas, intenta entregar 25)
    const resIntentoExceso = await app.inject({
      method: 'POST',
      url: `/acopios/${acopioId}/entregas`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        retiradoPorNombre: 'Juan Chofer',
        items: [
          {
            itemAcopioId: itemCemento.id,
            productoId: negocioA.productoCementoId,
            cantidad: '25.000',
          },
        ],
      },
    });
    expect(resIntentoExceso.statusCode).toBe(500);

    // Entregar exactamente el remanente (20 de cemento y 5 de arena)
    const resEntregaFinal = await app.inject({
      method: 'POST',
      url: `/acopios/${acopioId}/entregas`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        retiradoPorNombre: 'Juan Chofer',
        observaciones: 'Retiro final de la totalidad del material',
        items: [
          {
            itemAcopioId: itemCemento.id,
            productoId: negocioA.productoCementoId,
            cantidad: '20.000',
          },
          {
            itemAcopioId: itemArena.id,
            productoId: negocioA.productoArenaId,
            cantidad: '5.000',
          },
        ],
      },
    });

    expect(resEntregaFinal.statusCode).toBe(201);
    const bodyFinal = resEntregaFinal.json<{ acopioCompletado: boolean; numeroRemito: string }>();
    expect(bodyFinal.acopioCompletado).toBe(true);
    expect(bodyFinal.numeroRemito).toBe('REM-0002');

    // Verificar que el estado cambió a 'completado' y el saldo pendiente es 0
    const resDetalleFinal = await app.inject({
      method: 'GET',
      url: `/acopios/${acopioId}`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    const detalleFinal = resDetalleFinal.json<AcopioDetalleCompleto>();
    expect(detalleFinal.acopio.estado).toBe('completado');
    expect(parseFloat(detalleFinal.acopio.saldoUnidadesPendientes)).toBe(0);
    expect(detalleFinal.acopio.pctEntregado).toBe(100);
  });

  it('4. Aislamiento estricto multi-negocio con RLS', async () => {
    // Negocio B no puede ver los acopios de Negocio A
    const resB = await app.inject({
      method: 'GET',
      url: '/acopios',
      headers: { authorization: `Bearer ${negocioB.tokenDueno}` },
    });
    expect(resB.statusCode).toBe(200);
    const bodyB = resB.json<{ acopios: AcopioResumenItem[] }>();
    expect(bodyB.acopios).toHaveLength(0);

    // Negocio B no puede consultar por ID el acopio de Negocio A (404 por RLS)
    const resListA = await app.inject({
      method: 'GET',
      url: '/acopios',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    const acopioIdA = resListA.json<{ acopios: AcopioResumenItem[] }>().acopios[0]?.id ?? '';

    const resIntentoB = await app.inject({
      method: 'GET',
      url: `/acopios/${acopioIdA}`,
      headers: { authorization: `Bearer ${negocioB.tokenDueno}` },
    });
    expect(resIntentoB.statusCode).toBe(404);
  });
});
