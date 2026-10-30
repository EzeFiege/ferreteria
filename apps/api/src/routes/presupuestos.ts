import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import {
  guardarPresupuestoSchema,
  uuidSchema,
  type ItemPresupuestoDetalle,
  type PresupuestoDetalle,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';
import { presupuesto } from '../db/schema.js';

export interface PresupuestosRoutesOptions extends FastifyPluginOptions {
  pool: Pool;
  verifyToken?: TokenVerifier | undefined;
}

interface PresupuestoRow {
  id: string;
  negocio_id: string;
  numero: number;
  fecha_emision: Date;
  fecha_vencimiento: string;
  dias_validez: number;
  cliente_id: string | null;
  obra_id: string | null;
  nombre_contacto: string | null;
  telefono_contacto: string | null;
  email_contacto: string | null;
  lista_precio_id: string | null;
  subtotal: string;
  descuento_general: string;
  total: string;
  estado: 'pendiente' | 'aprobado_convertido' | 'vencido' | 'cancelado';
  etapa_crm: 'borrador' | 'enviado' | 'negociacion' | 'ganado' | 'perdido';
  motivo_perdido: string | null;
  probabilidad_pct: number;
  venta_id: string | null;
  observaciones: string | null;
  creado_por: string | null;
  creado_en: Date;
  actualizado_en: Date;
}

interface ItemPresupuestoRow {
  id: string;
  presupuesto_id: string;
  negocio_id: string;
  producto_id: string | null;
  codigo: string | null;
  nombre: string;
  unidad: string;
  cantidad: string;
  precio_unitario: string;
  descuento_pct: string;
  subtotal: string;
  notas: string | null;
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
  request.log.error({ err, modulo: 'presupuestos' }, 'Error en ruta de presupuestos');
  return await reply.code(500).send({ error: mensaje });
}

export function registerPresupuestosRoutes(
  app: FastifyInstance,
  options: PresupuestosRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Listar presupuestos
  app.get('/presupuestos', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const query = request.query as {
        estado?: string;
        q?: string;
      };

      const lista = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        let sql = `
          select *
          from presupuesto
          where negocio_id = $1
        `;
        const params: unknown[] = [user.negocioId];
        let pIndex = 2;

        if (query.estado && query.estado !== 'todos') {
          sql += ` and estado = $${pIndex}`;
          params.push(query.estado);
          pIndex++;
        }
        if (query.q) {
          sql += ` and (nombre_contacto ilike $${pIndex} or observaciones ilike $${pIndex} or numero::text = $${pIndex + 1})`;
          params.push(`%${query.q}%`);
          params.push(query.q);
          pIndex += 2;
        }

        sql += ` order by numero desc`;

        const res = await client.query<PresupuestoRow>(sql, params);
        const hoy = new Date().toISOString().split('T')[0] ?? '';

        return res.rows.map((p): PresupuestoDetalle => {
          const estaVencido = p.estado === 'pendiente' && p.fecha_vencimiento < hoy;
          return {
            id: p.id,
            numero: p.numero,
            fechaEmision: p.fecha_emision.toISOString(),
            fechaVencimiento: p.fecha_vencimiento,
            diasValidez: p.dias_validez,
            clienteId: p.cliente_id,
            obraId: p.obra_id,
            nombreContacto: p.nombre_contacto,
            telefonoContacto: p.telefono_contacto,
            emailContacto: p.email_contacto,
            listaPrecioId: p.lista_precio_id,
            subtotal: p.subtotal,
            descuentoGeneral: p.descuento_general,
            total: p.total,
            estado: estaVencido ? 'vencido' : p.estado,
            etapaCrm: p.etapa_crm,
            motivoPerdido: p.motivo_perdido,
            probabilidadPct: p.probabilidad_pct,
            estaVencido,
            ventaId: p.venta_id,
            observaciones: p.observaciones,
            creadoPor: p.creado_por,
            creadoEn: p.creado_en.toISOString(),
            items: [],
          };
        });
      });

      return await reply.code(200).send(lista);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 2. Detalle de presupuesto con ítems
  app.get('/presupuestos/:id', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const { id } = request.params as { id: string };
      const parsedId = uuidSchema.parse(id);

      const detalle = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        const resP = await client.query<PresupuestoRow>(
          `select * from presupuesto where id = $1 and negocio_id = $2`,
          [parsedId, user.negocioId],
        );

        if (resP.rows.length === 0) {
          return null;
        }

        const p = resP.rows[0];
        if (!p) return null;

        const resItems = await client.query<ItemPresupuestoRow>(
          `select * from item_presupuesto where presupuesto_id = $1 and negocio_id = $2 order by creado_en asc`,
          [parsedId, user.negocioId],
        );

        const hoy = new Date().toISOString().split('T')[0] ?? '';
        const estaVencido = p.estado === 'pendiente' && p.fecha_vencimiento < hoy;

        const items: ItemPresupuestoDetalle[] = resItems.rows.map((it) => ({
          id: it.id,
          presupuestoId: it.presupuesto_id,
          productoId: it.producto_id,
          codigo: it.codigo,
          nombre: it.nombre,
          unidad: it.unidad,
          cantidad: it.cantidad,
          precioUnitario: it.precio_unitario,
          descuentoPct: it.descuento_pct,
          subtotal: it.subtotal,
          notas: it.notas,
        }));

        const result: PresupuestoDetalle = {
          id: p.id,
          numero: p.numero,
          fechaEmision: p.fecha_emision.toISOString(),
          fechaVencimiento: p.fecha_vencimiento,
          diasValidez: p.dias_validez,
          clienteId: p.cliente_id,
          obraId: p.obra_id,
          nombreContacto: p.nombre_contacto,
          telefonoContacto: p.telefono_contacto,
          emailContacto: p.email_contacto,
          listaPrecioId: p.lista_precio_id,
          subtotal: p.subtotal,
          descuentoGeneral: p.descuento_general,
          total: p.total,
          estado: estaVencido ? 'vencido' : p.estado,
          etapaCrm: p.etapa_crm,
          motivoPerdido: p.motivo_perdido,
          probabilidadPct: p.probabilidad_pct,
          estaVencido,
          ventaId: p.venta_id,
          observaciones: p.observaciones,
          creadoPor: p.creado_por,
          creadoEn: p.creado_en.toISOString(),
          items,
        };

        return result;
      });

      if (!detalle) {
        return await reply.code(404).send({ error: 'Presupuesto no encontrado' });
      }

      return await reply.code(200).send(detalle);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 3. Crear nuevo presupuesto
  app.post('/presupuestos', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const input = guardarPresupuestoSchema.parse(request.body);

      const nuevo = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        // Advisory lock para número consecutivo atómico sin saltos por negocio
        await client.query(`select pg_advisory_xact_lock(hashtext('presupuesto_' || $1))`, [
          user.negocioId,
        ]);

        const numRes = await client.query<{ proximo: number }>(
          `select coalesce(max(numero), 0) + 1 as proximo from presupuesto where negocio_id = $1`,
          [user.negocioId],
        );
        const numero = numRes.rows[0]?.proximo ?? 1;

        const diasValidez = input.diasValidez;
        const fechaEmision = new Date();
        const fechaVencimiento = new Date();
        fechaVencimiento.setDate(fechaVencimiento.getDate() + diasValidez);
        const fechaVencimientoStr = fechaVencimiento.toISOString().split('T')[0];

        const presupuestoId = input.id ?? randomUUID();

        const resP = await client.query<PresupuestoRow>(
          `insert into presupuesto (
            id, negocio_id, numero, fecha_emision, fecha_vencimiento, dias_validez,
            cliente_id, obra_id, nombre_contacto, telefono_contacto, email_contacto,
            lista_precio_id, subtotal, descuento_general, total, estado,
            observaciones, creado_por
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'pendiente', $16, $17)
          returning *`,
          [
            presupuestoId,
            user.negocioId,
            numero,
            fechaEmision,
            fechaVencimientoStr,
            diasValidez,
            input.clienteId ?? null,
            input.obraId ?? null,
            input.nombreContacto ?? null,
            input.telefonoContacto ?? null,
            input.emailContacto ?? null,
            input.listaPrecioId ?? null,
            input.subtotal,
            input.descuentoGeneral,
            input.total,
            input.observaciones ?? null,
            user.usuarioId,
          ],
        );

        const pres = resP.rows[0];
        if (!pres) {
          throw new Error('Error al guardar presupuesto');
        }

        for (const it of input.items) {
          await client.query(
            `insert into item_presupuesto (
              presupuesto_id, negocio_id, producto_id, codigo, nombre, unidad,
              cantidad, precio_unitario, descuento_pct, subtotal, notas
            ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              pres.id,
              user.negocioId,
              it.productoId ?? null,
              it.codigo ?? null,
              it.nombre,
              it.unidad,
              it.cantidad,
              it.precioUnitario,
              it.descuentoPct,
              it.subtotal,
              it.notas ?? null,
            ],
          );
        }

        return pres;
      });

      return await reply.code(201).send(nuevo);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 4. Marcar presupuesto como aprobado / convertido a venta
  app.post('/presupuestos/:id/marcar-convertido', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const { id } = request.params as { id: string };
      const parsedId = uuidSchema.parse(id);

      const body = request.body as { ventaId?: string };
      const ventaId = body.ventaId ? uuidSchema.parse(body.ventaId) : null;

      const actualizado = await withTenantTransaction(pool, user.negocioId, async ({ db }) => {
        const [modificado] = await db
          .update(presupuesto)
          .set({
            estado: 'aprobado_convertido',
            ventaId: ventaId ?? undefined,
            actualizadoEn: new Date(),
          })
          .where(and(eq(presupuesto.id, parsedId), eq(presupuesto.negocioId, user.negocioId)))
          .returning();

        return modificado;
      });

      if (!actualizado) {
        return await reply.code(404).send({ error: 'Presupuesto no encontrado' });
      }

      return await reply.code(200).send(actualizado);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 5. Cancelar presupuesto
  app.post('/presupuestos/:id/cancelar', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['encargado', 'dueno']);

      const { id } = request.params as { id: string };
      const parsedId = uuidSchema.parse(id);

      const actualizado = await withTenantTransaction(pool, user.negocioId, async ({ db }) => {
        const [modificado] = await db
          .update(presupuesto)
          .set({
            estado: 'cancelado',
            actualizadoEn: new Date(),
          })
          .where(and(eq(presupuesto.id, parsedId), eq(presupuesto.negocioId, user.negocioId)))
          .returning();

        return modificado;
      });

      if (!actualizado) {
        return await reply.code(404).send({ error: 'Presupuesto no encontrado' });
      }

      return await reply.code(200).send(actualizado);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });
}
