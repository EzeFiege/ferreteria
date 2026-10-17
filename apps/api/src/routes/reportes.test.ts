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

describe('Etapa 3 — Reportes del día e historial de turnos (PostgreSQL real)', () => {
  let dbHandle: TestDatabaseHandle;
  let pool: pg.Pool;
  let server: FastifyInstance;

  let negocioId: string;
  let caja1Id: string;
  let caja2Id: string;
  let cajero1Id: string;
  let cajero2Id: string;
  let tokenCajero1: string;
  let tokenCajero2: string;
  let tokenEncargado: string;
  let tokenOtroNegocioEncargado: string;

  let medioEfectivoId: string;
  let medioTarjetaId: string;
  let medioTransferenciaId: string;
  let rubroHerramientasId: string;
  let rubroElectricidadId: string;
  let categoriaProveedoresId: string;

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase();
    await runMigrations({
      connectionString: dbHandle.url,
      appUserPassword: 'app_test_password',
    });

    pool = new Pool({ connectionString: dbHandle.url });
    server = buildServer({ logger: false, pool });

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role app_user');

      // Negocio principal
      const negRes = await client.query<{ id: string }>(
        "insert into negocio (nombre) values ('Ferretería Reportes') returning id",
      );
      negocioId = negRes.rows[0]?.id ?? '';

      await client.query("select set_config('app.negocio_id', $1, true)", [
        negocioId,
      ]);
      await client.query('select sembrar_negocio($1)', [negocioId]);

      const sucRes = await client.query<{ id: string }>(
        "insert into sucursal (negocio_id, nombre) values ($1, 'Sucursal Centro') returning id",
        [negocioId],
      );
      const sucursalId = sucRes.rows[0]?.id ?? '';

      const c1Res = await client.query<{ id: string }>(
        "insert into caja (negocio_id, sucursal_id, nombre) values ($1, $2, 'Caja 1') returning id",
        [negocioId, sucursalId],
      );
      caja1Id = c1Res.rows[0]?.id ?? '';

      const c2Res = await client.query<{ id: string }>(
        "insert into caja (negocio_id, sucursal_id, nombre) values ($1, $2, 'Caja 2') returning id",
        [negocioId, sucursalId],
      );
      caja2Id = c2Res.rows[0]?.id ?? '';

      const u1Res = await client.query<{ id: string }>(
        "insert into usuario (negocio_id, proveedor_uid, nombre, rol) values ($1, 'uid-caj-1', 'Juan Cajero', 'cajero') returning id",
        [negocioId],
      );
      cajero1Id = u1Res.rows[0]?.id ?? '';

      const u2Res = await client.query<{ id: string }>(
        "insert into usuario (negocio_id, proveedor_uid, nombre, rol) values ($1, 'uid-caj-2', 'Pedro Cajero', 'cajero') returning id",
        [negocioId],
      );
      cajero2Id = u2Res.rows[0]?.id ?? '';

      const encRes = await client.query<{ id: string }>(
        "insert into usuario (negocio_id, proveedor_uid, nombre, rol) values ($1, 'uid-enc-1', 'Marta Encargada', 'encargado') returning id",
        [negocioId],
      );
      const encargadoId = encRes.rows[0]?.id ?? '';

      tokenCajero1 = createAuthToken({
        negocio_id: negocioId,
        usuario_id: cajero1Id,
        rol: 'cajero',
      });
      tokenCajero2 = createAuthToken({
        negocio_id: negocioId,
        usuario_id: cajero2Id,
        rol: 'cajero',
      });
      tokenEncargado = createAuthToken({
        negocio_id: negocioId,
        usuario_id: encargadoId,
        rol: 'encargado',
      });

      const r1Res = await client.query<{ id: string }>(
        "insert into rubro (negocio_id, nombre) values ($1, 'Herramientas') returning id",
        [negocioId],
      );
      rubroHerramientasId = r1Res.rows[0]?.id ?? '';

      const r2Res = await client.query<{ id: string }>(
        "insert into rubro (negocio_id, nombre) values ($1, 'Electricidad') returning id",
        [negocioId],
      );
      rubroElectricidadId = r2Res.rows[0]?.id ?? '';

      const mediosRes = await client.query<{ id: string; nombre: string }>(
        'select id, nombre from medio_pago',
      );
      medioEfectivoId =
        mediosRes.rows.find((m) => m.nombre === 'Efectivo')?.id ?? '';
      medioTarjetaId =
        mediosRes.rows.find((m) => m.nombre === 'Tarjeta')?.id ?? '';
      medioTransferenciaId =
        mediosRes.rows.find((m) => m.nombre === 'Transferencia/QR')?.id ?? '';

      const catRes = await client.query<{ id: string }>(
        "select id from categoria where nombre = 'Proveedores' and tipo = 'egreso'",
      );
      categoriaProveedoresId = catRes.rows[0]?.id ?? '';

      // Segundo negocio para verificar aislamiento en reportes
      const otroNegRes = await client.query<{ id: string }>(
        "insert into negocio (nombre) values ('Otro Negocio') returning id",
      );
      const otroNegocioId = otroNegRes.rows[0]?.id ?? '';
      await client.query("select set_config('app.negocio_id', $1, true)", [
        otroNegocioId,
      ]);
      const otroEncRes = await client.query<{ id: string }>(
        "insert into usuario (negocio_id, proveedor_uid, nombre, rol) values ($1, 'uid-otro-enc', 'Encargado Ajeno', 'encargado') returning id",
        [otroNegocioId],
      );
      tokenOtroNegocioEncargado = createAuthToken({
        negocio_id: otroNegocioId,
        usuario_id: otroEncRes.rows[0]?.id ?? '',
        rol: 'encargado',
      });

      await client.query('commit');
    } catch (err: unknown) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }, 60_000);

  afterAll(async () => {
    await server.close();
    await pool.end();
    await dbHandle.cleanup();
  });

  it('carga un día completo y comprueba que el reporte diario coincide con el cálculo manual de efectivo, tarjeta y transferencias', async () => {
    // Turno 1 en Caja 1 (Juan Cajero): efectivo inicial $0,00
    const t1Res = await server.inject({
      method: 'POST',
      url: '/turnos/abrir',
      headers: { authorization: `Bearer ${tokenCajero1}` },
      payload: { cajaId: caja1Id, efectivoInicial: '0.00' },
    });
    expect(t1Res.statusCode).toBe(201);
    const turno1Id = t1Res.json<{ turno: { id: string } }>().turno.id;

    // Ventas Turno 1: $2.600, $200 y $3.300 en Efectivo ($6.100) + $4.700 en Tarjeta
    const ventasTurno1 = [
      {
        monto: '2600.00',
        medioPagoId: medioEfectivoId,
        rubroId: rubroHerramientasId,
      },
      {
        monto: '200.00',
        medioPagoId: medioEfectivoId,
        rubroId: rubroElectricidadId,
      },
      {
        monto: '3300.00',
        medioPagoId: medioEfectivoId,
        rubroId: rubroHerramientasId,
      },
      {
        monto: '4700.00',
        medioPagoId: medioTarjetaId,
        rubroId: rubroHerramientasId,
      },
    ];

    for (const v of ventasTurno1) {
      const res = await server.inject({
        method: 'POST',
        url: '/ventas',
        headers: { authorization: `Bearer ${tokenCajero1}` },
        payload: {
          id: randomUUID(),
          turnoId: turno1Id,
          total: v.monto,
          pagos: [
            {
              movimientoId: randomUUID(),
              medioPagoId: v.medioPagoId,
              monto: v.monto,
              rubroId: v.rubroId,
            },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
    }

    // Egreso en Turno 1: $300 en Efectivo (Proveedores) -> Efectivo esperado Turno 1 = $5.800,00
    const egRes = await server.inject({
      method: 'POST',
      url: '/movimientos/egreso',
      headers: { authorization: `Bearer ${tokenCajero1}` },
      payload: {
        id: randomUUID(),
        turnoId: turno1Id,
        medioPagoId: medioEfectivoId,
        categoriaId: categoriaProveedoresId,
        monto: '300.00',
        descripcion: 'Flete mercadería',
      },
    });
    expect(egRes.statusCode).toBe(201);

    // Cerrar Turno 1 con $5.750,00 contados (diferencia -$50,00)
    const cerrar1 = await server.inject({
      method: 'POST',
      url: `/turnos/${turno1Id}/cerrar`,
      headers: { authorization: `Bearer ${tokenEncargado}` },
      payload: { efectivoContado: '5750.00', notas: 'Faltante $50' },
    });
    expect(cerrar1.statusCode).toBe(200);

    // Turno 2 en Caja 2 (Pedro Cajero): efectivo inicial $1.000,00 + venta Transferencia/QR por $1.850,00
    const t2Res = await server.inject({
      method: 'POST',
      url: '/turnos/abrir',
      headers: { authorization: `Bearer ${tokenCajero2}` },
      payload: { cajaId: caja2Id, efectivoInicial: '1000.00' },
    });
    expect(t2Res.statusCode).toBe(201);
    const turno2Id = t2Res.json<{ turno: { id: string } }>().turno.id;

    const vTransf = await server.inject({
      method: 'POST',
      url: '/ventas',
      headers: { authorization: `Bearer ${tokenCajero2}` },
      payload: {
        id: randomUUID(),
        turnoId: turno2Id,
        total: '1850.00',
        pagos: [
          {
            movimientoId: randomUUID(),
            medioPagoId: medioTransferenciaId,
            monto: '1850.00',
            rubroId: rubroElectricidadId,
          },
        ],
      },
    });
    expect(vTransf.statusCode).toBe(201);

    // Cerrar Turno 2 con $1.020,00 contados (esperado $1.000,00 -> sobrante +$20,00)
    const cerrar2 = await server.inject({
      method: 'POST',
      url: `/turnos/${turno2Id}/cerrar`,
      headers: { authorization: `Bearer ${tokenEncargado}` },
      payload: { efectivoContado: '1020.00', notas: 'Sobrante $20' },
    });
    expect(cerrar2.statusCode).toBe(200);

    // Un cajero no tiene permiso para consultar los reportes globales (403)
    const accesoCajero = await server.inject({
      method: 'GET',
      url: '/reportes/dia',
      headers: { authorization: `Bearer ${tokenCajero1}` },
    });
    expect(accesoCajero.statusCode).toBe(403);

    // Consultar reporte del día como encargado
    const repDiaRes = await server.inject({
      method: 'GET',
      url: '/reportes/dia',
      headers: { authorization: `Bearer ${tokenEncargado}` },
    });
    expect(repDiaRes.statusCode).toBe(200);

    const repDia = repDiaRes.json<{
      cantidadTurnos: number;
      totalVentasDia: string;
      totalesPorMedio: Array<{ medioPago: string; total: string }>;
      ventasPorMedioRubro: Array<{
        medioPago: string;
        rubro: string;
        total: string;
      }>;
      totalEgresosDia: string;
      egresosPorCategoria: Array<{
        categoria: string;
        medioPago: string;
        total: string;
      }>;
      resumenCaja: {
        efectivoInicial: string;
        entradasEfectivo: string;
        salidasEfectivo: string;
        efectivoEsperado: string;
        efectivoContado: string;
        diferenciaArqueo: string;
      };
    }>();

    // Verificación contra cálculo manual:
    // Efectivo: $6.100,00 | Tarjeta: $4.700,00 | Transferencia/QR: $1.850,00 | Total ventas: $12.650,00
    expect(repDia.cantidadTurnos).toBe(2);
    expect(repDia.totalVentasDia).toBe('12650.00');
    expect(repDia.totalesPorMedio).toEqual([
      { medioPago: 'Efectivo', total: '6100.00' },
      { medioPago: 'Tarjeta', total: '4700.00' },
      { medioPago: 'Transferencia/QR', total: '1850.00' },
    ]);

    expect(repDia.ventasPorMedioRubro).toEqual([
      { medioPago: 'Efectivo', rubro: 'Electricidad', total: '200.00' },
      { medioPago: 'Efectivo', rubro: 'Herramientas', total: '5900.00' },
      { medioPago: 'Tarjeta', rubro: 'Herramientas', total: '4700.00' },
      { medioPago: 'Transferencia/QR', rubro: 'Electricidad', total: '1850.00' },
    ]);

    expect(repDia.totalEgresosDia).toBe('300.00');
    expect(repDia.egresosPorCategoria).toEqual([
      { categoria: 'Proveedores', medioPago: 'Efectivo', total: '300.00' },
    ]);

    expect(repDia.resumenCaja).toEqual({
      efectivoInicial: '1000.00',
      entradasEfectivo: '6100.00',
      salidasEfectivo: '300.00',
      efectivoEsperado: '6800.00',
      efectivoContado: '6770.00',
      diferenciaArqueo: '-30.00',
    });
  });

  it('filtra el historial de turnos por fecha, caja y cajero, calcula diferencias por cajero y aísla entre negocios', async () => {
    // 1. Sin filtros: devuelve los 2 turnos y las diferencias por cada cajero
    const histTotalRes = await server.inject({
      method: 'GET',
      url: '/reportes/historial-turnos',
      headers: { authorization: `Bearer ${tokenEncargado}` },
    });
    expect(histTotalRes.statusCode).toBe(200);
    const histTotal = histTotalRes.json<{
      turnos: Array<{ cajaId: string; cajeroId: string; diferencia: string }>;
      diferenciasPorCajero: Array<{
        cajeroId: string;
        cajeroNombre: string;
        diferenciaAcumulada: string;
      }>;
    }>();

    expect(histTotal.turnos.length).toBe(2);
    expect(histTotal.diferenciasPorCajero).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cajeroId: cajero1Id,
          cajeroNombre: 'Juan Cajero',
          diferenciaAcumulada: '-50.00',
        }),
        expect.objectContaining({
          cajeroId: cajero2Id,
          cajeroNombre: 'Pedro Cajero',
          diferenciaAcumulada: '20.00',
        }),
      ]),
    );

    // 2. Filtro por cajaId (Caja 1)
    const porCajaRes = await server.inject({
      method: 'GET',
      url: `/reportes/historial-turnos?cajaId=${caja1Id}`,
      headers: { authorization: `Bearer ${tokenEncargado}` },
    });
    expect(porCajaRes.statusCode).toBe(200);
    const porCaja = porCajaRes.json<{
      turnos: Array<{ cajaId: string }>;
    }>();
    expect(porCaja.turnos.length).toBe(1);
    expect(porCaja.turnos[0]?.cajaId).toBe(caja1Id);

    // 3. Filtro por cajeroId (Pedro Cajero)
    const porCajeroRes = await server.inject({
      method: 'GET',
      url: `/reportes/historial-turnos?cajeroId=${cajero2Id}`,
      headers: { authorization: `Bearer ${tokenEncargado}` },
    });
    expect(porCajeroRes.statusCode).toBe(200);
    const porCajero = porCajeroRes.json<{
      turnos: Array<{ cajeroId: string; diferencia: string }>;
    }>();
    expect(porCajero.turnos.length).toBe(1);
    expect(porCajero.turnos[0]?.cajeroId).toBe(cajero2Id);
    expect(porCajero.turnos[0]?.diferencia).toBe('20.00');

    // 4. Filtro por rango de fechas pasado sin actividad
    const porFechaVacia = await server.inject({
      method: 'GET',
      url: '/reportes/historial-turnos?fechaDesde=2020-01-01&fechaHasta=2020-01-31',
      headers: { authorization: `Bearer ${tokenEncargado}` },
    });
    expect(porFechaVacia.statusCode).toBe(200);
    expect(
      porFechaVacia.json<{ turnos: unknown[] }>().turnos.length,
    ).toBe(0);

    // 5. Otro negocio no ve ningún turno ni venta del negocio principal
    const otroNegRes = await server.inject({
      method: 'GET',
      url: '/reportes/historial-turnos',
      headers: { authorization: `Bearer ${tokenOtroNegocioEncargado}` },
    });
    expect(otroNegRes.statusCode).toBe(200);
    expect(otroNegRes.json<{ turnos: unknown[] }>().turnos).toEqual([]);
  });
});
