import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import {
  crearAsientoManualSchema,
  crearEjercicioContableSchema,
  guardarCuentaContableSchema,
  type AsientoContableDetalle,
  type EjercicioContableItem,
  type ItemSumasYSaldos,
  type OrigenAsiento,
  type RenglonAsientoDetalle,
  type TipoCuentaContable,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';
import { cuentaContable } from '../db/schema.js';
import { registrarAuditoria } from '../services/auditoria-service.js';

export interface ContabilidadRoutesOptions extends FastifyPluginOptions {
  pool: Pool;
  verifyToken?: TokenVerifier | undefined;
}

interface LibroDiarioRow {
  negocio_id: string;
  asiento_id: string;
  asiento_numero: number;
  asiento_fecha: Date;
  asiento_concepto: string;
  asiento_origen: OrigenAsiento;
  asiento_referencia_id: string | null;
  asiento_creado_por: string | null;
  renglon_id: string;
  cuenta_id: string;
  cuenta_codigo: string;
  cuenta_nombre: string;
  cuenta_tipo: TipoCuentaContable;
  debe: string;
  haber: string;
  renglon_descripcion: string | null;
}

interface SumasYSaldosRow {
  cuenta_id: string;
  cuenta_codigo: string;
  cuenta_nombre: string;
  cuenta_tipo: TipoCuentaContable;
  cuenta_activa: boolean;
  total_debe: string;
  total_haber: string;
  saldo_deudor: string;
  saldo_acreedor: string;
}

interface CuentaRow {
  id: string;
  negocio_id: string;
  codigo: string;
  nombre: string;
  tipo: TipoCuentaContable;
  descripcion: string | null;
  activa: boolean;
  creado_en: Date;
  actualizado_en: Date;
}

interface AsientoRow {
  id: string;
  negocio_id: string;
  numero: number;
  fecha: Date;
  concepto: string;
  origen: OrigenAsiento;
  referencia_id: string | null;
  creado_por: string | null;
  creado_en: Date;
}

async function handleRouteError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (err instanceof AuthError) {
    return await reply.code(err.statusCode).send({ error: err.message });
  }
  if (err instanceof ZodError) {
    return await reply.code(400).send({
      error: 'Datos inválidos',
      detalles: err.issues,
    });
  }
  const mensaje = err instanceof Error ? err.message : 'Error interno del servidor';
  if (
    mensaje.includes('Violación contable') ||
    mensaje.includes('Partida doble desbalanceada') ||
    mensaje.includes('ejercicio contable cerrado')
  ) {
    return await reply.code(400).send({ error: mensaje });
  }
  request.log.error({ err, modulo: 'contabilidad' }, 'Error en ruta de contabilidad');
  return await reply.code(500).send({ error: 'Error interno del servidor' });
}

// Plan de cuentas inicial estándar para negocios de ferretería / comercio
const PLAN_CUENTAS_BASE = [
  { codigo: '1.1.01', nombre: 'Caja Efectivo', tipo: 'activo', descripcion: 'Dinero en efectivo en cajas' },
  { codigo: '1.1.02', nombre: 'Banco y Cuentas Virtuales', tipo: 'activo', descripcion: 'Saldos bancarios, transferencias y billeteras QR' },
  { codigo: '1.1.03', nombre: 'Valores a Depositar (Cheques)', tipo: 'activo', descripcion: 'Cartera de cheques físicos y eCheqs' },
  { codigo: '1.1.04', nombre: 'Deudores por Ventas (Cta Cte)', tipo: 'activo', descripcion: 'Saldos a cobrar de clientes en cuenta corriente' },
  { codigo: '1.1.05', nombre: 'Mercaderías en Stock', tipo: 'activo', descripcion: 'Inventario valorizado a costo de reposición' },
  { codigo: '2.1.01', nombre: 'Proveedores (Cta Cte)', tipo: 'pasivo', descripcion: 'Obligaciones y compras a pagar a proveedores' },
  { codigo: '2.1.02', nombre: 'IVA Débito Fiscal', tipo: 'pasivo', descripcion: 'IVA facturado en ventas' },
  { codigo: '3.1.01', nombre: 'Capital / Patrimonio Social', tipo: 'patrimonio_neto', descripcion: 'Patrimonio inicial y reservas' },
  { codigo: '4.1.01', nombre: 'Ventas de Mercadería', tipo: 'ingreso', descripcion: 'Ingresos brutos por ventas de salón y mostrador' },
  { codigo: '4.1.02', nombre: 'Otros Ingresos Operativos', tipo: 'ingreso', descripcion: 'Ingresos financieros o extraordinarios' },
  { codigo: '5.1.01', nombre: 'Costo de Mercaderías Vendidas', tipo: 'egreso', descripcion: 'Costo de adquisición de los productos vendidos' },
  { codigo: '5.1.02', nombre: 'Gastos Generales y Operativos', tipo: 'egreso', descripcion: 'Egresos de caja, servicios, fletes y mantenimiento' },
  { codigo: '5.1.03', nombre: 'Gastos Bancarios y Comisiones', tipo: 'egreso', descripcion: 'Comisiones de tarjetas, posnets e impuestos bancarios' },
] as const;

