import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import {
  depositarChequeSchema,
  endosarChequeProveedorSchema,
  guardarChequeSchema,
  rechazarChequeSchema,
  uuidSchema,
  type ItemFlujoCajaProyectado,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';
import {
  chequeCartera,
  movimientoCtaCteProveedor,
  proveedor,
  cliente,
} from '../db/schema.js';

export interface TesoreriaRoutesOptions extends FastifyPluginOptions {
  pool: Pool;
  verifyToken?: TokenVerifier | undefined;
}

interface FlujoCajaRow {
  negocio_id: string;
  fecha: string;
  tipo: 'acreditacion_tarjeta' | 'cheque_en_cartera' | 'vencimiento_proveedor';
  descripcion: string;
  sentido: 'ingreso' | 'egreso';
  monto: string;
}

function handleRouteError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (err instanceof AuthError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: 'Datos inválidos',
      detalles: err.issues,
    });
  }
  request.log.error({ err, modulo: 'tesoreria' }, 'Error en ruta de tesorería');
  return reply.code(500).send({ error: 'Error interno del servidor' });
}

export function registerTesoreriaRoutes(
  app: FastifyInstance,
  options: TesoreriaRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Listar cheques en cartera con filtros
  app.get('/tesoreria/cheques', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const query = request.query as {
        estado?: string;
        tipo?: string;
      };

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const conditions: SQL[] = [eq(chequeCartera.negocioId, claims.negocioId)];

          if (query.estado && query.estado !== 'todos') {
            conditions.push(
              eq(
                chequeCartera.estado,
                query.estado as
                  | 'en_cartera'
                  | 'depositado'
                  | 'entregado_proveedor'
                  | 'rechazado'
                  | 'anulado',
              ),
            );
          }

          if (query.tipo && query.tipo !== 'todos') {
            conditions.push(
              eq(chequeCartera.tipo, query.tipo as 'fisico' | 'echeq'),
            );
          }

          const filas = await db
            .select({
              id: chequeCartera.id,
              negocioId: chequeCartera.negocioId,
              tipo: chequeCartera.tipo,
              numero: chequeCartera.numero,
              banco: chequeCartera.banco,
              cuitEmisor: chequeCartera.cuitEmisor,
              titular: chequeCartera.titular,
              fechaEmision: chequeCartera.fechaEmision,
              fechaPago: chequeCartera.fechaPago,
              monto: chequeCartera.monto,
              estado: chequeCartera.estado,
              clienteId: chequeCartera.clienteId,
              clienteNombre: cliente.nombre,
              proveedorId: chequeCartera.proveedorId,
              proveedorRazonSocial: proveedor.razonSocial,
              movimientoCajaId: chequeCartera.movimientoCajaId,
              cuentaBancariaDestino: chequeCartera.cuentaBancariaDestino,
              fechaDeposito: chequeCartera.fechaDeposito,
              fechaEntrega: chequeCartera.fechaEntrega,
              notas: chequeCartera.notas,
              creadoEn: chequeCartera.creadoEn,
            })
            .from(chequeCartera)
            .leftJoin(cliente, eq(chequeCartera.clienteId, cliente.id))
            .leftJoin(proveedor, eq(chequeCartera.proveedorId, proveedor.id))
            .where(and(...conditions))
            .orderBy(desc(chequeCartera.fechaPago));

          return filas;
        },
      );

      return await reply.code(200).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 2. Registrar ingreso de cheque en cartera
  app.post('/tesoreria/cheques', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const body = guardarChequeSchema.parse(request.body);

      const nuevoCheque = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [creado] = await db
            .insert(chequeCartera)
            .values({
              ...(body.id ? { id: body.id } : {}),
              negocioId: claims.negocioId,
              tipo: body.tipo,
              numero: body.numero,
              banco: body.banco,
              cuitEmisor: body.cuitEmisor ?? null,
              titular: body.titular ?? null,
              fechaEmision: body.fechaEmision ?? undefined,
              fechaPago: body.fechaPago,
              monto: body.monto,
              clienteId: body.clienteId ?? null,
              movimientoCajaId: body.movimientoCajaId ?? null,
              notas: body.notas ?? null,
              creadoPor: claims.usuarioId,
            })
            .returning();

          return creado;
        },
      );

      return await reply.code(201).send(nuevoCheque);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 3. Depositar cheque en cuenta bancaria
  app.post('/tesoreria/cheques/:id/depositar', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const params = request.params as { id: string };
      const chequeId = uuidSchema.parse(params.id);
      const body = depositarChequeSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [ch] = await db
            .select()
            .from(chequeCartera)
            .where(
              and(
                eq(chequeCartera.id, chequeId),
                eq(chequeCartera.negocioId, claims.negocioId),
              ),
            );

          if (!ch) {
            return { estado: 'no_encontrado' as const };
          }

          if (ch.estado !== 'en_cartera') {
            return {
              estado: 'error_estado' as const,
              mensaje: `El cheque está en estado '${ch.estado}', no puede depositarse.`,
            };
          }

          const [actualizado] = await db
            .update(chequeCartera)
            .set({
              estado: 'depositado',
              cuentaBancariaDestino: body.cuentaBancariaDestino,
              fechaDeposito: body.fechaDeposito ?? new Date().toISOString().slice(0, 10),
              notas: body.notas ?? ch.notas,
              actualizadoEn: new Date(),
            })
            .where(
              and(
                eq(chequeCartera.id, chequeId),
                eq(chequeCartera.negocioId, claims.negocioId),
              ),
            )
            .returning();

          return { estado: 'ok' as const, cheque: actualizado };
        },
      );

      if (resultado.estado === 'no_encontrado') {
        return await reply.code(404).send({ message: 'Cheque no encontrado.' });
      }
      if (resultado.estado === 'error_estado') {
        return await reply.code(400).send({ message: resultado.mensaje });
      }

      return await reply.code(200).send(resultado.cheque);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 4. Endosar y entregar cheque a proveedor (cancela saldo en cta cte inmutable de proveedor)
  app.post('/tesoreria/cheques/:id/endosar-proveedor', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const params = request.params as { id: string };
      const chequeId = uuidSchema.parse(params.id);
      const body = endosarChequeProveedorSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [ch] = await db
            .select()
            .from(chequeCartera)
            .where(
              and(
                eq(chequeCartera.id, chequeId),
                eq(chequeCartera.negocioId, claims.negocioId),
              ),
            );

          if (!ch) {
            return { estado: 'no_encontrado' as const };
          }

          if (ch.estado !== 'en_cartera') {
            return {
              estado: 'error_estado' as const,
              mensaje: `El cheque está en estado '${ch.estado}', no puede entregarse.`,
            };
          }

          const [prov] = await db
            .select()
            .from(proveedor)
            .where(
              and(
                eq(proveedor.id, body.proveedorId),
                eq(proveedor.negocioId, claims.negocioId),
              ),
            );

          if (!prov) {
            return {
              estado: 'error_estado' as const,
              mensaje: 'El proveedor especificado no existe.',
            };
          }

          // 1. Actualizar cheque a entregado_proveedor
          const [actualizado] = await db
            .update(chequeCartera)
            .set({
              estado: 'entregado_proveedor',
              proveedorId: body.proveedorId,
              fechaEntrega: body.fechaEntrega ?? new Date().toISOString().slice(0, 10),
              notas: body.notas ?? ch.notas,
              actualizadoEn: new Date(),
            })
            .where(
              and(
                eq(chequeCartera.id, chequeId),
                eq(chequeCartera.negocioId, claims.negocioId),
              ),
            )
            .returning();

          // 2. Registrar crédito en libro inmutable de cuenta corriente del proveedor
          await db.insert(movimientoCtaCteProveedor).values({
            negocioId: claims.negocioId,
            proveedorId: body.proveedorId,
            tipo: 'credito_pago',
            sentido: 'credito',
            monto: ch.monto,
            descripcion: `Pago con cheque ${ch.banco} Nº ${ch.numero} (Venc: ${ch.fechaPago})`,
            creadoPor: claims.usuarioId,
          });

          return { estado: 'ok' as const, cheque: actualizado };
        },
      );

      if (resultado.estado === 'no_encontrado') {
        return await reply.code(404).send({ message: 'Cheque no encontrado.' });
      }
      if (resultado.estado === 'error_estado') {
        return await reply.code(400).send({ message: resultado.mensaje });
      }

      return await reply.code(200).send(resultado.cheque);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 5. Marcar cheque como rechazado
  app.post('/tesoreria/cheques/:id/rechazar', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const params = request.params as { id: string };
      const chequeId = uuidSchema.parse(params.id);
      const body = rechazarChequeSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [ch] = await db
            .select()
            .from(chequeCartera)
            .where(
              and(
                eq(chequeCartera.id, chequeId),
                eq(chequeCartera.negocioId, claims.negocioId),
              ),
            );

          if (!ch) {
            return { estado: 'no_encontrado' as const };
          }

          const [actualizado] = await db
            .update(chequeCartera)
            .set({
              estado: 'rechazado',
              notas: `Rechazado: ${body.motivo}${ch.notas ? ` | ${ch.notas}` : ''}`,
              actualizadoEn: new Date(),
            })
            .where(
              and(
                eq(chequeCartera.id, chequeId),
                eq(chequeCartera.negocioId, claims.negocioId),
              ),
            )
            .returning();

          return { estado: 'ok' as const, cheque: actualizado };
        },
      );

      if (resultado.estado === 'no_encontrado') {
        return await reply.code(404).send({ message: 'Cheque no encontrado.' });
      }

      return await reply.code(200).send(resultado.cheque);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 6. Flujo de Caja Proyectado (a 7, 14, 30, 60 días)
  app.get('/tesoreria/flujo-proyectado', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const query = request.query as { dias?: string };
      const diasProyeccion = query.dias ? Math.min(Math.max(parseInt(query.dias, 10), 1), 90) : 30;

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const querySql = `
            select
              negocio_id,
              fecha::text as fecha,
              tipo,
              descripcion,
              sentido,
              monto::text as monto
            from v_flujo_caja_proyectado
            where negocio_id = $1
              and fecha <= (current_date + ($2 || ' days')::interval)::date
            order by fecha asc, sentido desc
          `;

          const res = await client.query<FlujoCajaRow>(querySql, [
            claims.negocioId,
            diasProyeccion,
          ]);

          const items: ItemFlujoCajaProyectado[] = res.rows.map((r: FlujoCajaRow) => ({
            fecha: r.fecha,
            tipo: r.tipo,
            descripcion: r.descripcion,
            sentido: r.sentido,
            monto: r.monto,
          }));

          const totalIngresos = items
            .filter((i) => i.sentido === 'ingreso')
            .reduce((acc, i) => acc + (parseFloat(i.monto) || 0), 0)
            .toFixed(2);

          const totalEgresos = items
            .filter((i) => i.sentido === 'egreso')
            .reduce((acc, i) => acc + (parseFloat(i.monto) || 0), 0)
            .toFixed(2);

          const saldoNetoProyectado = (
            parseFloat(totalIngresos) - parseFloat(totalEgresos)
          ).toFixed(2);

          return {
            dias: diasProyeccion,
            totalIngresos,
            totalEgresos,
            saldoNetoProyectado,
            items,
          };
        },
      );

      return await reply.code(200).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });
}
