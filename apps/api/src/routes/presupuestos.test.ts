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
  PresupuestoDetalle,
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

interface PresupuestoCreadoRes {
  id: string;
  numero: number;
  total: string;
  estado: string;
}

describe('Presupuestos y Cotizaciones de Mostrador', () => {
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
        `uid-${cajeroId}`,
        `uid-${encargadoId}`,
        `uid-${duenoId}`,
      ],
    );

    const tokenCajero = createAuthToken({
      negocio_id: negocioId,
      usuario_id: cajeroId,
      rol: 'cajero',
    });
    const tokenEncargado = createAuthToken({
      negocio_id: negocioId,
      usuario_id: encargadoId,
      rol: 'encargado',
    });
    const tokenDueno = createAuthToken({
      negocio_id: negocioId,
      usuario_id: duenoId,
      rol: 'dueno',
    });

    return {
      negocioId,
      cajaId,
      cajeroId,
      encargadoId,
      duenoId,
      tokenCajero,
      tokenEncargado,
      tokenDueno,
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

    negocioA = await sembrarNegocioPrueba('Ferretería Central A');
    negocioB = await sembrarNegocioPrueba('Ferretería Sucursal B');
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await adminPool.end();
    await testDb.cleanup();
  });

  let presupuestoIdA: string;

  it('1. Emite un presupuesto de mostrador con múltiples artículos', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/presupuestos',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        diasValidez: 15,
        nombreContacto: 'Arq. Mario Gómez',
        telefonoContacto: '11-4455-6677',
        subtotal: '24500.00',
        descuentoGeneral: '500.00',
        total: '24000.00',
        observaciones: 'Materiales para refacción de baño en obra',
        items: [
          {
            nombre: 'Caño termofusión 20mm x 4m',
            unidad: 'unidad',
            cantidad: '10.000',
            precioUnitario: '1800.00',
            descuentoPct: '0.00',
            subtotal: '18000.00',
            notas: 'Agua fría y caliente',
          },
          {
            nombre: 'Codo termofusión 20mm a 90°',
            unidad: 'unidad',
            cantidad: '20.000',
            precioUnitario: '325.00',
            descuentoPct: '0.00',
            subtotal: '6500.00',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const pres = res.json<PresupuestoCreadoRes>();
    expect(pres.numero).toBe(1);
    expect(pres.total).toBe('24000.00');
    expect(pres.estado).toBe('pendiente');
    presupuestoIdA = pres.id;
  });

  it('2. Consulta el listado y detalle del presupuesto emitido', async () => {
    const resList = await app.inject({
      method: 'GET',
      url: '/presupuestos',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });

    expect(resList.statusCode).toBe(200);
    const lista = resList.json<PresupuestoDetalle[]>();
    expect(lista.length).toBeGreaterThanOrEqual(1);

    const primero = lista.find((p) => p.id === presupuestoIdA);
    expect(primero).toBeDefined();
    expect(primero?.numero).toBe(1);
    expect(primero?.nombreContacto).toBe('Arq. Mario Gómez');
    expect(primero?.estaVencido).toBe(false);

    // Detalle con ítems
    const resDetalle = await app.inject({
      method: 'GET',
      url: `/presupuestos/${presupuestoIdA}`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });

    expect(resDetalle.statusCode).toBe(200);
    const detalle = resDetalle.json<PresupuestoDetalle>();
    expect(detalle.items).toHaveLength(2);
    expect(detalle.items[0]?.nombre).toBe('Caño termofusión 20mm x 4m');
    expect(detalle.items[0]?.cantidad).toBe('10.000');
  });

  it('3. Marca el presupuesto como aprobado / convertido a venta', async () => {
    const turnoId = randomUUID();
    const ventaId = randomUUID();
    await adminPool.query(
      `insert into turno_caja (id, negocio_id, caja_id, abierto_por, efectivo_inicial)
       values ($1, $2, $3, $4, '0.00')`,
      [turnoId, negocioA.negocioId, negocioA.cajaId, negocioA.cajeroId],
    );
    await adminPool.query(
      `insert into venta (id, negocio_id, turno_id, total, creado_por)
       values ($1, $2, $3, '24000.00', $4)`,
      [ventaId, negocioA.negocioId, turnoId, negocioA.cajeroId],
    );

    const res = await app.inject({
      method: 'POST',
      url: `/presupuestos/${presupuestoIdA}/marcar-convertido`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        ventaId,
      },
    });

    expect(res.statusCode).toBe(200);
    const actualizado = res.json<PresupuestoCreadoRes>();
    expect(actualizado.estado).toBe('aprobado_convertido');
  });

  it('4. Permite cancelar un presupuesto pendiente', async () => {
    // Creamos otro presupuesto
    const resCrear = await app.inject({
      method: 'POST',
      url: '/presupuestos',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        diasValidez: 7,
        nombreContacto: 'Cliente a cancelar',
        subtotal: '5000.00',
        total: '5000.00',
        items: [
          {
            nombre: 'Tornillo fix 4x40mm',
            unidad: 'unidad',
            cantidad: '100.000',
            precioUnitario: '50.00',
            subtotal: '5000.00',
          },
        ],
      },
    });

    expect(resCrear.statusCode).toBe(201);
    const creado = resCrear.json<PresupuestoCreadoRes>();
    expect(creado.numero).toBe(2);

    const resCancel = await app.inject({
      method: 'POST',
      url: `/presupuestos/${creado.id}/cancelar`,
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });

    expect(resCancel.statusCode).toBe(200);
    const cancelado = resCancel.json<PresupuestoCreadoRes>();
    expect(cancelado.estado).toBe('cancelado');
  });

  it('5. RLS estricto: Negocio B no ve los presupuestos de Negocio A', async () => {
    const resB = await app.inject({
      method: 'GET',
      url: '/presupuestos',
      headers: { authorization: `Bearer ${negocioB.tokenCajero}` },
    });

    expect(resB.statusCode).toBe(200);
    const listaB = resB.json<PresupuestoDetalle[]>();
    expect(listaB).toHaveLength(0); // Vacío en Negocio B
  });
});
