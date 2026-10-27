import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  DepositoItem,
  StockPorDepositoItem,
  TransferenciaStockCompleta,
  TransferenciaStockResumen,
} from '@ferreteria/shared';
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
  tokenDueno: string;
}

describe('Fase 22 — Múltiples Depósitos y Transferencias Internas de Stock', () => {
  let testDb: TestDatabaseHandle;
  let adminPool: pg.Pool;
  let app: FastifyInstance;
  let negocioA: NegocioPrueba;
  let negocioB: NegocioPrueba;

  async function sembrarNegocio(nombre: string): Promise<NegocioPrueba> {
    const negocioId = randomUUID();
    const duenoId = randomUUID();

    await adminPool.query(
      `insert into negocio (id, nombre, cuit, condicion_iva) values ($1, $2, '30112233445', 'responsable_inscripto')`,
      [negocioId, nombre],
    );

    await adminPool.query(
      `insert into usuario (id, negocio_id, proveedor_uid, email, password_hash, nombre, rol)
       values ($1, $2, $4, $3, 'hash_test', 'Dueño', 'dueno')`,
      [duenoId, negocioId, `dueno_${negocioId.slice(0, 6)}@test.com`, `uid_d_${negocioId.slice(0, 6)}`],
    );

    await adminPool.query(`select sembrar_negocio($1)`, [negocioId]);

    const tokenDueno = createAuthToken({
      negocio_id: negocioId,
      usuario_id: duenoId,
      rol: 'dueno',
    });

    return {
      negocioId,
      duenoId,
      tokenDueno,
    };
  }

  beforeAll(async () => {
    testDb = await createIsolatedTestDatabase();
    await runMigrations({
      connectionString: testDb.url,
      
    });

    adminPool = new Pool({ connectionString: testDb.url });
    negocioA = await sembrarNegocio('Ferretería Central');
    negocioB = await sembrarNegocio('Ferretería Rivadavia');

    app = buildServer({
      databaseUrl: testDb.url,
      logger: false,
    });
  });

  afterAll(async () => {
    await app.close();
    await adminPool.end();
    await testDb.cleanup();
  });

  it('1. Lista depósitos sembrados del negocio con su depósito principal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/depositos',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });

    expect(res.statusCode).toBe(200);
    const depositos = res.json<DepositoItem[]>();
    expect(depositos.length).toBeGreaterThanOrEqual(1);

    const principal = depositos.find((d) => d.esPrincipal);
    expect(principal).toBeDefined();
    expect(principal?.nombre).toBe('Local Principal');
  });

  it('2. Crea un nuevo depósito secundario (sucursal/galpón) y lo actualiza', async () => {
    const resCrear = await app.inject({
      method: 'POST',
      url: '/depositos',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        nombre: 'Galpón de Pinturas',
        codigo: 'DEP-GALPON',
        direccion: 'Ruta 3 Km 45',
        esPrincipal: false,
      },
    });

    if (resCrear.statusCode !== 201) console.log("ERROR CREAR DEP:", resCrear.json());
    expect(resCrear.statusCode).toBe(201);
    const nuevoDep = resCrear.json<DepositoItem>();
    expect(nuevoDep.id).toBeDefined();
    expect(nuevoDep.codigo).toBe('DEP-GALPON');

    // Editar depósito
    const resPatch = await app.inject({
      method: 'PATCH',
      url: `/depositos/${nuevoDep.id}`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        direccion: 'Ruta 3 Km 45 - Acceso Norte',
      },
    });

    expect(resPatch.statusCode).toBe(200);
    const depEditado = resPatch.json<DepositoItem>();
    expect(depEditado.direccion).toBe('Ruta 3 Km 45 - Acceso Norte');
  });

  it('3. Registra una transferencia de stock entre depósitos e impacta movimientos atómicamente', async () => {
    // 1. Obtener depósitos
    const resDeps = await app.inject({
      method: 'GET',
      url: '/depositos',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    const depositos = resDeps.json<DepositoItem[]>();
    const depOrigen = depositos[0];
    const depDestino = depositos[1];
    if (!depOrigen || !depDestino) throw new Error("Faltan depósitos");

    // 2. Crear un producto y cargar stock inicial en el depósito de origen
    const prodId = randomUUID();
    await adminPool.query(
      `insert into producto (id, negocio_id, codigo, nombre, marca, costo_base, unidad_principal, factor_conversion)
       values ($1, $2, 'PROD-TRF-01', 'Cinta Métrica 5m', 'Stanley', 1500.00, 'unidad', 1)`,
      [prodId, negocioA.negocioId],
    );

    // Cargar stock inicial de 20 unidades en depOrigen
    await adminPool.query(
      `insert into movimiento_stock
         (negocio_id, producto_id, deposito_id, tipo, sentido, cantidad, unidad, cantidad_base, costo_unitario, notas, creado_por)
       values ($1, $2, $3, 'ingreso_compra', 'in', 20.000, 'unidad', 20.000, 1500.00, 'Stock inicial', $4)`,
      [negocioA.negocioId, prodId, depOrigen.id, negocioA.duenoId],
    );

    // 3. Ejecutar transferencia de 5 unidades de depOrigen a depDestino
    const resTrf = await app.inject({
      method: 'POST',
      url: '/depositos/transferencias',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        depositoOrigenId: depOrigen.id,
        depositoDestinoId: depDestino.id,
        motivo: 'Abastecimiento de salón',
        observaciones: 'Llevar con remito interno',
        items: [
          {
            productoId: prodId,
            cantidad: '5.000',
            unidad: 'unidad',
            cantidadBase: '5.000',
            notas: 'Caja cerrada',
          },
        ],
      },
    });

    if (resTrf.statusCode !== 201) console.log("ERROR CREAR TRF:", resTrf.json());
    expect(resTrf.statusCode).toBe(201);
    const trfCreada = resTrf.json<{ id: string; numero: string; estado: string }>();
    expect(trfCreada.id).toBeDefined();
    expect(trfCreada.numero).toMatch(/^TRF-\d{4}$/);

    // 4. Verificar detalle completo de la transferencia
    const resDet = await app.inject({
      method: 'GET',
      url: `/depositos/transferencias/${trfCreada.id}`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    expect(resDet.statusCode).toBe(200);
    const detalle = resDet.json<TransferenciaStockCompleta>();
    expect(detalle.items.length).toBe(1);
    expect(detalle.items[0]?.productoCodigo).toBe('PROD-TRF-01');
    expect(detalle.items[0]?.cantidad).toBe('5.000');

    // 5. Verificar stock en depósito origen: 20 - 5 = 15
    const resStockOrigen = await app.inject({
      method: 'GET',
      url: `/depositos/${depOrigen.id}/stock`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    const stockOrigen = resStockOrigen.json<StockPorDepositoItem[]>();
    const itemOrigen = stockOrigen.find((s) => s.productoId === prodId);
    expect(parseFloat(itemOrigen?.stockActualBase ?? '0')).toBe(15);

    // 6. Verificar stock en depósito destino: 0 + 5 = 5
    const resStockDestino = await app.inject({
      method: 'GET',
      url: `/depositos/${depDestino.id}/stock`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    const stockDestino = resStockDestino.json<StockPorDepositoItem[]>();
    const itemDestino = stockDestino.find((s) => s.productoId === prodId);
    expect(parseFloat(itemDestino?.stockActualBase ?? '0')).toBe(5);
  });

  it('4. Aislamiento Multi-Negocio RLS: Negocio B no puede ver transferencias de Negocio A', async () => {
    // Listar transferencias como Negocio B (debe estar vacío)
    const resTrfB = await app.inject({
      method: 'GET',
      url: '/depositos/transferencias',
      headers: { authorization: `Bearer ${negocioB.tokenDueno}` },
    });

    expect(resTrfB.statusCode).toBe(200);
    const listaB = resTrfB.json<TransferenciaStockResumen[]>();
    expect(listaB.length).toBe(0);
  });
});
