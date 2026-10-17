import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import {
  aCentavos,
  deCentavos,
  filtroReporteDiaSchema,
  filtrosHistorialTurnosSchema,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';

// TODO(definir): No construir el importador de planillas históricas hasta que exista una planilla real de la ferretería para tomar como muestra (Etapa 3).

export interface ReportesRoutesOptions {
  pool: pg.Pool;
  verifyToken?: TokenVerifier | undefined;
}

interface TurnoHistorialRow {
  turno_id: string;
  negocio_id: string;
  caja_id: string;
  caja_nombre: string;
  cajero_id: string;
  cajero_nombre: string;
  cerrado_por_id: string | null;
  cerrado_por_nombre: string | null;
  abre_en: Date;
  cierra_en: Date | null;
  efectivo_inicial: string;
  entradas_efectivo: string;
  salidas_efectivo: string;
  efectivo_esperado: string;
  efectivo_contado: string | null;
  diferencia: string | null;
  notas: string | null;
}

interface VentaMedioRubroRow {
  turno_id: string;
  medio_pago: string;
  rubro: string;
  total: string;
}

interface EgresoCategoriaRow {
  categoria: string;
  medio_pago: string;
  total: string;
}

function normalizarMonto(monto: string): string {
  return deCentavos(aCentavos(monto));
}

function handleReportError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (err instanceof AuthError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: 'Filtros de reporte inválidos',
      detalles: err.issues,
    });
  }
  request.log.error({ err }, 'Error inesperado en ruta de reportes');
  return reply.code(500).send({ error: 'Error interno del servidor' });
}

