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
  rubroId: string;
}

describe('Fase 2 — Catálogo de artículos, fraccionamiento, códigos de barra y stock vivo', () => {
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
        `uid-caj-${randomUUID()}`,
        `uid-enc-${randomUUID()}`,
        `uid-due-${randomUUID()}`,
      ],
    );

    await adminPool.query('select sembrar_negocio($1)', [negocioId]);

    await adminPool.query(
      'insert into rubro (id, negocio_id, nombre) values ($1, $2, $3)',
      [rubroId, negocioId, 'Electricidad'],
    );

    const medioRes = await adminPool.query<{ id: string }>(
      "select id from medio_pago where negocio_id = $1 and nombre = 'Efectivo'",
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
      medioEfectivoId: medioRes.rows[0]?.id as string,
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

    negocioA = await sembrarNegocioPrueba('Ferretería A');
    negocioB = await sembrarNegocioPrueba('Ferretería B');
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await adminPool.end();
    await testDb.cleanup();
  });

interface TestProducto {
  id: string;
  codigo: string;
  nombre: string;
  permiteFraccion: boolean;
  precios: Record<string, string>;
}

interface TestDetalleProducto {
  producto: TestProducto;
  stockActualBase: string;
}

interface TestTurnoResponse {
  turno: {
    id: string;
  };
}