export function registerContabilidadRoutes(
  app: FastifyInstance,
  options: ContabilidadRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Obtener plan de cuentas (auto-inicializa si está vacío)
  app.get('/contabilidad/cuentas', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const cuentas = await withTenantTransaction(pool, user.negocioId, async ({ client, db }) => {
        const existentes = await db
          .select()
          .from(cuentaContable)
          .where(eq(cuentaContable.negocioId, user.negocioId))
          .orderBy(asc(cuentaContable.codigo));

        if (existentes.length > 0) {
          return existentes;
        }

        // Si está vacío, sembramos el plan de cuentas inicial estándar
        for (const c of PLAN_CUENTAS_BASE) {
          await client.query(
            `insert into cuenta_contable (negocio_id, codigo, nombre, tipo, descripcion, activa)
             values ($1, $2, $3, $4, $5, true)
             on conflict (negocio_id, codigo) do nothing`,
            [user.negocioId, c.codigo, c.nombre, c.tipo, c.descripcion],
          );
        }

        return await db
          .select()
          .from(cuentaContable)
          .where(eq(cuentaContable.negocioId, user.negocioId))
          .orderBy(asc(cuentaContable.codigo));
      });

      return await reply.code(200).send(cuentas);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 2. Crear nueva cuenta contable
  app.post('/contabilidad/cuentas', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['encargado', 'dueno']);

      const input = guardarCuentaContableSchema.parse(request.body);

      const nueva = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        const res = await client.query<CuentaRow>(
          `insert into cuenta_contable (
            negocio_id, codigo, nombre, tipo, descripcion, activa
          ) values ($1, $2, $3, $4, $5, $6)
          returning *`,
          [
            user.negocioId,
            input.codigo,
            input.nombre,
            input.tipo,
            input.descripcion ?? null,
            input.activa,
          ],
        );
        return res.rows[0];
      });

      return await reply.code(201).send(nueva);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 3. Consultar Libro Diario con renglones agrupados
  app.get('/contabilidad/libro-diario', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const query = request.query as {
        fechaDesde?: string;
        fechaHasta?: string;
        origen?: string;
      };

      const asientos = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        let sql = `
          select
            negocio_id,
            asiento_id,
            asiento_numero,
            asiento_fecha,
            asiento_concepto,
            asiento_origen,
            asiento_referencia_id,
            asiento_creado_por,
            renglon_id,
            cuenta_id,
            cuenta_codigo,
            cuenta_nombre,
            cuenta_tipo,
            debe::text,
            haber::text,
            renglon_descripcion
          from v_libro_diario
          where negocio_id = $1
        `;
        const params: unknown[] = [user.negocioId];
        let pIndex = 2;

        if (query.fechaDesde) {
          sql += ` and asiento_fecha >= $${pIndex}::timestamptz`;
          params.push(query.fechaDesde);
          pIndex++;
        }
        if (query.fechaHasta) {
          sql += ` and asiento_fecha <= $${pIndex}::timestamptz`;
          params.push(query.fechaHasta);
          pIndex++;
        }
        if (query.origen) {
          sql += ` and asiento_origen = $${pIndex}`;
          params.push(query.origen);
          pIndex++;
        }

        sql += ` order by asiento_fecha desc, asiento_numero desc, debe desc`;

        const res = await client.query<LibroDiarioRow>(sql, params);

        // Agrupar filas por asiento
        const asientosMap = new Map<string, AsientoContableDetalle>();

        for (const row of res.rows) {
          const asientoId = row.asiento_id;
          if (!asientosMap.has(asientoId)) {
            asientosMap.set(asientoId, {
              id: asientoId,
              numero: row.asiento_numero,
              fecha: row.asiento_fecha.toISOString(),
              concepto: row.asiento_concepto,
              origen: row.asiento_origen,
              referenciaId: row.asiento_referencia_id,
              creadoPor: row.asiento_creado_por,
              creadoEn: row.asiento_fecha.toISOString(),
              totalDebe: '0.00',
              totalHaber: '0.00',
              cuadrado: true,
              renglones: [],
            });
          }

          const a = asientosMap.get(asientoId);
          if (a) {
            const renglon: RenglonAsientoDetalle = {
              id: row.renglon_id,
              cuentaId: row.cuenta_id,
              cuentaCodigo: row.cuenta_codigo,
              cuentaNombre: row.cuenta_nombre,
              cuentaTipo: row.cuenta_tipo,
              debe: row.debe,
              haber: row.haber,
              descripcion: row.renglon_descripcion,
            };
            a.renglones.push(renglon);
          }
        }

        // Calcular totales de Debe y Haber de cada asiento
        return Array.from(asientosMap.values()).map((asiento) => {
          let sumDebe = 0;
          let sumHaber = 0;
          for (const r of asiento.renglones) {
            sumDebe += Math.round(parseFloat(r.debe) * 100);
            sumHaber += Math.round(parseFloat(r.haber) * 100);
          }
          const totalDebe = (sumDebe / 100).toFixed(2);
          const totalHaber = (sumHaber / 100).toFixed(2);
          return {
            ...asiento,
            totalDebe,
            totalHaber,
            cuadrado: sumDebe === sumHaber,
          };
        });
      });

      return await reply.code(200).send(asientos);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 4. Consultar Balance de Sumas y Saldos
  app.get('/contabilidad/sumas-y-saldos', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const sumasYSaldos = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        const res = await client.query<SumasYSaldosRow>(`
          select
            cuenta_id,
            cuenta_codigo,
            cuenta_nombre,
            cuenta_tipo,
            cuenta_activa,
            total_debe::text,
            total_haber::text,
            saldo_deudor::text,
            saldo_acreedor::text
          from v_sumas_y_saldos
          where negocio_id = $1
          order by cuenta_codigo asc
        `, [user.negocioId]);

        return res.rows.map((r): ItemSumasYSaldos => ({
          cuentaId: r.cuenta_id,
          cuentaCodigo: r.cuenta_codigo,
          cuentaNombre: r.cuenta_nombre,
          cuentaTipo: r.cuenta_tipo,
          cuentaActiva: r.cuenta_activa,
          totalDebe: r.total_debe,
          totalHaber: r.total_haber,
          saldoDeudor: r.saldo_deudor,
          saldoAcreedor: r.saldo_acreedor,
        }));
      });

      return await reply.code(200).send(sumasYSaldos);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 5. Registrar Asiento Manual con validación estricta de partida doble
  app.post('/contabilidad/asientos', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['encargado', 'dueno']);

      const input = crearAsientoManualSchema.parse(request.body);

      // Verificación estricta de partida doble: suma(debe) === suma(haber)
      let totalDebeCentavos = 0;
      let totalHaberCentavos = 0;

      for (const r of input.renglones) {
        const d = Math.round(parseFloat(r.debe) * 100);
        const h = Math.round(parseFloat(r.haber) * 100);
        if (d < 0 || h < 0) {
          return await reply.code(400).send({ error: 'Los importes de debe y haber deben ser positivos o cero' });
        }
        if ((d > 0 && h > 0) || (d === 0 && h === 0)) {
          return await reply.code(400).send({
            error: 'Cada renglón debe imputar únicamente al Debe o al Haber (no ambos simultáneamente ni ambos en cero)',
          });
        }
        totalDebeCentavos += d;
        totalHaberCentavos += h;
      }

      if (totalDebeCentavos === 0) {
        return await reply.code(400).send({ error: 'El asiento no puede tener importe total cero' });
      }

      if (totalDebeCentavos !== totalHaberCentavos) {
        return await reply.code(400).send({
          error: `Partida doble desbalanceada: el Total Debe ($ ${(totalDebeCentavos / 100).toFixed(2)}) no coincide con el Total Haber ($ ${(totalHaberCentavos / 100).toFixed(2)})`,
        });
      }

      const creado = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        // Bloqueo advisory lock por negocio para número correlativo atómico sin huecos
        await client.query(`select pg_advisory_xact_lock(hashtext('asiento_contable_' || $1))`, [
          user.negocioId,
        ]);

        const numRes = await client.query<{ proximo_numero: number }>(
          `select coalesce(max(numero), 0) + 1 as proximo_numero
           from asiento_contable
           where negocio_id = $1`,
          [user.negocioId],
        );
        const proximoNumero = numRes.rows[0]?.proximo_numero ?? 1;

        const fechaAsiento = input.fecha ? new Date(input.fecha) : new Date();

        const asientoRes = await client.query<AsientoRow>(
          `insert into asiento_contable (
            negocio_id, numero, fecha, concepto, origen, referencia_id, creado_por
          ) values ($1, $2, $3, $4, $5, $6, $7)
          returning *`,
          [
            user.negocioId,
            proximoNumero,
            fechaAsiento,
            input.concepto,
            input.origen,
            input.referenciaId ?? null,
            user.usuarioId,
          ],
        );
        const asiento = asientoRes.rows[0];
        if (!asiento) {
          throw new Error('Error al registrar asiento contable');
        }

        // Insertar renglones
        for (const r of input.renglones) {
          await client.query(
            `insert into renglon_asiento (
              asiento_id, negocio_id, cuenta_id, debe, haber, descripcion
            ) values ($1, $2, $3, $4, $5, $6)`,
            [
              asiento.id,
              user.negocioId,
              r.cuentaId,
              r.debe,
              r.haber,
              r.descripcion ?? null,
            ],
          );
        }

        // Registrar auditoría del asiento manual
        await registrarAuditoria(client, {
          negocioId: user.negocioId,
          usuarioId: user.usuarioId,
          usuarioEmail: user.email,
          rol: user.rol,
          accion: 'asiento_manual',
          entidad: 'asiento_contable',
          entidadId: asiento.id,
          detalles: {
            numero: asiento.numero,
            concepto: asiento.concepto,
            origen: asiento.origen,
            totalDebe: (totalDebeCentavos / 100).toFixed(2),
            totalHaber: (totalHaberCentavos / 100).toFixed(2),
          },
        });

        return asiento;
      });

      return await reply.code(201).send(creado);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 5. Listar ejercicios contables
  app.get('/contabilidad/ejercicios', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const ejercicios = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        const res = await client.query<{
          id: string;
          numero: number;
          nombre: string;
          fecha_inicio: string;
          fecha_fin: string;
          estado: 'abierto' | 'cerrado';
          asiento_refundicion_id: string | null;
          asiento_cierre_id: string | null;
          cerrado_por: string | null;
          cerrado_en: Date | null;
          creado_en: Date;
        }>(
          `select
            id,
            numero,
            nombre,
            to_char(fecha_inicio, 'YYYY-MM-DD') as fecha_inicio,
            to_char(fecha_fin, 'YYYY-MM-DD') as fecha_fin,
            estado,
            asiento_refundicion_id,
            asiento_cierre_id,
            cerrado_por,
            cerrado_en,
            creado_en
          from ejercicio_contable
          where negocio_id = $1
          order by numero desc`,
          [user.negocioId],
        );

        return res.rows.map((r): EjercicioContableItem => ({
          id: r.id,
          numero: r.numero,
          nombre: r.nombre,
          fechaInicio: r.fecha_inicio,
          fechaFin: r.fecha_fin,
          estado: r.estado,
          asientoRefundicionId: r.asiento_refundicion_id,
          asientoCierreId: r.asiento_cierre_id,
          cerradoPor: r.cerrado_por,
          cerradoEn: r.cerrado_en ? r.cerrado_en.toISOString() : null,
          creadoEn: r.creado_en.toISOString(),
        }));
      });

      return await reply.send(ejercicios);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 6. Crear / Abrir nuevo ejercicio contable
  app.post('/contabilidad/ejercicios', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['encargado', 'dueno']);

      const input = crearEjercicioContableSchema.parse(request.body);

      if (input.fechaFin < input.fechaInicio) {
        return await reply.code(400).send({
          error: 'La fecha de fin no puede ser anterior a la fecha de inicio',
        });
      }

      const creado = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        await client.query(`select pg_advisory_xact_lock(hashtext('ejercicio_contable_' || $1))`, [
          user.negocioId,
        ]);

        const numRes = await client.query<{ proximo_numero: number }>(
          `select coalesce(max(numero), 0) + 1 as proximo_numero
           from ejercicio_contable
           where negocio_id = $1`,
          [user.negocioId],
        );
        const numero = input.numero ?? (numRes.rows[0]?.proximo_numero ?? 1);

        const res = await client.query<{
          id: string;
          numero: number;
          nombre: string;
          fecha_inicio: string;
          fecha_fin: string;
          estado: 'abierto' | 'cerrado';
          asiento_refundicion_id: string | null;
          asiento_cierre_id: string | null;
          cerrado_por: string | null;
          cerrado_en: Date | null;
          creado_en: Date;
        }>(
          `insert into ejercicio_contable (
            negocio_id, numero, nombre, fecha_inicio, fecha_fin, estado
          ) values ($1, $2, $3, $4, $5, 'abierto')
          returning
            id,
            numero,
            nombre,
            to_char(fecha_inicio, 'YYYY-MM-DD') as fecha_inicio,
            to_char(fecha_fin, 'YYYY-MM-DD') as fecha_fin,
            estado,
            asiento_refundicion_id,
            asiento_cierre_id,
            cerrado_por,
            cerrado_en,
            creado_en`,
          [user.negocioId, numero, input.nombre, input.fechaInicio, input.fechaFin],
        );

        const ej = res.rows[0];
        if (!ej) {
          throw new Error('Error al registrar ejercicio contable');
        }

        await registrarAuditoria(client, {
          negocioId: user.negocioId,
          usuarioId: user.usuarioId,
          usuarioEmail: user.email,
          rol: user.rol,
          accion: 'apertura_ejercicio',
          entidad: 'ejercicio_contable',
          entidadId: ej.id,
          detalles: {
            numero: ej.numero,
            nombre: ej.nombre,
            fechaInicio: ej.fecha_inicio,
            fechaFin: ej.fecha_fin,
          },
        });

        return {
          id: ej.id,
          numero: ej.numero,
          nombre: ej.nombre,
          fechaInicio: ej.fecha_inicio,
          fechaFin: ej.fecha_fin,
          estado: ej.estado,
          asientoRefundicionId: ej.asiento_refundicion_id,
          asientoCierreId: ej.asiento_cierre_id,
          cerradoPor: ej.cerrado_por,
          cerradoEn: ej.cerrado_en ? ej.cerrado_en.toISOString() : null,
          creadoEn: ej.creado_en.toISOString(),
        };
      });

      return await reply.code(201).send(creado);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 7. Cerrar ejercicio contable (Asiento de refundición + Asiento de cierre patrimonial)
  app.post<{ Params: { id: string } }>('/contabilidad/ejercicios/:id/cerrar', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['encargado', 'dueno']);

      const { id } = request.params;

      const resultado = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        // Bloqueo advisory lock para evitar cierres concurrentes
        await client.query(`select pg_advisory_xact_lock(hashtext('cierre_ejercicio_' || $1))`, [
          user.negocioId,
        ]);

        const ejRes = await client.query<{
          id: string;
          numero: number;
          nombre: string;
          fecha_inicio: string;
          fecha_fin: string;
          estado: 'abierto' | 'cerrado';
        }>(
          `select
            id,
            numero,
            nombre,
            to_char(fecha_inicio, 'YYYY-MM-DD') as fecha_inicio,
            to_char(fecha_fin, 'YYYY-MM-DD') as fecha_fin,
            estado
          from ejercicio_contable
          where id = $1 and negocio_id = $2`,
          [id, user.negocioId],
        );

        const ejercicio = ejRes.rows[0];
        if (!ejercicio) {
          throw new Error('Ejercicio contable no encontrado');
        }

        if (ejercicio.estado === 'cerrado') {
          throw new Error('El ejercicio contable ya se encuentra cerrado');
        }

        // Asegurar cuenta de Resultado del Ejercicio (3.2.01)
        let cuentaResultadoId: string | null = null;
        const cRes = await client.query<{ id: string }>(
          `select id from cuenta_contable where negocio_id = $1 and codigo = '3.2.01'`,
          [user.negocioId],
        );
        if (cRes.rows[0]) {
          cuentaResultadoId = cRes.rows[0].id;
        } else {
          const insRes = await client.query<{ id: string }>(
            `insert into cuenta_contable (negocio_id, codigo, nombre, tipo, descripcion, activa)
             values ($1, '3.2.01', 'Resultado del Ejercicio', 'patrimonio_neto', 'Ganancia o pérdida neta acumulada del período contable', true)
             returning id`,
            [user.negocioId],
          );
          const insFila = insRes.rows[0];
          if (!insFila) {
            throw new Error('Error al inicializar cuenta de resultado del ejercicio');
          }
          cuentaResultadoId = insFila.id;
        }

        // 1. Calcular saldos de cuentas de resultado (ingreso / egreso) dentro del período del ejercicio
        const saldosResultadoRes = await client.query<{
          cuenta_id: string;
          cuenta_codigo: string;
          cuenta_nombre: string;
          cuenta_tipo: 'ingreso' | 'egreso';
          total_debe: string;
          total_haber: string;
        }>(
          `select
            c.id as cuenta_id,
            c.codigo as cuenta_codigo,
            c.nombre as cuenta_nombre,
            c.tipo as cuenta_tipo,
            coalesce(sum(r.debe), 0)::numeric(14,2) as total_debe,
            coalesce(sum(r.haber), 0)::numeric(14,2) as total_haber
          from cuenta_contable c
          join renglon_asiento r on r.cuenta_id = c.id and r.negocio_id = c.negocio_id
          join asiento_contable a on a.id = r.asiento_id and a.negocio_id = r.negocio_id
          where c.negocio_id = $1
            and a.fecha::date between $2 and $3
            and c.tipo in ('ingreso', 'egreso')
          group by c.id, c.codigo, c.nombre, c.tipo`,
          [user.negocioId, ejercicio.fecha_inicio, ejercicio.fecha_fin],
        );

        let asientoRefundicionId: string | null = null;
        let resultadoNetoCentavos = 0;

        const renglonesRefundicion: Array<{
          cuentaId: string;
          debe: string;
          haber: string;
          descripcion: string;
        }> = [];

        let sumaDebitosRefundicion = 0;
        let sumaCreditosRefundicion = 0;

        for (const row of saldosResultadoRes.rows) {
          const d = Math.round(Number(row.total_debe) * 100);
          const h = Math.round(Number(row.total_haber) * 100);

          if (row.cuenta_tipo === 'ingreso') {
            const saldoAcreedor = h - d;
            if (saldoAcreedor > 0) {
              renglonesRefundicion.push({
                cuentaId: row.cuenta_id,
                debe: (saldoAcreedor / 100).toFixed(2),
                haber: '0.00',
                descripcion: `Refundición saldo acreedor ${row.cuenta_codigo}`,
              });
              sumaDebitosRefundicion += saldoAcreedor;
              resultadoNetoCentavos += saldoAcreedor;
            } else if (saldoAcreedor < 0) {
              const abs = Math.abs(saldoAcreedor);
              renglonesRefundicion.push({
                cuentaId: row.cuenta_id,
                debe: '0.00',
                haber: (abs / 100).toFixed(2),
                descripcion: `Refundición saldo ${row.cuenta_codigo}`,
              });
              sumaCreditosRefundicion += abs;
              resultadoNetoCentavos -= abs;
            }
          } else {
            const saldoDeudor = d - h;
            if (saldoDeudor > 0) {
              renglonesRefundicion.push({
                cuentaId: row.cuenta_id,
                debe: '0.00',
                haber: (saldoDeudor / 100).toFixed(2),
                descripcion: `Refundición saldo deudor ${row.cuenta_codigo}`,
              });
              sumaCreditosRefundicion += saldoDeudor;
              resultadoNetoCentavos -= saldoDeudor;
            } else if (saldoDeudor < 0) {
              const abs = Math.abs(saldoDeudor);
              renglonesRefundicion.push({
                cuentaId: row.cuenta_id,
                debe: (abs / 100).toFixed(2),
                haber: '0.00',
                descripcion: `Refundición saldo ${row.cuenta_codigo}`,
              });
              sumaDebitosRefundicion += abs;
              resultadoNetoCentavos += abs;
            }
          }
        }

        // Si hubo movimientos de resultado, balanceamos contra Resultado del Ejercicio
        if (renglonesRefundicion.length > 0) {
          if (resultadoNetoCentavos > 0) {
            // Ganancia neta: se acredita Resultado del Ejercicio
            renglonesRefundicion.push({
              cuentaId: cuentaResultadoId,
              debe: '0.00',
              haber: (resultadoNetoCentavos / 100).toFixed(2),
              descripcion: 'Ganancia neta acumulada del ejercicio',
            });
            sumaCreditosRefundicion += resultadoNetoCentavos;
          } else if (resultadoNetoCentavos < 0) {
            // Pérdida neta: se debita Resultado del Ejercicio
            const abs = Math.abs(resultadoNetoCentavos);
            renglonesRefundicion.push({
              cuentaId: cuentaResultadoId,
              debe: (abs / 100).toFixed(2),
              haber: '0.00',
              descripcion: 'Pérdida neta acumulada del ejercicio',
            });
            sumaDebitosRefundicion += abs;
          }

          if (sumaDebitosRefundicion === sumaCreditosRefundicion && sumaDebitosRefundicion > 0) {
            const numRes = await client.query<{ proximo_numero: number }>(
              `select coalesce(max(numero), 0) + 1 as proximo_numero
               from asiento_contable
               where negocio_id = $1`,
              [user.negocioId],
            );
            const numeroAsiento = numRes.rows[0]?.proximo_numero ?? 1;

            const refundicionAsientoRes = await client.query<{ id: string }>(
              `insert into asiento_contable (
                negocio_id, numero, fecha, concepto, origen, referencia_id, creado_por
              ) values ($1, $2, $3, $4, 'refundicion_resultados', $5, $6)
              returning id`,
              [
                user.negocioId,
                numeroAsiento,
                new Date(`${ejercicio.fecha_fin}T23:59:59Z`),
                `Refundición de cuentas de resultado - ${ejercicio.nombre}`,
                ejercicio.id,
                user.usuarioId,
              ],
            );
            const refFila = refundicionAsientoRes.rows[0];
            if (!refFila) {
              throw new Error('Error al registrar asiento de refundición');
            }
            asientoRefundicionId = refFila.id;

            for (const r of renglonesRefundicion) {
              await client.query(
                `insert into renglon_asiento (
                  asiento_id, negocio_id, cuenta_id, debe, haber, descripcion
                ) values ($1, $2, $3, $4, $5, $6)`,
                [asientoRefundicionId, user.negocioId, r.cuentaId, r.debe, r.haber, r.descripcion],
              );
            }
          }
        }

        // 2. Asiento de Cierre Patrimonial (Saldado de Activo, Pasivo y Patrimonio Neto)
        let asientoCierreId: string | null = null;
        const saldosPatrimonialesRes = await client.query<{
          cuenta_id: string;
          cuenta_codigo: string;
          cuenta_nombre: string;
          cuenta_tipo: 'activo' | 'pasivo' | 'patrimonio_neto';
          total_debe: string;
          total_haber: string;
        }>(
          `select
            c.id as cuenta_id,
            c.codigo as cuenta_codigo,
            c.nombre as cuenta_nombre,
            c.tipo as cuenta_tipo,
            coalesce(sum(r.debe), 0)::numeric(14,2) as total_debe,
            coalesce(sum(r.haber), 0)::numeric(14,2) as total_haber
          from cuenta_contable c
          join renglon_asiento r on r.cuenta_id = c.id and r.negocio_id = c.negocio_id
          join asiento_contable a on a.id = r.asiento_id and a.negocio_id = r.negocio_id
          where c.negocio_id = $1
            and a.fecha::date <= $2
            and c.tipo in ('activo', 'pasivo', 'patrimonio_neto')
          group by c.id, c.codigo, c.nombre, c.tipo`,
          [user.negocioId, ejercicio.fecha_fin],
        );

        const renglonesCierre: Array<{
          cuentaId: string;
          debe: string;
          haber: string;
          descripcion: string;
        }> = [];

        let sumaDebitosCierre = 0;
        let sumaCreditosCierre = 0;

        for (const row of saldosPatrimonialesRes.rows) {
          const d = Math.round(Number(row.total_debe) * 100);
          const h = Math.round(Number(row.total_haber) * 100);

          if (d === h) continue;

          if (d > h) {
            // Cuenta con saldo deudor: para saldarla en el cierre patrimonial se ACREDITA
            const diff = d - h;
            renglonesCierre.push({
              cuentaId: row.cuenta_id,
              debe: '0.00',
              haber: (diff / 100).toFixed(2),
              descripcion: `Cierre patrimonial saldo deudor ${row.cuenta_codigo}`,
            });
            sumaCreditosCierre += diff;
          } else {
            // Cuenta con saldo acreedor: para saldarla en el cierre patrimonial se DEBITA
            const diff = h - d;
            renglonesCierre.push({
              cuentaId: row.cuenta_id,
              debe: (diff / 100).toFixed(2),
              haber: '0.00',
              descripcion: `Cierre patrimonial saldo acreedor ${row.cuenta_codigo}`,
            });
            sumaDebitosCierre += diff;
          }
        }

        if (renglonesCierre.length > 0 && sumaDebitosCierre === sumaCreditosCierre) {
          const numCierreRes = await client.query<{ proximo_numero: number }>(
            `select coalesce(max(numero), 0) + 1 as proximo_numero
             from asiento_contable
             where negocio_id = $1`,
            [user.negocioId],
          );
          const numeroCierre = numCierreRes.rows[0]?.proximo_numero ?? 1;

          const cierreAsientoRes = await client.query<{ id: string }>(
            `insert into asiento_contable (
              negocio_id, numero, fecha, concepto, origen, referencia_id, creado_por
            ) values ($1, $2, $3, $4, 'cierre_ejercicio', $5, $6)
            returning id`,
            [
              user.negocioId,
              numeroCierre,
              new Date(`${ejercicio.fecha_fin}T23:59:59Z`),
              `Cierre formal de cuentas patrimoniales - ${ejercicio.nombre}`,
              ejercicio.id,
              user.usuarioId,
            ],
          );
          const cieFila = cierreAsientoRes.rows[0];
          if (!cieFila) {
            throw new Error('Error al registrar asiento de cierre patrimonial');
          }
          asientoCierreId = cieFila.id;

          for (const r of renglonesCierre) {
            await client.query(
              `insert into renglon_asiento (
                asiento_id, negocio_id, cuenta_id, debe, haber, descripcion
              ) values ($1, $2, $3, $4, $5, $6)`,
              [asientoCierreId, user.negocioId, r.cuentaId, r.debe, r.haber, r.descripcion],
            );
          }
        }

        // 3. Actualizar estado del ejercicio a 'cerrado'
        await client.query(
          `update ejercicio_contable
           set estado = 'cerrado',
               asiento_refundicion_id = $1,
               asiento_cierre_id = $2,
               cerrado_por = $3,
               cerrado_en = now()
           where id = $4 and negocio_id = $5`,
          [asientoRefundicionId, asientoCierreId, user.usuarioId, ejercicio.id, user.negocioId],
        );

        // 4. Registrar en Auditoría Centralizada
        await registrarAuditoria(client, {
          negocioId: user.negocioId,
          usuarioId: user.usuarioId,
          usuarioEmail: user.email,
          rol: user.rol,
          accion: 'cierre_ejercicio',
          entidad: 'ejercicio_contable',
          entidadId: ejercicio.id,
          detalles: {
            numero: ejercicio.numero,
            nombre: ejercicio.nombre,
            fechaInicio: ejercicio.fecha_inicio,
            fechaFin: ejercicio.fecha_fin,
            asientoRefundicionId,
            asientoCierreId,
            resultadoNeto: (resultadoNetoCentavos / 100).toFixed(2),
          },
        });

        return {
          id: ejercicio.id,
          numero: ejercicio.numero,
          nombre: ejercicio.nombre,
          fechaInicio: ejercicio.fecha_inicio,
          fechaFin: ejercicio.fecha_fin,
          estado: 'cerrado' as const,
          asientoRefundicionId,
          asientoCierreId,
          resultadoNeto: (resultadoNetoCentavos / 100).toFixed(2),
        };
      });

      return await reply.send(resultado);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });
}