export function registerReportesRoutes(
  app: FastifyInstance,
  options: ReportesRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Historial de turnos con filtros por fecha, caja y cajero + diferencias acumuladas por cajero
  app.get('/reportes/historial-turnos', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const rawQuery = (request.query ?? {}) as Record<string, unknown>;
      const queryLimpia = Object.fromEntries(
        Object.entries(rawQuery).filter(
          ([, v]) => v !== undefined && v !== '',
        ),
      );
      const filtros = filtrosHistorialTurnosSchema.parse(queryLimpia);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const turnosRes = await client.query<TurnoHistorialRow>(
            `
            select
              r.turno_id,
              r.negocio_id,
              r.caja_id,
              c.nombre as caja_nombre,
              t.abierto_por as cajero_id,
              u_abre.nombre as cajero_nombre,
              t.cerrado_por as cerrado_por_id,
              u_cierra.nombre as cerrado_por_nombre,
              r.abre_en,
              r.cierra_en,
              r.efectivo_inicial,
              r.entradas_efectivo,
              r.salidas_efectivo,
              r.efectivo_esperado,
              r.efectivo_contado,
              r.diferencia,
              t.notas
            from v_resumen_turno r
            join turno_caja t on t.id = r.turno_id
            join caja c on c.id = r.caja_id
            join usuario u_abre on u_abre.id = t.abierto_por
            left join usuario u_cierra on u_cierra.id = t.cerrado_por
            where ($1::date is null or (r.abre_en at time zone 'America/Argentina/Buenos_Aires')::date >= $1::date)
              and ($2::date is null or (r.abre_en at time zone 'America/Argentina/Buenos_Aires')::date <= $2::date)
              and ($3::uuid is null or r.caja_id = $3::uuid)
              and ($4::uuid is null or t.abierto_por = $4::uuid)
            order by r.abre_en desc
            `,
            [
              filtros.fechaDesde ?? null,
              filtros.fechaHasta ?? null,
              filtros.cajaId ?? null,
              filtros.cajeroId ?? null,
            ],
          );

          const turnoIds = turnosRes.rows.map((r) => r.turno_id);
          const ventasPorTurnoMap = new Map<
            string,
            Array<{ medioPago: string; rubro: string; total: string }>
          >();

          if (turnoIds.length > 0) {
            const ventasRes = await client.query<VentaMedioRubroRow>(
              `
              select turno_id, medio_pago, rubro, total
              from v_ventas_por_medio_rubro
              where turno_id = any($1::uuid[])
              order by medio_pago asc, rubro asc
              `,
              [turnoIds],
            );

            for (const row of ventasRes.rows) {
              const lista = ventasPorTurnoMap.get(row.turno_id) ?? [];
              lista.push({
                medioPago: row.medio_pago,
                rubro: row.rubro,
                total: normalizarMonto(row.total),
              });
              ventasPorTurnoMap.set(row.turno_id, lista);
            }
          }

          const turnos = turnosRes.rows.map((row) => ({
            turnoId: row.turno_id,
            negocioId: row.negocio_id,
            cajaId: row.caja_id,
            cajaNombre: row.caja_nombre,
            cajeroId: row.cajero_id,
            cajeroNombre: row.cajero_nombre,
            cerradoPorId: row.cerrado_por_id,
            cerradoPorNombre: row.cerrado_por_nombre,
            abreEn: row.abre_en,
            cierraEn: row.cierra_en,
            efectivoInicial: normalizarMonto(row.efectivo_inicial),
            entradasEfectivo: normalizarMonto(row.entradas_efectivo),
            salidasEfectivo: normalizarMonto(row.salidas_efectivo),
            efectivoEsperado: normalizarMonto(row.efectivo_esperado),
            efectivoContado:
              row.efectivo_contado !== null
                ? normalizarMonto(row.efectivo_contado)
                : null,
            diferencia:
              row.diferencia !== null ? normalizarMonto(row.diferencia) : null,
            notas: row.notas,
            ventasPorMedioRubro: ventasPorTurnoMap.get(row.turno_id) ?? [],
          }));

          // Resumen de diferencias de arqueo agrupadas por cajero (usando centavos enteros bigint)
          const cajerosMap = new Map<
            string,
            {
              cajeroId: string;
              cajeroNombre: string;
              cantidadTurnos: number;
              turnosCerrados: number;
              diferenciaCentavos: bigint;
            }
          >();

          for (const t of turnos) {
            const actual = cajerosMap.get(t.cajeroId) ?? {
              cajeroId: t.cajeroId,
              cajeroNombre: t.cajeroNombre,
              cantidadTurnos: 0,
              turnosCerrados: 0,
              diferenciaCentavos: 0n,
            };
            actual.cantidadTurnos += 1;
            if (t.diferencia !== null) {
              actual.turnosCerrados += 1;
              actual.diferenciaCentavos += aCentavos(t.diferencia);
            }
            cajerosMap.set(t.cajeroId, actual);
          }

          const diferenciasPorCajero = Array.from(cajerosMap.values()).map(
            (c) => ({
              cajeroId: c.cajeroId,
              cajeroNombre: c.cajeroNombre,
              cantidadTurnos: c.cantidadTurnos,
              turnosCerrados: c.turnosCerrados,
              diferenciaAcumulada: deCentavos(c.diferenciaCentavos),
            }),
          );

          return {
            turnos,
            diferenciasPorCajero,
          };
        },
      );

      return await reply.code(200).send(resultado);
    } catch (err: unknown) {
      return handleReportError(err, request, reply);
    }
  });

  // 2. Reporte consolidado del día (vistas v_resumen_turno y v_ventas_por_medio_rubro + egresos)
  app.get('/reportes/dia', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const rawQuery = (request.query ?? {}) as Record<string, unknown>;
      const queryLimpia = Object.fromEntries(
        Object.entries(rawQuery).filter(
          ([, v]) => v !== undefined && v !== '',
        ),
      );
      const filtros = filtroReporteDiaSchema.parse(queryLimpia);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const fechaRes = await client.query<{ fecha_consulta: string }>(
            `select coalesce($1::date, (now() at time zone 'America/Argentina/Buenos_Aires')::date)::text as fecha_consulta`,
            [filtros.fecha ?? null],
          );
          const fechaConsulta = fechaRes.rows[0]?.fecha_consulta ?? '';

          const turnosDiaRes = await client.query<{
            turno_id: string;
            efectivo_inicial: string;
            entradas_efectivo: string;
            salidas_efectivo: string;
            efectivo_esperado: string;
            efectivo_contado: string | null;
            diferencia: string | null;
          }>(
            `
            select
              r.turno_id,
              r.efectivo_inicial,
              r.entradas_efectivo,
              r.salidas_efectivo,
              r.efectivo_esperado,
              r.efectivo_contado,
              r.diferencia
            from v_resumen_turno r
            where (r.abre_en at time zone 'America/Argentina/Buenos_Aires')::date = $1::date
              and ($2::uuid is null or r.caja_id = $2::uuid)
            order by r.abre_en asc
            `,
            [fechaConsulta, filtros.cajaId ?? null],
          );

          const turnoIds = turnosDiaRes.rows.map((r) => r.turno_id);

          let efectivoInicialCentavos = 0n;
          let entradasEfectivoCentavos = 0n;
          let salidasEfectivoCentavos = 0n;
          let efectivoEsperadoCentavos = 0n;
          let efectivoContadoCentavos = 0n;
          let diferenciaCentavos = 0n;

          for (const t of turnosDiaRes.rows) {
            efectivoInicialCentavos += aCentavos(t.efectivo_inicial);
            entradasEfectivoCentavos += aCentavos(t.entradas_efectivo);
            salidasEfectivoCentavos += aCentavos(t.salidas_efectivo);
            efectivoEsperadoCentavos += aCentavos(t.efectivo_esperado);
            if (t.efectivo_contado !== null) {
              efectivoContadoCentavos += aCentavos(t.efectivo_contado);
            }
            if (t.diferencia !== null) {
              diferenciaCentavos += aCentavos(t.diferencia);
            }
          }

          const ventasMedioRubroRes =
            turnoIds.length > 0
              ? await client.query<{
                  medio_pago: string;
                  rubro: string;
                  total: string;
                }>(
                  `
                  select
                    medio_pago,
                    rubro,
                    sum(total)::text as total
                  from v_ventas_por_medio_rubro
                  where turno_id = any($1::uuid[])
                  group by medio_pago, rubro
                  order by medio_pago asc, rubro asc
                  `,
                  [turnoIds],
                )
              : { rows: [] };

          const ventasPorMedioRubro = ventasMedioRubroRes.rows.map((r) => ({
            medioPago: r.medio_pago,
            rubro: r.rubro,
            total: normalizarMonto(r.total),
          }));

          // Totales netos por medio de cobro (Efectivo, Tarjeta, Transferencia/QR, etc.)
          const totalesPorMedioMap = new Map<string, bigint>();
          let totalVentasDiaCentavos = 0n;
          for (const item of ventasPorMedioRubro) {
            const montoCts = aCentavos(item.total);
            totalesPorMedioMap.set(
              item.medioPago,
              (totalesPorMedioMap.get(item.medioPago) ?? 0n) + montoCts,
            );
            totalVentasDiaCentavos += montoCts;
          }

          const totalesPorMedio = Array.from(totalesPorMedioMap.entries()).map(
            ([medioPago, centavos]) => ({
              medioPago,
              total: deCentavos(centavos),
            }),
          );

          // Egresos netos del día agrupados por categoría y medio de pago
          const egresosRes =
            turnoIds.length > 0
              ? await client.query<EgresoCategoriaRow>(
                  `
                  select
                    coalesce(c.nombre, 'Sin categoría') as categoria,
                    mp.nombre as medio_pago,
                    sum(case m.sentido when 'out' then m.monto else -m.monto end)::text as total
                  from movimiento m
                  join medio_pago mp on mp.id = m.medio_pago_id
                  left join categoria c on c.id = m.categoria_id
                  where m.turno_id = any($1::uuid[])
                    and m.tipo = 'egreso'
                  group by c.nombre, mp.nombre
                  order by categoria asc, medio_pago asc
                  `,
                  [turnoIds],
                )
              : { rows: [] };

          let totalEgresosDiaCentavos = 0n;
          const egresosPorCategoria = egresosRes.rows.map((r) => {
            const cts = aCentavos(r.total);
            totalEgresosDiaCentavos += cts;
            return {
              categoria: r.categoria,
              medioPago: r.medio_pago,
              total: deCentavos(cts),
            };
          });

          return {
            fecha: fechaConsulta,
            cantidadTurnos: turnoIds.length,
            resumenCaja: {
              efectivoInicial: deCentavos(efectivoInicialCentavos),
              entradasEfectivo: deCentavos(entradasEfectivoCentavos),
              salidasEfectivo: deCentavos(salidasEfectivoCentavos),
              efectivoEsperado: deCentavos(efectivoEsperadoCentavos),
              efectivoContado: deCentavos(efectivoContadoCentavos),
              diferenciaArqueo: deCentavos(diferenciaCentavos),
            },
            totalVentasDia: deCentavos(totalVentasDiaCentavos),
            totalesPorMedio,
            ventasPorMedioRubro,
            totalEgresosDia: deCentavos(totalEgresosDiaCentavos),
            egresosPorCategoria,
          };
        },
      );

      return await reply.code(200).send(resultado);
    } catch (err: unknown) {
      return handleReportError(err, request, reply);
    }
  });
}