interface TestLookupResponse {
  encontrado: boolean;
  origen: string;
  codigoBarra: string;
  nombre?: string;
  stockActualBase?: string;
}

  it('permite dar de alta un producto con fraccionamiento y códigos de barra', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/productos',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        codigo: 'CAB-TPR-25',
        nombre: 'Cable Taller 2x2.5 mm Bobina 100m',
        marca: 'Prysmian',
        costoBase: '50000.00',
        unidadPrincipal: 'rollo',
        unidadSecundaria: 'metro',
        factorConversion: '100.000',
        permiteFraccion: true,
        stockMinimo: '2.000',
        rubroId: negocioA.rubroId,
        codigosBarra: ['7791234567890', 'INT-CAB-001'],
      },
    });

    expect(res.statusCode).toBe(201);
    const prod = res.json<TestProducto>();
    expect(prod.id).toBeDefined();
    expect(prod.codigo).toBe('CAB-TPR-25');
    expect(prod.permiteFraccion).toBe(true);
  });

  it('calcula precios dinámicamente según márgenes de las listas configuradas', async () => {
    // 50000.00 de costo:
    // Mostrador (+60%): 80000.00 el rollo; 800.00 el metro
    // Gremio (+40%):    70000.00 el rollo; 700.00 el metro
    // Mayorista (+25%): 62500.00 el rollo; 625.00 el metro
    const res = await app.inject({
      method: 'GET',
      url: '/productos?q=Cable',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });

    expect(res.statusCode).toBe(200);
    const items = res.json<TestProducto[]>();
    expect(items.length).toBe(1);
    const prod = items[0];
    expect(prod).toBeDefined();
    if (!prod) return;
    expect(prod.precios['Mostrador']).toBe('80000.00');
    expect(prod.precios['Gremio']).toBe('70000.00');
    expect(prod.precios['Mayorista']).toBe('62500.00');
  });

  it('permite registrar ingreso inicial de stock y calcula v_stock_actual', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/productos?q=CAB-TPR-25',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    const primerProd = listRes.json<TestProducto[]>()[0];
    expect(primerProd).toBeDefined();
    if (!primerProd) return;
    const prodId = primerProd.id;

    // Ingresar 5 rollos (stock inicial / compra)
    const resAjuste = await app.inject({
      method: 'POST',
      url: '/stock/ajuste',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        productoId: prodId,
        tipo: 'ingreso_compra',
        cantidad: '5.000',
        unidad: 'principal',
        notas: 'Stock inicial 5 rollos',
      },
    });

    expect(resAjuste.statusCode).toBe(201);

    // Consultar detalle: stock actual debe ser 5.000 rollos
    const detalleRes = await app.inject({
      method: 'GET',
      url: `/productos/${prodId}`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });

    expect(detalleRes.statusCode).toBe(200);
    expect(detalleRes.json<TestDetalleProducto>().stockActualBase).toBe('5.000');
  });

  it('descuenta automáticamente del stock al vender fraccionado en mostrador', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/productos?q=CAB-TPR-25',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    const prod = listRes.json<TestProducto[]>()[0];
    expect(prod).toBeDefined();
    if (!prod) return;

    // Abrir turno de caja
    const turnoRes = await app.inject({
      method: 'POST',
      url: '/turnos/abrir',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        cajaId: negocioA.cajaId,
        efectivoInicial: '1000.00',
      },
    });
    const turnoId = turnoRes.json<TestTurnoResponse>().turno.id;

    // Vender 25 metros de cable fraccionado (25m de un rollo de 100m = 0.250 de la unidad principal)
    // Precio por metro: 800.00 -> 25 * 800 = 20000.00
    const ventaId = randomUUID();
    const movId = randomUUID();

    const ventaRes = await app.inject({
      method: 'POST',
      url: '/ventas',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        id: ventaId,
        turnoId,
        total: '20000.00',
        pagos: [
          {
            movimientoId: movId,
            medioPagoId: negocioA.medioEfectivoId,
            monto: '20000.00',
            rubroId: negocioA.rubroId,
          },
        ],
        items: [
          {
            productoId: prod.id,
            descripcion: 'Cable Taller 2x2.5 (25 metros)',
            cantidad: '25.000',
            precioUnit: '800.00',
            unidad: 'secundaria',
          },
        ],
      },
    });

    expect(ventaRes.statusCode).toBe(201);

    // Verificar que el stock base pasó de 5.000 a 4.750 (5 rollos - 0.250 rollos = 4.750 rollos restantes)
    const detalleRes = await app.inject({
      method: 'GET',
      url: `/productos/${prod.id}`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });

    expect(detalleRes.json<TestDetalleProducto>().stockActualBase).toBe('4.750');
  });

  it('permite lookup por código de barras de pistola y autocompleta con datos locales', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/productos/lookup-ean/7791234567890',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });

    expect(res.statusCode).toBe(200);
    const lookup = res.json<TestLookupResponse>();
    expect(lookup.encontrado).toBe(true);
    expect(lookup.origen).toBe('local');
    expect(lookup.nombre).toContain('Cable Taller');
    expect(lookup.stockActualBase).toBe('4.750');
  });

  it('hace fallback a búsqueda externa cuando el código no existe en la base local', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/productos/lookup-ean/9999999999999',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });

    expect(res.statusCode).toBe(200);
    const lookup = res.json<TestLookupResponse>();
    expect(lookup.codigoBarra).toBe('9999999999999');
    expect(['mercadolibre', 'no_encontrado']).toContain(lookup.origen);
  });

  it('impide modificar o borrar movimientos de stock (libro de solo agregar con trigger)', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('begin');
      await client.query('set local role app_user');
      await client.query(
        "select set_config('app.negocio_id', $1, true)",
        [negocioA.negocioId],
      );

      // Intento de UPDATE directo en movimiento_stock
      let falloUpdate = false;
      try {
        await client.query("update movimiento_stock set cantidad = '999'");
      } catch {
        falloUpdate = true;
      }
      expect(falloUpdate).toBe(true);

      // Intento de DELETE directo en movimiento_stock
      let falloDelete = false;
      try {
        await client.query('delete from movimiento_stock');
      } catch {
        falloDelete = true;
      }
      expect(falloDelete).toBe(true);

      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('garantiza el aislamiento multi-negocio con RLS', async () => {
    // Negocio B no debe ver los productos de Negocio A
    const resB = await app.inject({
      method: 'GET',
      url: '/productos?q=CAB-TPR-25',
      headers: { authorization: `Bearer ${negocioB.tokenCajero}` },
    });

    expect(resB.statusCode).toBe(200);
    expect(resB.json<TestProducto[]>().length).toBe(0);
  });

  describe('Fase 14 — Carga masiva desde Excel / CSV de artículos y precios', () => {
    it('rechaza la importación masiva si el usuario es cajero', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/productos/importar-masivo',
        headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
        payload: {
          productos: [
            {
              codigo: 'BULON-8X50',
              nombre: 'Bulón 8x50 cabeza hexagonal',
              costoBase: '150.00',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('importa masivamente nuevos artículos, siembra rubros faltantes y registra stock inicial inmutable', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/productos/importar-masivo',
        headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
        payload: {
          productos: [
            {
              codigo: 'IMP-CLAVO-2',
              nombre: 'Clavo punta parís 2 pulgadas',
              marca: 'Acindar',
              rubroNombre: 'Fijaciones y Tornillos',
              costoBase: '500.00',
              stockMinimo: '10.000',
              stockActual: '50.000',
              codigoBarra: '7791234567890',
            },
            {
              codigo: 'IMP-DISCO-CORTE',
              nombre: 'Disco de corte fino 115mm',
              marca: 'Norton',
              rubroNombre: 'Herramientas',
              costoBase: '0.00',
              precioMostradorSugerido: '1600.00', // Con margen mostrador 60%, costo aprox 1000.00
              stockActual: '20.000',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<{
        totalProcesados: number;
        creados: number;
        actualizados: number;
        movimientosStockCreados: number;
        rubrosCreados: number;
      }>();

      expect(data.totalProcesados).toBe(2);
      expect(data.creados).toBe(2);
      expect(data.movimientosStockCreados).toBe(2);
      expect(data.rubrosCreados).toBeGreaterThanOrEqual(1);

      // Verificar que el producto y su stock se reflejen en la vista v_stock_actual
      const resList = await app.inject({
        method: 'GET',
        url: '/productos?q=IMP-CLAVO-2',
        headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      });

      expect(resList.statusCode).toBe(200);
      const prods = resList.json<Array<{ codigo: string; stock_actual_base: string; costo_base: string }>>();
      expect(prods.length).toBe(1);
      const prodClavo = prods[0];
      expect(prodClavo).toBeDefined();
      expect(prodClavo?.codigo).toBe('IMP-CLAVO-2');
      expect(Number(prodClavo?.stock_actual_base)).toBe(50);
      expect(prodClavo?.costo_base).toBe('500.00');

      // Verificar que el producto con costo deducido de mostrador tenga costo calculado
      const resDisco = await app.inject({
        method: 'GET',
        url: '/productos?q=IMP-DISCO-CORTE',
        headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      });
      const discoProds = resDisco.json<Array<{ codigo: string; costo_base: string; stock_actual_base: string }>>();
      expect(discoProds.length).toBe(1);
      const prodDisco = discoProds[0];
      expect(prodDisco).toBeDefined();
      expect(Number(prodDisco?.costo_base)).toBeCloseTo(1000, 1);
      expect(Number(prodDisco?.stock_actual_base)).toBe(20);
    });

    it('actualiza artículos existentes e inserta ajuste de stock por la diferencia', async () => {
      // Re-importar IMP-CLAVO-2 con nuevo costo y nuevo stock de 65.000 (diferencia +15.000)
      const res = await app.inject({
        method: 'POST',
        url: '/productos/importar-masivo',
        headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
        payload: {
          productos: [
            {
              codigo: 'IMP-CLAVO-2',
              nombre: 'Clavo punta parís 2 pulg (Acero)',
              costoBase: '550.00',
              stockActual: '65.000',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<{
        creados: number;
        actualizados: number;
        movimientosStockCreados: number;
      }>();

      expect(data.creados).toBe(0);
      expect(data.actualizados).toBe(1);
      expect(data.movimientosStockCreados).toBe(1);

      // El stock ahora debe ser 65.000
      const resList = await app.inject({
        method: 'GET',
        url: '/productos?q=IMP-CLAVO-2',
        headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      });
      const prods = resList.json<Array<{ codigo: string; stock_actual_base: string; costo_base: string; nombre: string }>>();
      const prodActualizado = prods[0];
      expect(prodActualizado).toBeDefined();
      expect(prodActualizado?.nombre).toBe('Clavo punta parís 2 pulg (Acero)');
      expect(prodActualizado?.costo_base).toBe('550.00');
      expect(Number(prodActualizado?.stock_actual_base)).toBe(65);
    });
  });
});
