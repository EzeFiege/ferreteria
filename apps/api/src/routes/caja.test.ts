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

interface FixtureNegocio {
  negocioId: string;
  sucursalId: string;
  cajaId: string;
  cajeroId: string;
  encargadoId: string;
  tokenCajero: string;
  tokenEncargado: string;
  medioEfectivoId: string;
  medioTarjetaId: string;
  rubroHerramientasId: string;
  categoriaProveedoresId: string;
}

async function crearFixtureNegocio(
  pool: pg.Pool,
  nombreNegocio: string,
): Promise<FixtureNegocio> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role app_user');

    const negRes = await client.query<{ id: string }>(
      'insert into negocio (nombre) values ($1) returning id',
      [nombreNegocio],
    );
    const negocioId = negRes.rows[0]?.id;
    if (negocioId === undefined) {
      throw new Error('No se pudo crear el negocio de prueba');
    }

    await client.query("select set_config('app.negocio_id', $1, true)", [
      negocioId,
    ]);
    await client.query('select sembrar_negocio($1)', [negocioId]);

    const sucRes = await client.query<{ id: string }>(
      "insert into sucursal (negocio_id, nombre) values ($1, 'Casa Central') returning id",
      [negocioId],
    );
    const sucursalId = sucRes.rows[0]?.id ?? '';

    const cajaRes = await client.query<{ id: string }>(
      "insert into caja (negocio_id, sucursal_id, nombre) values ($1, $2, 'Caja Mostrador 1') returning id",
      [negocioId, sucursalId],
    );
    const cajaId = cajaRes.rows[0]?.id ?? '';

    const cajeroRes = await client.query<{ id: string }>(
      "insert into usuario (negocio_id, proveedor_uid, nombre, rol) values ($1, $2, 'Juan Cajero', 'cajero') returning id",
      [negocioId, `uid-cajero-${negocioId}`],
    );
    const cajeroId = cajeroRes.rows[0]?.id ?? '';

    const encargadoRes = await client.query<{ id: string }>(
      "insert into usuario (negocio_id, proveedor_uid, nombre, rol) values ($1, $2, 'Marta Encargada', 'encargado') returning id",
      [negocioId, `uid-encargado-${negocioId}`],
    );
    const encargadoId = encargadoRes.rows[0]?.id ?? '';

    const rubroRes = await client.query<{ id: string }>(
      "insert into rubro (negocio_id, nombre) values ($1, 'Herramientas') returning id",
      [negocioId],
    );
    const rubroHerramientasId = rubroRes.rows[0]?.id ?? '';

    const mediosRes = await client.query<{ id: string; nombre: string }>(
      'select id, nombre from medio_pago',
    );
    const medioEfectivoId =
      mediosRes.rows.find((m) => m.nombre === 'Efectivo')?.id ?? '';
    const medioTarjetaId =
      mediosRes.rows.find((m) => m.nombre === 'Tarjeta')?.id ?? '';

    const catRes = await client.query<{ id: string }>(
      "select id from categoria where nombre = 'Proveedores' and tipo = 'egreso'",
    );
    const categoriaProveedoresId = catRes.rows[0]?.id ?? '';

    await client.query('commit');

    return {
      negocioId,
      sucursalId,
      cajaId,
      cajeroId,
      encargadoId,
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
      medioEfectivoId,
      medioTarjetaId,
      rubroHerramientasId,
      categoriaProveedoresId,
    };
  } catch (err: unknown) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

