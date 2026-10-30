import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import {
  actualizarClienteObraSchema,
  actualizarEtapaPresupuestoCrmSchema,
  crearBitacoraContactoSchema,
  crearClienteObraSchema,
  uuidSchema,
  type CategoriaRfmCliente,
  type ClienteContactoBitacoraItem,
  type ClienteObraItem,
  type PresupuestoKanbanItem,
  type SegmentacionClienteItem,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';
import { registrarAuditoria } from '../services/auditoria-service.js';

export interface CrmRoutesOptions extends FastifyPluginOptions {
  pool: Pool;
  verifyToken?: TokenVerifier | undefined;
}

interface ClienteObraRow {
  id: string;
  negocio_id: string;
  cliente_id: string;
  cliente_nombre: string;
  nombre: string;
  direccion: string | null;
  localidad: string | null;
  contacto_responsable: string | null;
  telefono_responsable: string | null;
  fecha_inicio: string | null;
  fecha_fin_estimada: string | null;
  estado: 'planificacion' | 'activa' | 'pausada' | 'finalizada';
  presupuesto_estimado: string;
  total_ventas_asociadas: string;
  cantidad_ventas: number;
  notas: string | null;
  creado_en: Date;
  actualizado_en: Date;
}

interface BitacoraRow {
  id: string;
  negocio_id: string;
  cliente_id: string;
  cliente_nombre: string;
  obra_id: string | null;
  obra_nombre: string | null;
  presupuesto_id: string | null;
  presupuesto_numero: number | null;
  tipo: 'llamada' | 'whatsapp' | 'visita_obra' | 'reunion' | 'nota';
  descripcion: string;
  proximo_contacto_fecha: string | null;
  proximo_contacto_accion: string | null;
  registrado_por: string | null;
  creado_en: Date;
}

interface PresupuestoKanbanRow {
  id: string;
  numero: number;
  fecha_emision: Date;
  fecha_vencimiento: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  obra_id: string | null;
  obra_nombre: string | null;
  subtotal: string;
  descuento_general: string;
  total: string;
  estado: string;
  etapa_crm: 'borrador' | 'enviado' | 'negociacion' | 'ganado' | 'perdido';
  motivo_perdido: string | null;
  probabilidad_pct: number;
  observaciones: string | null;
  creado_por: string | null;
  creado_en: Date;
}

interface SegmentacionRow {
  cliente_id: string;
  codigo: string;
  nombre: string;
  cuit_dni: string | null;
  telefono: string | null;
  email: string | null;
  total_historico: string;
  total_90d: string;
  cant_90d: string;
  dias_ultima_compra: number | null;
  fecha_ultima_compra: string | null;
  saldo_cta_cte: string;
  obras_activas: string;
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
  request.log.error({ err, modulo: 'crm' }, 'Error en ruta CRM');
  return await reply.code(500).send({ error: mensaje });
}

export function registerCrmRoutes(
  app: FastifyInstance,
  options: CrmRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Listar obras con filtros y totales acumulados
  app.get('/crm/obras', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const query = request.query as {
        clienteId?: string;
        estado?: string;
        q?: string;
      };

      const items = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        let sql = `
          select 
            o.id,
            o.negocio_id,
            o.cliente_id,
            c.nombre as cliente_nombre,
            o.nombre,
            o.direccion,
            o.localidad,
            o.contacto_responsable,
            o.telefono_responsable,
            o.fecha_inicio::text,
            o.fecha_fin_estimada::text,
            o.estado,
            o.presupuesto_estimado,
            coalesce((select sum(v.total) from venta v where v.obra_id = o.id and v.negocio_id = o.negocio_id and v.estado = 'confirmada'), 0.00)::text as total_ventas_asociadas,
            coalesce((select count(v.id) from venta v where v.obra_id = o.id and v.negocio_id = o.negocio_id and v.estado = 'confirmada'), 0)::int as cantidad_ventas,
            o.notas,
            o.creado_en,
            o.actualizado_en
          from cliente_obra o
          inner join cliente c on c.id = o.cliente_id and c.negocio_id = o.negocio_id
          where 1=1
        `;
        const params: unknown[] = [];

        if (query.clienteId) {
          params.push(query.clienteId);
          sql += ` and o.cliente_id = $${params.length}`;
        }

        if (query.estado) {
          params.push(query.estado);
          sql += ` and o.estado = $${params.length}`;
        }

        if (query.q) {
          params.push(`%${query.q}%`);
          sql += ` and (o.nombre ilike $${params.length} or c.nombre ilike $${params.length} or coalesce(o.direccion, '') ilike $${params.length})`;
        }

        sql += ` order by o.creado_en desc`;

        const res = await client.query<ClienteObraRow>(sql, params);
        return res.rows.map((r): ClienteObraItem => ({
          id: r.id,
          negocioId: r.negocio_id,
          clienteId: r.cliente_id,
          clienteNombre: r.cliente_nombre,
          nombre: r.nombre,
          direccion: r.direccion,
          localidad: r.localidad,
          contactoResponsable: r.contacto_responsable,
          telefonoResponsable: r.telefono_responsable,
          fechaInicio: r.fecha_inicio,
          fechaFinEstimada: r.fecha_fin_estimada,
          estado: r.estado,
          presupuestoEstimado: r.presupuesto_estimado,
          totalVentasAsociadas: r.total_ventas_asociadas,
          cantidadVentas: r.cantidad_ventas,
          notas: r.notas,
          creadoEn: r.creado_en.toISOString(),
          actualizadoEn: r.actualizado_en.toISOString(),
        }));
      });

      return await reply.code(200).send(items);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 2. Crear nueva obra
  app.post('/crm/obras', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const input = crearClienteObraSchema.parse(request.body);
      const obraId = randomUUID();

      const nuevaObra = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        // Verificar que el cliente existe en el negocio
        const resCliente = await client.query<{ id: string; nombre: string }>(
          `select id, nombre from cliente where id = $1`,
          [input.clienteId],
        );
        const cli = resCliente.rows[0];
        if (!cli) {
          throw new Error('El cliente especificado no existe');
        }

        const res = await client.query<ClienteObraRow>(
          `insert into cliente_obra (
            id, negocio_id, cliente_id, nombre, direccion, localidad,
            contacto_responsable, telefono_responsable, fecha_inicio,
            fecha_fin_estimada, estado, presupuesto_estimado, notas
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          returning *, 0.00::text as total_ventas_asociadas, 0 as cantidad_ventas, $14 as cliente_nombre`,
          [
            obraId,
            user.negocioId,
            input.clienteId,
            input.nombre,
            input.direccion ?? null,
            input.localidad ?? null,
            input.contactoResponsable ?? null,
            input.telefonoResponsable ?? null,
            input.fechaInicio ?? null,
            input.fechaFinEstimada ?? null,
            input.estado,
            input.presupuestoEstimado,
            input.notas ?? null,
            cli.nombre,
          ],
        );

        await registrarAuditoria(client, {
          negocioId: user.negocioId,
          usuarioId: user.usuarioId,
          usuarioEmail: user.email,
          rol: user.rol,
          accion: 'crear_obra',
          entidad: 'cliente_obra',
          entidadId: obraId,
          detalles: {
            nombre: input.nombre,
            clienteId: input.clienteId,
            estado: input.estado,
          },
        });

        const r = res.rows[0];
        if (!r) {
          throw new Error('Error al registrar la obra');
        }
        return {
          id: r.id,
          negocioId: r.negocio_id,
          clienteId: r.cliente_id,
          clienteNombre: cli.nombre,
          nombre: r.nombre,
          direccion: r.direccion,
          localidad: r.localidad,
          contactoResponsable: r.contacto_responsable,
          telefonoResponsable: r.telefono_responsable,
          fechaInicio: r.fecha_inicio,
          fechaFinEstimada: r.fecha_fin_estimada,
          estado: r.estado,
          presupuestoEstimado: r.presupuesto_estimado,
          totalVentasAsociadas: '0.00',
          cantidadVentas: 0,
          notas: r.notas,
          creadoEn: r.creado_en.toISOString(),
          actualizadoEn: r.actualizado_en.toISOString(),
        };
      });

      return await reply.code(201).send(nuevaObra);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 3. Actualizar obra
  app.patch('/crm/obras/:id', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const { id } = request.params as { id: string };
      uuidSchema.parse(id);

      const input = actualizarClienteObraSchema.parse(request.body);

      const actualizada = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        const check = await client.query<{ id: string }>(
          `select id from cliente_obra where id = $1`,
          [id],
        );
        if (check.rows.length === 0) {
          return null;
        }

        const updates: string[] = ['actualizado_en = now()'];
        const values: unknown[] = [id];

        if (input.nombre !== undefined) {
          values.push(input.nombre);
          updates.push(`nombre = $${values.length}`);
        }
        if (input.direccion !== undefined) {
          values.push(input.direccion);
          updates.push(`direccion = $${values.length}`);
        }
        if (input.localidad !== undefined) {
          values.push(input.localidad);
          updates.push(`localidad = $${values.length}`);
        }
        if (input.contactoResponsable !== undefined) {
          values.push(input.contactoResponsable);
          updates.push(`contacto_responsable = $${values.length}`);
        }
        if (input.telefonoResponsable !== undefined) {
          values.push(input.telefonoResponsable);
          updates.push(`telefono_responsable = $${values.length}`);
        }
        if (input.fechaInicio !== undefined) {
          values.push(input.fechaInicio);
          updates.push(`fecha_inicio = $${values.length}`);
        }
        if (input.fechaFinEstimada !== undefined) {
          values.push(input.fechaFinEstimada);
          updates.push(`fecha_fin_estimada = $${values.length}`);
        }
        if (input.estado !== undefined) {
          values.push(input.estado);
          updates.push(`estado = $${values.length}`);
        }
        if (input.presupuestoEstimado !== undefined) {
          values.push(input.presupuestoEstimado);
          updates.push(`presupuesto_estimado = $${values.length}`);
        }
        if (input.notas !== undefined) {
          values.push(input.notas);
          updates.push(`notas = $${values.length}`);
        }

        const sql = `
          update cliente_obra
          set ${updates.join(', ')}
          where id = $1
          returning *
        `;

        const res = await client.query<ClienteObraRow>(sql, values);
        const r = res.rows[0];
        if (!r) return null;

        await registrarAuditoria(client, {
          negocioId: user.negocioId,
          usuarioId: user.usuarioId,
          usuarioEmail: user.email,
          rol: user.rol,
          accion: 'actualizar_obra',
          entidad: 'cliente_obra',
          entidadId: id,
          detalles: { ...input },
        });

        const cliRes = await client.query<{ nombre: string }>(
          `select nombre from cliente where id = $1`,
          [r.cliente_id],
        );
        const cliNombre = cliRes.rows[0]?.nombre ?? '';

        return {
          id: r.id,
          negocioId: r.negocio_id,
          clienteId: r.cliente_id,
          clienteNombre: cliNombre,
          nombre: r.nombre,
          direccion: r.direccion,
          localidad: r.localidad,
          contactoResponsable: r.contacto_responsable,
          telefonoResponsable: r.telefono_responsable,
          fechaInicio: r.fecha_inicio,
          fechaFinEstimada: r.fecha_fin_estimada,
          estado: r.estado,
          presupuestoEstimado: r.presupuesto_estimado,
          totalVentasAsociadas: '0.00',
          cantidadVentas: 0,
          notas: r.notas,
          creadoEn: r.creado_en.toISOString(),
          actualizadoEn: r.actualizado_en.toISOString(),
        };
      });

      if (!actualizada) {
        return await reply.code(404).send({ error: 'Obra no encontrada' });
      }

      return await reply.code(200).send(actualizada);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 4. Listar bitácora de seguimiento comercial
  app.get('/crm/bitacora', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const query = request.query as {
        clienteId?: string;
        obraId?: string;
        presupuestoId?: string;
        limite?: string;
      };

      const limite = Math.min(100, Math.max(1, parseInt(query.limite ?? '50', 10) || 50));

      const items = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        let sql = `
          select 
            b.id,
            b.negocio_id,
            b.cliente_id,
            c.nombre as cliente_nombre,
            b.obra_id,
            o.nombre as obra_nombre,
            b.presupuesto_id,
            p.numero as presupuesto_numero,
            b.tipo,
            b.descripcion,
            b.proximo_contacto_fecha::text,
            b.proximo_contacto_accion,
            b.registrado_por,
            b.creado_en
          from cliente_contacto_bitacora b
          inner join cliente c on c.id = b.cliente_id and c.negocio_id = b.negocio_id
          left join cliente_obra o on o.id = b.obra_id and o.negocio_id = b.negocio_id
          left join presupuesto p on p.id = b.presupuesto_id and p.negocio_id = b.negocio_id
          where 1=1
        `;
        const params: unknown[] = [];

        if (query.clienteId) {
          params.push(query.clienteId);
          sql += ` and b.cliente_id = $${params.length}`;
        }
        if (query.obraId) {
          params.push(query.obraId);
          sql += ` and b.obra_id = $${params.length}`;
        }
        if (query.presupuestoId) {
          params.push(query.presupuestoId);
          sql += ` and b.presupuesto_id = $${params.length}`;
        }

        params.push(limite);
        sql += ` order by b.creado_en desc limit $${params.length}`;

        const res = await client.query<BitacoraRow>(sql, params);
        return res.rows.map((r): ClienteContactoBitacoraItem => ({
          id: r.id,
          negocioId: r.negocio_id,
          clienteId: r.cliente_id,
          clienteNombre: r.cliente_nombre,
          obraId: r.obra_id,
          obraNombre: r.obra_nombre,
          presupuestoId: r.presupuesto_id,
          presupuestoNumero: r.presupuesto_numero,
          tipo: r.tipo,
          descripcion: r.descripcion,
          proximoContactoFecha: r.proximo_contacto_fecha,
          proximoContactoAccion: r.proximo_contacto_accion,
          registradoPor: r.registrado_por,
          creadoEn: r.creado_en.toISOString(),
        }));
      });

      return await reply.code(200).send(items);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 5. Registrar nota o contacto en la bitácora
  app.post('/crm/bitacora', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const input = crearBitacoraContactoSchema.parse(request.body);
      const bitacoraId = randomUUID();

      const item = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        const cliRes = await client.query<{ id: string; nombre: string }>(
          `select id, nombre from cliente where id = $1`,
          [input.clienteId],
        );
        const cli = cliRes.rows[0];
        if (!cli) {
          throw new Error('El cliente no existe');
        }

        let obraNombre: string | null = null;
        if (input.obraId) {
          const oRes = await client.query<{ nombre: string }>(
            `select nombre from cliente_obra where id = $1`,
            [input.obraId],
          );
          obraNombre = oRes.rows[0]?.nombre ?? null;
        }

        let presupuestoNumero: number | null = null;
        if (input.presupuestoId) {
          const pRes = await client.query<{ numero: number }>(
            `select numero from presupuesto where id = $1`,
            [input.presupuestoId],
          );
          presupuestoNumero = pRes.rows[0]?.numero ?? null;
        }

        const res = await client.query<BitacoraRow>(
          `insert into cliente_contacto_bitacora (
            id, negocio_id, cliente_id, obra_id, presupuesto_id,
            tipo, descripcion, proximo_contacto_fecha, proximo_contacto_accion, registrado_por
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          returning *`,
          [
            bitacoraId,
            user.negocioId,
            input.clienteId,
            input.obraId ?? null,
            input.presupuestoId ?? null,
            input.tipo,
            input.descripcion,
            input.proximoContactoFecha ?? null,
            input.proximoContactoAccion ?? null,
            user.email ?? user.rol,
          ],
        );

        await registrarAuditoria(client, {
          negocioId: user.negocioId,
          usuarioId: user.usuarioId,
          usuarioEmail: user.email,
          rol: user.rol,
          accion: 'crear_bitacora_contacto',
          entidad: 'crm_bitacora',
          entidadId: bitacoraId,
          detalles: {
            tipo: input.tipo,
            clienteId: input.clienteId,
            obraId: input.obraId,
          },
        });

        const r = res.rows[0];
        if (!r) {
          throw new Error('Error al registrar la obra');
        }
        return {
          id: r.id,
          negocioId: r.negocio_id,
          clienteId: r.cliente_id,
          clienteNombre: cli.nombre,
          obraId: r.obra_id,
          obraNombre,
          presupuestoId: r.presupuesto_id,
          presupuestoNumero,
          tipo: r.tipo,
          descripcion: r.descripcion,
          proximoContactoFecha: r.proximo_contacto_fecha,
          proximoContactoAccion: r.proximo_contacto_accion,
          registradoPor: r.registrado_por,
          creadoEn: r.creado_en.toISOString(),
        };
      });

      return await reply.code(201).send(item);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 6. Pipeline Kanban de Presupuestos
  app.get('/crm/pipeline', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const query = request.query as {
        obraId?: string;
        clienteId?: string;
      };

      const lista = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        let sql = `
          select 
            p.id,
            p.numero,
            p.fecha_emision,
            p.fecha_vencimiento::text,
            p.cliente_id,
            c.nombre as cliente_nombre,
            c.telefono as cliente_telefono,
            p.obra_id,
            o.nombre as obra_nombre,
            p.subtotal,
            p.descuento_general,
            p.total,
            p.estado,
            coalesce(p.etapa_crm, 'enviado') as etapa_crm,
            p.motivo_perdido,
            coalesce(p.probabilidad_pct, 50) as probabilidad_pct,
            p.observaciones,
            p.creado_por,
            p.creado_en
          from presupuesto p
          left join cliente c on c.id = p.cliente_id and c.negocio_id = p.negocio_id
          left join cliente_obra o on o.id = p.obra_id and o.negocio_id = p.negocio_id
          where 1=1
        `;
        const params: unknown[] = [];

        if (query.obraId) {
          params.push(query.obraId);
          sql += ` and p.obra_id = $${params.length}`;
        }
        if (query.clienteId) {
          params.push(query.clienteId);
          sql += ` and p.cliente_id = $${params.length}`;
        }

        sql += ` order by p.fecha_emision desc limit 200`;

        const res = await client.query<PresupuestoKanbanRow>(sql, params);
        return res.rows.map((r): PresupuestoKanbanItem => ({
          id: r.id,
          numero: r.numero,
          fechaEmision: r.fecha_emision.toISOString(),
          fechaVencimiento: r.fecha_vencimiento,
          clienteId: r.cliente_id,
          clienteNombre: r.cliente_nombre,
          clienteTelefono: r.cliente_telefono,
          obraId: r.obra_id,
          obraNombre: r.obra_nombre,
          subtotal: r.subtotal,
          descuentoGeneral: r.descuento_general,
          total: r.total,
          estado: r.estado,
          etapaCrm: r.etapa_crm,
          motivoPerdido: r.motivo_perdido,
          probabilidadPct: r.probabilidad_pct,
          observaciones: r.observaciones,
          creadoPor: r.creado_por,
          creadoEn: r.creado_en.toISOString(),
        }));
      });

      return await reply.code(200).send(lista);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 7. Cambiar etapa Kanban de Presupuesto
  app.patch('/crm/pipeline/:id/etapa', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const { id } = request.params as { id: string };
      uuidSchema.parse(id);

      const input = actualizarEtapaPresupuestoCrmSchema.parse(request.body);

      const actualizado = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        const check = await client.query<{ id: string; numero: number; estado: string }>(
          `select id, numero, estado from presupuesto where id = $1`,
          [id],
        );
        const pres = check.rows[0];
        if (!pres) return null;

        // Si se marca ganado, sincronizamos estado a aprobado_convertido si no lo estaba
        const nuevoEstado = input.etapaCrm === 'ganado' ? 'aprobado_convertido' : pres.estado;

        const res = await client.query<{ id: string }>(
          `update presupuesto
           set etapa_crm = $1,
               motivo_perdido = $2,
               probabilidad_pct = coalesce($3, probabilidad_pct),
               estado = $4,
               actualizado_en = now()
           where id = $5
           returning id`,
          [
            input.etapaCrm,
            input.motivoPerdido ?? null,
            input.probabilidadPct ?? null,
            nuevoEstado,
            id,
          ],
        );

        await registrarAuditoria(client, {
          negocioId: user.negocioId,
          usuarioId: user.usuarioId,
          usuarioEmail: user.email,
          rol: user.rol,
          accion: 'cambiar_etapa_crm',
          entidad: 'presupuesto',
          entidadId: id,
          detalles: {
            numero: pres.numero,
            etapaCrm: input.etapaCrm,
            motivoPerdido: input.motivoPerdido,
            probabilidadPct: input.probabilidadPct,
          },
        });

        return res.rows[0] ?? null;
      });

      if (!actualizado) {
        return await reply.code(404).send({ error: 'Presupuesto no encontrado' });
      }

      return await reply.code(200).send({ ok: true, etapaCrm: input.etapaCrm });
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });

  // 8. Segmentación Comercial de Clientes (Matriz RFM & Alertas)
  app.get('/crm/segmentacion', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['cajero', 'encargado', 'dueno']);

      const items = await withTenantTransaction(pool, user.negocioId, async ({ client }) => {
        const sql = `
          select 
            c.id as cliente_id,
            c.codigo,
            c.nombre,
            c.cuit_dni,
            c.telefono,
            c.email,
            coalesce(sum(v.total) filter (where v.estado = 'confirmada'), 0.00)::text as total_historico,
            coalesce(sum(v.total) filter (where v.estado = 'confirmada' and v.creado_en >= now() - interval '90 days'), 0.00)::text as total_90d,
            count(v.id) filter (where v.estado = 'confirmada' and v.creado_en >= now() - interval '90 days')::text as cant_90d,
            extract(day from now() - max(v.creado_en) filter (where v.estado = 'confirmada'))::int as dias_ultima_compra,
            max(v.creado_en) filter (where v.estado = 'confirmada')::text as fecha_ultima_compra,
            coalesce((select sc.saldo_deudor from v_saldo_cliente sc where sc.cliente_id = c.id and sc.negocio_id = c.negocio_id), 0.00)::text as saldo_cta_cte,
            (select count(id) from cliente_obra co where co.cliente_id = c.id and co.estado = 'activa')::text as obras_activas
          from cliente c
          left join venta v on v.cliente_id = c.id and v.negocio_id = c.negocio_id
          where c.activo = true
          group by c.id
          order by coalesce(sum(v.total) filter (where v.estado = 'confirmada' and v.creado_en >= now() - interval '90 days'), 0) desc
        `;

        const res = await client.query<SegmentacionRow>(sql);

        return res.rows.map((r): SegmentacionClienteItem => {
          const tot90 = parseFloat(r.total_90d) || 0;
          const cant90 = parseInt(r.cant_90d, 10) || 0;
          const diasUltima = r.dias_ultima_compra;

          let cat: CategoriaRfmCliente = 'regular';
          if (tot90 >= 500000 || cant90 >= 10) {
            cat = 'vip';
          } else if (cant90 >= 3 && tot90 > 0) {
            cat = 'frecuente';
          } else if (diasUltima !== null && diasUltima > 30) {
            cat = diasUltima > 90 ? 'inactivo' : 'riesgo_abandono';
          } else if (diasUltima === null) {
            cat = 'inactivo';
          }

          return {
            clienteId: r.cliente_id,
            codigo: r.codigo,
            nombre: r.nombre,
            cuitDni: r.cuit_dni,
            telefono: r.telefono,
            email: r.email,
            categoriaRfm: cat,
            totalComprasHistorico: r.total_historico,
            totalComprasUltimos90Dias: r.total_90d,
            cantidadComprasUltimos90Dias: cant90,
            diasDesdeUltimaCompra: diasUltima,
            ultimaCompraFecha: r.fecha_ultima_compra,
            saldoCtaCte: r.saldo_cta_cte,
            obrasActivas: parseInt(r.obras_activas, 10) || 0,
          };
        });
      });

      return await reply.code(200).send(items);
    } catch (err: unknown) {
      return await handleRouteError(err, request, reply);
    }
  });
}
