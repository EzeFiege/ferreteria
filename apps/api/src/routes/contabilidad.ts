import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import {
  crearAsientoManualSchema,
  guardarCuentaContableSchema,
  type AsientoContableDetalle,
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
  if (mensaje.includes('Violación contable') || mensaje.includes('Partida doble desbalanceada')) {
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

        return asiento;
      });

      return await reply.code(201).send(creado);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });
}