describe('Etapa 1 — Núcleo de caja (API + PostgreSQL real)', () => {
  let dbHandle: TestDatabaseHandle;
  let pool: pg.Pool;
  let server: FastifyInstance;
  let norte: FixtureNegocio;
  let sur: FixtureNegocio;
  let turnoNorteId: string;
  let movVenta200Id: string;

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase();
    await runMigrations({
      connectionString: dbHandle.url,
      appUserPassword: 'app_test_password',
    });

    pool = new Pool({ connectionString: dbHandle.url });
    server = buildServer({ logger: false, pool });

    norte = await crearFixtureNegocio(pool, 'Ferretería Norte');
    sur = await crearFixtureNegocio(pool, 'Ferretería Sur');
  }, 60_000);

  afterAll(async () => {
    await server.close();
    await pool.end();
    await dbHandle.cleanup();
  });

  it('reproduce el caso del Excel: ventas por $2.600, $200 y $3.300 en efectivo y $4.700 en tarjeta -> efectivo esperado $6.100 y tarjeta no suma al cajón', async () => {
    // 1. Abrir turno con efectivo inicial $0.00
    const abrirRes = await server.inject({
      method: 'POST',
      url: '/turnos/abrir',
      headers: { authorization: `Bearer ${norte.tokenCajero}` },
      payload: {
        cajaId: norte.cajaId,
        efectivoInicial: '0.00',
      },
    });

    expect(abrirRes.statusCode).toBe(201);
    const abrirBody = abrirRes.json<{
      turno: { id: string; efectivoInicial: string };
      efectivoSugeridoUltimoCierre: string;
    }>();
    expect(abrirBody.turno.efectivoInicial).toBe('0.00');
    expect(abrirBody.efectivoSugeridoUltimoCierre).toBe('0.00');
    turnoNorteId = abrirBody.turno.id;

    // No se puede abrir un segundo turno simultáneo en la misma caja
    const abrirDuplicado = await server.inject({
      method: 'POST',
      url: '/turnos/abrir',
      headers: { authorization: `Bearer ${norte.tokenCajero}` },
      payload: {
        cajaId: norte.cajaId,
        efectivoInicial: '0.00',
      },
    });
    expect(abrirDuplicado.statusCode).toBe(409);

    // 2. Registrar las 3 ventas en efectivo ($2.600, $200, $3.300) y 1 en tarjeta ($4.700)
    const ventasExcel = [
      {
        id: randomUUID(),
        movimientoId: randomUUID(),
        medioPagoId: norte.medioEfectivoId,
        monto: '2600.00',
      },
      {
        id: randomUUID(),
        movimientoId: randomUUID(),
        medioPagoId: norte.medioEfectivoId,
        monto: '200.00',
      },
      {
        id: randomUUID(),
        movimientoId: randomUUID(),
        medioPagoId: norte.medioEfectivoId,
        monto: '3300.00',
      },
      {
        id: randomUUID(),
        movimientoId: randomUUID(),
        medioPagoId: norte.medioTarjetaId,
        monto: '4700.00',
      },
    ];

    movVenta200Id = ventasExcel[1]?.movimientoId ?? '';

    for (const v of ventasExcel) {
      const res = await server.inject({
        method: 'POST',
        url: '/ventas',
        headers: { authorization: `Bearer ${norte.tokenCajero}` },
        payload: {
          id: v.id,
          turnoId: turnoNorteId,
          total: v.monto,
          pagos: [
            {
              movimientoId: v.movimientoId,
              medioPagoId: v.medioPagoId,
              monto: v.monto,
              rubroId: norte.rubroHerramientasId,
            },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
    }

    // 3. Consultar resumen del turno
    const resumenRes = await server.inject({
      method: 'GET',
      url: `/turnos/${turnoNorteId}/resumen`,
      headers: { authorization: `Bearer ${norte.tokenCajero}` },
    });

    expect(resumenRes.statusCode).toBe(200);
    const body = resumenRes.json<{
      resumen: {
        efectivoInicial: string;
        entradasEfectivo: string;
        salidasEfectivo: string;
        efectivoEsperado: string;
      };
      ventasPorMedioRubro: Array<{
        medioPago: string;
        rubro: string;
        total: string;
      }>;
    }>();

    // $2.600 + $200 + $3.300 = $6.100 en el cajón; los $4.700 de tarjeta NO suman al cajón
    expect(body.resumen.efectivoInicial).toBe('0.00');
    expect(body.resumen.entradasEfectivo).toBe('6100.00');
    expect(body.resumen.salidasEfectivo).toBe('0.00');
    expect(body.resumen.efectivoEsperado).toBe('6100.00');

    expect(body.ventasPorMedioRubro).toEqual([
      {
        negocioId: norte.negocioId,
        turnoId: turnoNorteId,
        medioPago: 'Efectivo',
        rubro: 'Herramientas',
        total: '6100.00',
      },
      {
        negocioId: norte.negocioId,
        turnoId: turnoNorteId,
        medioPago: 'Tarjeta',
        rubro: 'Herramientas',
        total: '4700.00',
      },
    ]);
  });

  it('garantiza idempotencia al reintentar una venta o egreso con el mismo id', async () => {
    const ventaId = randomUUID();
    const movId = randomUUID();

    const payloadVenta = {
      id: ventaId,
      turnoId: turnoNorteId,
      total: '500.00',
      pagos: [
        {
          movimientoId: movId,
          medioPagoId: norte.medioEfectivoId,
          monto: '500.00',
          rubroId: norte.rubroHerramientasId,
        },
      ],
    };

    const intento1 = await server.inject({
      method: 'POST',
      url: '/ventas',
      headers: { authorization: `Bearer ${norte.tokenCajero}` },
      payload: payloadVenta,
    });
    expect(intento1.statusCode).toBe(201);
    expect(intento1.json<{ idempotente: boolean }>().idempotente).toBe(false);

    // Segundo intento con exactamente los mismos IDs (simula reintento offline)
    const intento2 = await server.inject({
      method: 'POST',
      url: '/ventas',
      headers: { authorization: `Bearer ${norte.tokenCajero}` },
      payload: payloadVenta,
    });
    expect(intento2.statusCode).toBe(200);
    expect(intento2.json<{ idempotente: boolean }>().idempotente).toBe(true);

    // El efectivo esperado subió una sola vez ($6.100 + $500 = $6.600)
    const resumenRes = await server.inject({
      method: 'GET',
      url: `/turnos/${turnoNorteId}/resumen`,
      headers: { authorization: `Bearer ${norte.tokenCajero}` },
    });
    expect(
      resumenRes.json<{ resumen: { efectivoEsperado: string } }>().resumen
        .efectivoEsperado,
    ).toBe('6600.00');
  });

  it('soporta venta con pago mixto (efectivo y tarjeta) sumando solo la parte en efectivo al cajón', async () => {
    const ventaMixtaId = randomUUID();
    const movEfectivoId = randomUUID();
    const movTarjetaId = randomUUID();

    const res = await server.inject({
      method: 'POST',
      url: '/ventas',
      headers: { authorization: `Bearer ${norte.tokenCajero}` },
      payload: {
        id: ventaMixtaId,
        turnoId: turnoNorteId,
        total: '1500.00',
        pagos: [
          {
            movimientoId: movEfectivoId,
            medioPagoId: norte.medioEfectivoId,
            monto: '400.00',
            rubroId: norte.rubroHerramientasId,
          },
          {
            movimientoId: movTarjetaId,
            medioPagoId: norte.medioTarjetaId,
            monto: '1100.00',
            rubroId: norte.rubroHerramientasId,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);

    // Efectivo esperado sube solo $400 ($6.600 -> $7.000)
    const resumenRes = await server.inject({
      method: 'GET',
      url: `/turnos/${turnoNorteId}/resumen`,
      headers: { authorization: `Bearer ${norte.tokenCajero}` },
    });
    const body = resumenRes.json<{
      resumen: { efectivoEsperado: string };
      ventasPorMedioRubro: Array<{ medioPago: string; total: string }>;
    }>();

    expect(body.resumen.efectivoEsperado).toBe('7000.00');
    expect(body.ventasPorMedioRubro).toEqual([
      expect.objectContaining({ medioPago: 'Efectivo', total: '7000.00' }),
      expect.objectContaining({ medioPago: 'Tarjeta', total: '5800.00' }),
    ]);
  });

  it('revierte un movimiento insertando un asiento inverso (revierte_id) sin borrar ni editar el original', async () => {
    const reversionId = randomUUID();

    // Un cajero no tiene permiso para revertir/anular (403)
    const intentoCajero = await server.inject({
      method: 'POST',
      url: `/movimientos/${movVenta200Id}/revertir`,
      headers: { authorization: `Bearer ${norte.tokenCajero}` },
      payload: { id: reversionId },
    });
    expect(intentoCajero.statusCode).toBe(403);

    // El encargado revierte el movimiento de $200 en efectivo
    const revRes = await server.inject({
      method: 'POST',
      url: `/movimientos/${movVenta200Id}/revertir`,
      headers: { authorization: `Bearer ${norte.tokenEncargado}` },
      payload: {
        id: reversionId,
        descripcion: 'Error de carga en venta de $200',
      },
    });

    expect(revRes.statusCode).toBe(201);
    const revBody = revRes.json<{
      movimiento: {
        id: string;
        tipo: string;
        sentido: string;
        monto: string;
        revierteId: string;
      };
    }>();

    expect(revBody.movimiento).toMatchObject({
      id: reversionId,
      tipo: 'venta',
      sentido: 'out',
      monto: '200.00',
      revierteId: movVenta200Id,
    });

    // Intentar revertir por segunda vez el mismo movimiento con otro ID falla (409)
    const segundaReversionDistintoId = await server.inject({
      method: 'POST',
      url: `/movimientos/${movVenta200Id}/revertir`,
      headers: { authorization: `Bearer ${norte.tokenEncargado}` },
      payload: { id: randomUUID() },
    });
    expect(segundaReversionDistintoId.statusCode).toBe(409);

    // El efectivo esperado baja $200 ($7.000 -> $6.800) y las ventas netas en efectivo también
    const resumenRes = await server.inject({
      method: 'GET',
      url: `/turnos/${turnoNorteId}/resumen`,
      headers: { authorization: `Bearer ${norte.tokenEncargado}` },
    });
    const resumenBody = resumenRes.json<{
      resumen: {
        entradasEfectivo: string;
        salidasEfectivo: string;
        efectivoEsperado: string;
      };
      ventasPorMedioRubro: Array<{ medioPago: string; total: string }>;
    }>();

    expect(resumenBody.resumen.entradasEfectivo).toBe('7000.00');
    expect(resumenBody.resumen.salidasEfectivo).toBe('200.00');
    expect(resumenBody.resumen.efectivoEsperado).toBe('6800.00');
    expect(resumenBody.ventasPorMedioRubro).toEqual([
      expect.objectContaining({ medioPago: 'Efectivo', total: '6800.00' }),
      expect.objectContaining({ medioPago: 'Tarjeta', total: '5800.00' }),
    ]);
  });

  it('impide trabajar sobre datos de otro negocio (aislamiento multi-negocio con RLS y FKs compuestas)', async () => {
    // 1. Ferretería Sur no puede ver el resumen del turno de Ferretería Norte
    const verAjeno = await server.inject({
      method: 'GET',
      url: `/turnos/${turnoNorteId}/resumen`,
      headers: { authorization: `Bearer ${sur.tokenEncargado}` },
    });
    expect(verAjeno.statusCode).toBe(404);

    // 2. Ferretería Sur no puede revertir un movimiento de Ferretería Norte
    const revertirAjeno = await server.inject({
      method: 'POST',
      url: `/movimientos/${movVenta200Id}/revertir`,
      headers: { authorization: `Bearer ${sur.tokenEncargado}` },
      payload: { id: randomUUID() },
    });
    expect(revertirAjeno.statusCode).toBe(404);

    // 3. Ferretería Sur no puede insertar una venta en el turno de Ferretería Norte
    const venderEnTurnoAjeno = await server.inject({
      method: 'POST',
      url: '/ventas',
      headers: { authorization: `Bearer ${sur.tokenCajero}` },
      payload: {
        id: randomUUID(),
        turnoId: turnoNorteId,
        total: '100.00',
        pagos: [
          {
            movimientoId: randomUUID(),
            medioPagoId: sur.medioEfectivoId,
            monto: '100.00',
          },
        ],
      },
    });
    expect(venderEnTurnoAjeno.statusCode).toBe(400);

    // 4. Ferretería Norte no puede usar un medio de pago perteneciente a Ferretería Sur
    const usarMedioAjeno = await server.inject({
      method: 'POST',
      url: '/movimientos/egreso',
      headers: { authorization: `Bearer ${norte.tokenCajero}` },
      payload: {
        id: randomUUID(),
        turnoId: turnoNorteId,
        medioPagoId: sur.medioEfectivoId,
        monto: '100.00',
      },
    });
    expect(usarMedioAjeno.statusCode).toBe(400);
  });

  it('registra egreso, cierra el turno con arqueo, rechaza movimientos en turno cerrado y sugiere el efectivo contado al abrir el siguiente turno', async () => {
    // 1. Registrar egreso de $300 en efectivo ($6.800 -> $6.500 esperados)
    const egresoRes = await server.inject({
      method: 'POST',
      url: '/movimientos/egreso',
      headers: { authorization: `Bearer ${norte.tokenCajero}` },
      payload: {
        id: randomUUID(),
        turnoId: turnoNorteId,
        medioPagoId: norte.medioEfectivoId,
        categoriaId: norte.categoriaProveedoresId,
        monto: '300.00',
        descripcion: 'Pago flete tornillos',
      },
    });
    expect(egresoRes.statusCode).toBe(201);

    // 2. Cerrar turno con arqueo ($6.450 contados vs $6.500 esperados -> diferencia -$50.00)
    const cerrarRes = await server.inject({
      method: 'POST',
      url: `/turnos/${turnoNorteId}/cerrar`,
      headers: { authorization: `Bearer ${norte.tokenEncargado}` },
      payload: {
        efectivoContado: '6450.00',
        notas: 'Faltante de $50 en cambio chico',
      },
    });
    expect(cerrarRes.statusCode).toBe(200);
    expect(cerrarRes.json()).toMatchObject({
      turnoId: turnoNorteId,
      efectivoInicial: '0.00',
      entradasEfectivo: '7000.00',
      salidasEfectivo: '500.00',
      efectivoEsperado: '6500.00',
      efectivoContado: '6450.00',
      diferencia: '-50.00',
    });

    // 3. Intentar insertar una venta o un egreso en el turno ya cerrado falla (409)
    const ventaEnTurnoCerrado = await server.inject({
      method: 'POST',
      url: '/ventas',
      headers: { authorization: `Bearer ${norte.tokenCajero}` },
      payload: {
        id: randomUUID(),
        turnoId: turnoNorteId,
        total: '100.00',
        pagos: [
          {
            movimientoId: randomUUID(),
            medioPagoId: norte.medioEfectivoId,
            monto: '100.00',
          },
        ],
      },
    });
    expect(ventaEnTurnoCerrado.statusCode).toBe(409);

    const egresoEnTurnoCerrado = await server.inject({
      method: 'POST',
      url: '/movimientos/egreso',
      headers: { authorization: `Bearer ${norte.tokenCajero}` },
      payload: {
        id: randomUUID(),
        turnoId: turnoNorteId,
        medioPagoId: norte.medioEfectivoId,
        monto: '50.00',
      },
    });
    expect(egresoEnTurnoCerrado.statusCode).toBe(409);

    // 4. El siguiente turno sugiere y toma el efectivo contado del último cierre ($6.450,00)
    const sugerenciaRes = await server.inject({
      method: 'GET',
      url: `/cajas/${norte.cajaId}/sugerencia-apertura`,
      headers: { authorization: `Bearer ${norte.tokenCajero}` },
    });
    expect(sugerenciaRes.statusCode).toBe(200);
    expect(sugerenciaRes.json()).toEqual({
      cajaId: norte.cajaId,
      efectivoSugerido: '6450.00',
      ultimoTurnoCerradoId: turnoNorteId,
    });

    const nuevoTurnoRes = await server.inject({
      method: 'POST',
      url: '/turnos/abrir',
      headers: { authorization: `Bearer ${norte.tokenCajero}` },
      payload: {
        cajaId: norte.cajaId,
      },
    });
    expect(nuevoTurnoRes.statusCode).toBe(201);
    expect(
      nuevoTurnoRes.json<{
        turno: { efectivoInicial: string };
        efectivoSugeridoUltimoCierre: string;
      }>(),
    ).toMatchObject({
      turno: { efectivoInicial: '6450.00' },
      efectivoSugeridoUltimoCierre: '6450.00',
    });
  });
});
