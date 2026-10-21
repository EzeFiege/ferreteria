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
  AsientoContableDetalle,
  CuentaContableItem,
  ItemSumasYSaldos,
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

interface AsientoContableCreadoRes {
  id: string;
  numero: number;
  concepto: string;
  origen: string;
}

describe('Fase 7 — Contabilidad (Plan de cuentas, Libro Diario, Sumas y Saldos)', () => {
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
    await adminPool.query('select sembrar_negocio($1)', [negocioId]);
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

    negocioA = await sembrarNegocioPrueba('Ferretería El Tornillo A');
    negocioB = await sembrarNegocioPrueba('Ferretería La Tuerca B');
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await adminPool.end();
    await testDb.cleanup();
  });

  it('1. Auto-inicializa el plan de cuentas contable y lista cuentas', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/contabilidad/cuentas',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });

    expect(res.statusCode).toBe(200);
    const cuentas = res.json<CuentaContableItem[]>();
    expect(cuentas.length).toBeGreaterThanOrEqual(10);

    const codigos = cuentas.map((c) => c.codigo);
    expect(codigos).toContain('1.1.01'); // Caja Efectivo
    expect(codigos).toContain('1.1.02'); // Banco
    expect(codigos).toContain('2.1.01'); // Proveedores
    expect(codigos).toContain('4.1.01'); // Ventas
    expect(codigos).toContain('5.1.01'); // Costo de Mercaderías
  });

  it('2. Permite agregar una nueva cuenta contable al plan de cuentas', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/contabilidad/cuentas',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        codigo: '5.1.04',
        nombre: 'Comisiones de Envíos y Logística',
        tipo: 'egreso',
        descripcion: 'Gastos de logística externa',
      },
    });

    expect(res.statusCode).toBe(201);
    const nueva = res.json<CuentaContableItem>();
    expect(nueva.codigo).toBe('5.1.04');
    expect(nueva.nombre).toBe('Comisiones de Envíos y Logística');
  });

  it('3. Rechaza asientos desbalanceados por partida doble (violación contable)', async () => {
    const resCuentas = await app.inject({
      method: 'GET',
      url: '/contabilidad/cuentas',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    const cuentas = resCuentas.json<CuentaContableItem[]>();
    const caja = cuentas.find((c) => c.codigo === '1.1.01');
    const gastos = cuentas.find((c) => c.codigo === '5.1.02');

    expect(caja).toBeDefined();
    expect(gastos).toBeDefined();

    const res = await app.inject({
      method: 'POST',
      url: '/contabilidad/asientos',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        concepto: 'Asiento desbalanceado inválido',
        origen: 'manual',
        renglones: [
          { cuentaId: caja?.id, debe: '5000.00', haber: '0.00' },
          { cuentaId: gastos?.id, debe: '0.00', haber: '4500.00' }, // Desbalance de 500
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const errorBody = res.json<{ error: string }>();
    expect(errorBody.error).toContain('Partida doble desbalanceada');
  });

  it('4. Registra un asiento manual balanceado y lo refleja en el Libro Diario', async () => {
    const resCuentas = await app.inject({
      method: 'GET',
      url: '/contabilidad/cuentas',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    const cuentas = resCuentas.json<CuentaContableItem[]>();
    const caja = cuentas.find((c) => c.codigo === '1.1.01');
    const gastos = cuentas.find((c) => c.codigo === '5.1.02');

    expect(caja).toBeDefined();
    expect(gastos).toBeDefined();

    // Registrar pago de servicios: Debe Gastos $12.500, Haber Caja $12.500
    const resAsiento = await app.inject({
      method: 'POST',
      url: '/contabilidad/asientos',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
      payload: {
        concepto: 'Pago de servicio de electricidad del local',
        origen: 'egreso_caja',
        renglones: [
          { cuentaId: gastos?.id, debe: '12500.00', haber: '0.00', descripcion: 'Factura Edesur' },
          { cuentaId: caja?.id, debe: '0.00', haber: '12500.00', descripcion: 'Salida de caja' },
        ],
      },
    });

    expect(resAsiento.statusCode).toBe(201);
    const asientoCreado = resAsiento.json<AsientoContableCreadoRes>();
    expect(asientoCreado.numero).toBe(1);

    // Consultar el libro diario
    const resDiario = await app.inject({
      method: 'GET',
      url: '/contabilidad/libro-diario',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });

    expect(resDiario.statusCode).toBe(200);
    const libro = resDiario.json<AsientoContableDetalle[]>();
    expect(libro.length).toBeGreaterThanOrEqual(1);

    const primerAsiento = libro.find((a) => a.id === asientoCreado.id);
    expect(primerAsiento).toBeDefined();
    expect(primerAsiento?.concepto).toBe('Pago de servicio de electricidad del local');
    expect(primerAsiento?.totalDebe).toBe('12500.00');
    expect(primerAsiento?.totalHaber).toBe('12500.00');
    expect(primerAsiento?.cuadrado).toBe(true);
    expect(primerAsiento?.renglones).toHaveLength(2);
  });

  it('5. Refleja las sumas y saldos en vivo (Balance de Comprobación)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/contabilidad/sumas-y-saldos',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });

    expect(res.statusCode).toBe(200);
    const balance = res.json<ItemSumasYSaldos[]>();

    const caja = balance.find((c) => c.cuentaCodigo === '1.1.01');
    const gastos = balance.find((c) => c.cuentaCodigo === '5.1.02');

    expect(caja).toBeDefined();
    expect(caja?.totalHaber).toBe('12500.00');
    expect(caja?.saldoAcreedor).toBe('12500.00');

    expect(gastos).toBeDefined();
    expect(gastos?.totalDebe).toBe('12500.00');
    expect(gastos?.saldoDeudor).toBe('12500.00');
  });

  it('6. Regla inviolable: los asientos y renglones son inmutables (no UPDATE ni DELETE)', async () => {
    const resDiario = await app.inject({
      method: 'GET',
      url: '/contabilidad/libro-diario',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    const libro = resDiario.json<AsientoContableDetalle[]>();
    const asiento = libro[0];
    expect(asiento).toBeDefined();

    // Intentar borrar directamente el asiento
    await expect(
      adminPool.query('delete from asiento_contable where id = $1', [asiento?.id]),
    ).rejects.toThrow(/Violación contable: los asientos del libro diario no pueden eliminarse/);

    // Intentar modificar el asiento
    await expect(
      adminPool.query("update asiento_contable set concepto = 'Modificado' where id = $1", [
        asiento?.id,
      ]),
    ).rejects.toThrow(/Violación contable: los asientos contables son inmutables/);

    // Intentar borrar o modificar un renglón
    await expect(
      adminPool.query('delete from renglon_asiento where asiento_id = $1', [asiento?.id]),
    ).rejects.toThrow(/Violación contable: los renglones de asientos no pueden eliminarse/);
  });

  it('7. RLS estricto: Negocio B no ve cuentas ni asientos del Negocio A', async () => {
    // Negocio B consulta su libro diario
    const resB = await app.inject({
      method: 'GET',
      url: '/contabilidad/libro-diario',
      headers: { authorization: `Bearer ${negocioB.tokenEncargado}` },
    });
    expect(resB.statusCode).toBe(200);
    const asientosB = resB.json<AsientoContableDetalle[]>();
    expect(asientosB).toHaveLength(0); // No ve los asientos de Negocio A

    // Negocio B consulta su sumas y saldos
    const resSumasB = await app.inject({
      method: 'GET',
      url: '/contabilidad/sumas-y-saldos',
      headers: { authorization: `Bearer ${negocioB.tokenEncargado}` },
    });
    expect(resSumasB.statusCode).toBe(200);
    const sumasB = resSumasB.json<ItemSumasYSaldos[]>();
    // Todas sus cuentas deben tener sumas en 0.00
    for (const item of sumasB) {
      expect(item.totalDebe).toBe('0.00');
      expect(item.totalHaber).toBe('0.00');
    }
  });

  it('8. Automatización de asientos contables por eventos de venta y egreso', async () => {
    // 1. Abrir un turno de caja
    const turnoRes = await app.inject({
      method: 'POST',
      url: '/turnos/abrir',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        id: randomUUID(),
        cajaId: negocioA.cajaId,
        efectivoInicial: '1000.00',
      },
    });
    expect(turnoRes.statusCode).toBe(201);
    const turno = turnoRes.json<{ turno: { id: string } }>();

    // Obtener medio de pago efectivo y categoría de egreso de negocioA
    const mediosRes = await adminPool.query<{ id: string }>(
      "select id from medio_pago where negocio_id = $1 and es_efectivo = true limit 1",
      [negocioA.negocioId]
    );
    const medioEfectivoId = mediosRes.rows[0]?.id;
    expect(medioEfectivoId).toBeDefined();

    const catRes = await adminPool.query<{ id: string }>(
      "select id from categoria where negocio_id = $1 and tipo = 'egreso' limit 1",
      [negocioA.negocioId]
    );
    const categoriaId = catRes.rows[0]?.id;

    // 2. Registrar una venta de mostrador
    const ventaId = randomUUID();
    const resVenta = await app.inject({
      method: 'POST',
      url: '/ventas',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        id: ventaId,
        turnoId: turno.turno.id,
        total: '2500.00',
        pagos: [
          {
            movimientoId: randomUUID(),
            medioPagoId: medioEfectivoId!,
            monto: '2500.00',
            descripcion: 'Venta de prueba para asiento contable',
          },
        ],
      },
    });
    expect(resVenta.statusCode).toBe(201);

    // 3. Registrar un egreso de caja
    const resEgreso = await app.inject({
      method: 'POST',
      url: '/movimientos/egreso',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        id: randomUUID(),
        turnoId: turno.turno.id,
        monto: '500.00',
        medioPagoId: medioEfectivoId!,
        categoriaId,
        descripcion: 'Compra de artículos de limpieza',
      },
    });
    expect(resEgreso.statusCode).toBe(201);

    // 4. Consultar libro diario y verificar asientos automáticos
    const resLibro = await app.inject({
      method: 'GET',
      url: '/contabilidad/libro-diario',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    expect(resLibro.statusCode).toBe(200);
    const libro = resLibro.json<AsientoContableDetalle[]>();

    const asientoVenta = libro.find((a) => a.origen === 'venta' && a.referenciaId === ventaId);
    expect(asientoVenta).toBeDefined();
    expect(asientoVenta?.cuadrado).toBe(true);
    expect(asientoVenta?.totalDebe).toBe('2500.00');
    expect(asientoVenta?.totalHaber).toBe('2500.00');

    const asientoEgreso = libro.find((a) => a.origen === 'egreso_caja');
    expect(asientoEgreso).toBeDefined();
    expect(asientoEgreso?.cuadrado).toBe(true);
    expect(asientoEgreso?.totalDebe).toBe('500.00');
    expect(asientoEgreso?.totalHaber).toBe('500.00');

    // 5. Verificar balance de sumas y saldos
    const resSumas = await app.inject({
      method: 'GET',
      url: '/contabilidad/sumas-y-saldos',
      headers: { authorization: `Bearer ${negocioA.tokenEncargado}` },
    });
    expect(resSumas.statusCode).toBe(200);
    const sumas = resSumas.json<ItemSumasYSaldos[]>();

    const cuentaCaja = sumas.find((s) => s.cuentaCodigo === '1.1.01');
    expect(cuentaCaja).toBeDefined();
    expect(parseFloat(cuentaCaja?.totalDebe ?? '0')).toBeGreaterThanOrEqual(2500);
    expect(parseFloat(cuentaCaja?.totalHaber ?? '0')).toBeGreaterThanOrEqual(500);
  });
});
