import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthToken } from '../auth.js';
import { runMigrations } from '../db/migrate.js';
import { buildServer } from '../server.js';
import {
  createIsolatedTestDatabase,
  type TestDatabaseHandle,
} from '../db/test-db.js';

const { Pool } = pg;

interface NegocioPrueba {
  negocioId: string;
  duenoId: string;
  encargadoId: string;
  cajeroId: string;
  tokenDueno: string;
  tokenEncargado: string;
  tokenCajero: string;
  rubroId: string;
  productoTornilloId: string;
  listaMostradorId: string;
}

describe('Fase 17A — Listas de Precios Múltiples y Reglas de Descuento por Volumen', () => {
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
    const productoTornilloId = randomUUID();
    const listaMostradorId = randomUUID();

    // 1. Negocio, sucursal, caja, usuarios y rubro
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
      `insert into rubro (id, negocio_id, nombre) values ($1, $2, 'Bulonería')`,
      [rubroId, negocioId],
    );

    // 2. Lista Mostrador base (60% margen)
    await adminPool.query(
      `insert into lista_precio (id, negocio_id, nombre, margen_pct, orden, activo)
       values ($1, $2, 'Mostrador', 60.00, 1, true)`,
      [listaMostradorId, negocioId],
    );

    // 3. Producto Tornillo (Costo $100 -> Venta Mostrador esperada $160)
    await adminPool.query(
      `insert into producto (id, negocio_id, rubro_id, codigo, nombre, costo_base, unidad_principal)
       values ($1, $2, $3, 'TOR-01', 'Tornillo 4x40', 100.00, 'un')`,
      [productoTornilloId, negocioId, rubroId],
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
      rubroId,
      productoTornilloId,
      listaMostradorId,
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

  it('permite al dueño crear una nueva lista de precios (Mayorista) y bloquea al cajero', async () => {
    // 1. Cajero no autorizado (403)
    const resCajero = await app.inject({
      method: 'POST',
      url: '/listas-precios',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        nombre: 'Mayorista',
        margenPct: '30.00',
        orden: 2,
      },
    });
    expect(resCajero.statusCode).toBe(403);

    // 2. Dueño crea la lista exitosamente (201)
    const resDueno = await app.inject({
      method: 'POST',
      url: '/listas-precios',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        nombre: 'Mayorista',
        margenPct: '30.00',
        orden: 2,
      },
    });
    expect(resDueno.statusCode).toBe(201);
    const body = resDueno.json<{ id: string; nombre: string; margenPct: string }>();
    expect(body.nombre).toBe('Mayorista');
    expect(body.margenPct).toBe('30.00');

    // 3. Verificar que la vista v_precios_producto calculó automáticamente el precio para la nueva lista
    // Costo $100 + 30% = $130.00
    const vRes = await adminPool.query<{ lista_nombre: string; precio_venta_principal: string }>(
      'select lista_nombre, precio_venta_principal from v_precios_producto where producto_id = $1 and negocio_id = $2 order by lista_nombre',
      [negocioA.productoTornilloId, negocioA.negocioId],
    );
    expect(vRes.rows.length).toBe(2);
    const precioMayorista = vRes.rows.find((r) => r.lista_nombre === 'Mayorista');
    expect(precioMayorista?.precio_venta_principal).toBe('130.00');
  });

  it('permite fijar un precio excepcional fijo por producto en una lista y sobreescribir el cálculo de margen', async () => {
    // Fijamos precio manual de $145.00 en la lista Mostrador para el Tornillo (en vez de los $160 que daría el 60%)
    const resFijar = await app.inject({
      method: 'POST',
      url: '/listas-precios/fijar-precio',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        productoId: negocioA.productoTornilloId,
        listaPrecioId: negocioA.listaMostradorId,
        precioFijo: '145.00',
      },
    });
    expect(resFijar.statusCode).toBe(200);

    // Verificar en la vista v_precios_producto que ahora da $145.00 y marca es_precio_fijo = true
    const vRes = await adminPool.query<{ precio_venta_principal: string; es_precio_fijo: boolean }>(
      'select precio_venta_principal, es_precio_fijo from v_precios_producto where producto_id = $1 and lista_precio_id = $2 and negocio_id = $3',
      [negocioA.productoTornilloId, negocioA.listaMostradorId, negocioA.negocioId],
    );
    expect(vRes.rows[0]?.precio_venta_principal).toBe('145.00');
    expect(vRes.rows[0]?.es_precio_fijo).toBe(true);

    // Eliminamos el precio fijo para volver al margen normal
    const resDel = await app.inject({
      method: 'DELETE',
      url: `/listas-precios/fijar-precio/${negocioA.productoTornilloId}/${negocioA.listaMostradorId}`,
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    expect(resDel.statusCode).toBe(200);

    // Verificar que volvió a $160.00 (100 * 1.60) y es_precio_fijo = false
    const vRes2 = await adminPool.query<{ precio_venta_principal: string; es_precio_fijo: boolean }>(
      'select precio_venta_principal, es_precio_fijo from v_precios_producto where producto_id = $1 and lista_precio_id = $2 and negocio_id = $3',
      [negocioA.productoTornilloId, negocioA.listaMostradorId, negocioA.negocioId],
    );
    expect(vRes2.rows[0]?.precio_venta_principal).toBe('160.00');
    expect(vRes2.rows[0]?.es_precio_fijo).toBe(false);
  });

  it('permite crear, consultar, actualizar y eliminar reglas de descuento por volumen', async () => {
    // 1. Crear regla de volumen para tornillos: a partir de 50 un. -> 12% off
    const resCrear = await app.inject({
      method: 'POST',
      url: '/reglas-volumen',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        nombre: 'Promo Bulto Tornillo 50+',
        productoId: negocioA.productoTornilloId,
        cantidadMinima: '50.000',
        descuentoPct: '12.00',
      },
    });
    expect(resCrear.statusCode).toBe(201);
    const bodyCrear = resCrear.json<{ id: string; nombre: string; descuentoPct: string }>();
    expect(bodyCrear.descuentoPct).toBe('12.00');
    const reglaId = bodyCrear.id;

    // 2. Listar reglas (GET /reglas-volumen)
    const resListar = await app.inject({
      method: 'GET',
      url: '/reglas-volumen',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    expect(resListar.statusCode).toBe(200);
    const reglas = resListar.json<Array<{ id: string; nombre: string; productoCodigo: string }>>();
    expect(reglas.length).toBeGreaterThanOrEqual(1);
    const rEncontrada = reglas.find((r) => r.id === reglaId);
    expect(rEncontrada?.nombre).toBe('Promo Bulto Tornillo 50+');
    expect(rEncontrada?.productoCodigo).toBe('TOR-01');

    // 3. Modificar regla (aumentar descuento a 15%)
    const resModif = await app.inject({
      method: 'PUT',
      url: `/reglas-volumen/${reglaId}`,
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        descuentoPct: '15.00',
      },
    });
    expect(resModif.statusCode).toBe(200);
    const bodyModif = resModif.json<{ descuentoPct: string }>();
    expect(bodyModif.descuentoPct).toBe('15.00');

    // 4. Eliminar regla
    const resDel = await app.inject({
      method: 'DELETE',
      url: `/reglas-volumen/${reglaId}`,
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    expect(resDel.statusCode).toBe(200);
  });

  it('garantiza aislamiento multi-negocio con RLS: Negocio B no ve ni modifica reglas ni listas de Negocio A', async () => {
    // Negocio A crea una regla exclusiva
    const resCrearA = await app.inject({
      method: 'POST',
      url: '/reglas-volumen',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        nombre: 'Regla Exclusiva Negocio A',
        rubroId: negocioA.rubroId,
        cantidadMinima: '10.000',
        descuentoPct: '5.00',
      },
    });
    expect(resCrearA.statusCode).toBe(201);
    const reglaAId = resCrearA.json<{ id: string }>().id;

    // Negocio B lista sus reglas y no ve la regla de A
    const resListarB = await app.inject({
      method: 'GET',
      url: '/reglas-volumen',
      headers: { authorization: `Bearer ${negocioB.tokenCajero}` },
    });
    expect(resListarB.statusCode).toBe(200);
    const reglasB = resListarB.json<Array<{ id: string }>>();
    expect(reglasB.find((r) => r.id === reglaAId)).toBeUndefined();

    // Negocio B intenta modificar la regla de A (recibe 404 por aislamiento RLS)
    const resModifB = await app.inject({
      method: 'PUT',
      url: `/reglas-volumen/${reglaAId}`,
      headers: { authorization: `Bearer ${negocioB.tokenEncargado}` },
      payload: {
        descuentoPct: '99.00',
      },
    });
    expect(resModifB.statusCode).toBe(404);

    // Negocio B intenta eliminar la regla de A (recibe 404 por aislamiento RLS)
    const resDelB = await app.inject({
      method: 'DELETE',
      url: `/reglas-volumen/${reglaAId}`,
      headers: { authorization: `Bearer ${negocioB.tokenEncargado}` },
    });
    expect(resDelB.statusCode).toBe(404);
  });
});
