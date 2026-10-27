import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import {
  actualizarDepositoSchema,
  crearDepositoSchema,
  crearTransferenciaStockSchema,
  uuidSchema,
  type DepositoItem,
  type ItemTransferenciaStockDetalle,
  type StockPorDepositoItem,
  type TransferenciaStockCompleta,
  type TransferenciaStockResumen,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';
import { registrarAuditoria } from '../services/auditoria-service.js';

export interface DepositosRoutesOptions {
  pool: pg.Pool;
  verifyToken?: TokenVerifier | undefined;
}

interface SqlRowDeposito {
  id: string;
  nombre: string;
  codigo: string;
  direccion: string | null;
  es_principal: boolean;
  activo: boolean;
  creado_en: string;
}

interface SqlRowStockDeposito {
  producto_id: string;
  producto_codigo: string;
  producto_nombre: string;
  producto_marca: string | null;
  unidad_principal: string;
  deposito_id: string;
  deposito_codigo: string;
  deposito_nombre: string;
  stock_actual_base: string;
}

interface SqlRowTransferenciaResumen {
  id: string;
  numero: string;
  deposito_origen_id: string;
  deposito_origen_nombre: string;
  deposito_destino_id: string;
  deposito_destino_nombre: string;
  estado: 'pendiente' | 'en_transito' | 'completada' | 'cancelada';
  motivo: string | null;
  observaciones: string | null;
  creado_por: string;
  creado_en: string;
  completado_en: string | null;
  total_articulos: number;
}

interface SqlRowItemTransferencia {
  id: string;
  producto_id: string;
  producto_codigo: string;
  producto_nombre: string;
  cantidad: string;
  unidad: string;
  cantidad_base: string;
  notas: string | null;
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
      error: 'Datos de depósitos inválidos',
      detalles: err.issues,
    });
  }
  request.log.error({ err, modulo: 'depositos' }, 'Error en ruta de depósitos');
  const msg = err instanceof Error ? err.message : 'Error interno del servidor';
  return reply.code(500).send({ error: msg });
}

export function registerDepositosRoutes(
  app: FastifyInstance,
  options: DepositosRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Listar depósitos del negocio
  app.get('/depositos', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const depositos = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }): Promise<DepositoItem[]> => {
          const res = await client.query<SqlRowDeposito>(
            `select
               id, nombre, codigo, direccion, es_principal, activo,
               to_char(creado_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as creado_en
             from deposito
             where negocio_id = $1
             order by es_principal desc, nombre asc`,
            [claims.negocioId],
          );

          return res.rows.map((r) => ({
            id: r.id,
            nombre: r.nombre,
            codigo: r.codigo,
            direccion: r.direccion,
            esPrincipal: r.es_principal,
            activo: r.activo,
            creadoEn: r.creado_en,
          }));
        },
      );

      return await reply.send(depositos);
    } catch (err) {
      return handleRouteError(err, request, reply);
    }
  });

  // 2. Crear un nuevo depósito (dueño o encargado)
  app.post('/depositos', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno', 'encargado']);
      const body = crearDepositoSchema.parse(request.body);

      const nuevo = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }): Promise<DepositoItem> => {
          if (body.esPrincipal) {
            await client.query(
              `update deposito set es_principal = false where negocio_id = $1`,
              [claims.negocioId],
            );
          }

          const nuevoId = randomUUID();
          const res = await client.query<SqlRowDeposito>(
            `insert into deposito (id, negocio_id, nombre, codigo, direccion, es_principal)
             values ($1, $2, $3, $4, $5, $6)
             returning
               id, nombre, codigo, direccion, es_principal, activo,
               to_char(creado_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as creado_en`,
            [
              nuevoId,
              claims.negocioId,
              body.nombre.trim(),
              body.codigo.trim().toUpperCase(),
              body.direccion?.trim() || null,
              body.esPrincipal,
            ],
          );

          const r = res.rows[0];
          if (!r) throw new Error('No se pudo crear el depósito');

          await registrarAuditoria(client, {
            negocioId: claims.negocioId,
            usuarioId: claims.usuarioId,
            rol: claims.rol,
            accion: 'crear_deposito',
            entidad: 'deposito',
            entidadId: r.id,
            detalles: { nombre: r.nombre, codigo: r.codigo },
          });

          return {
            id: r.id,
            nombre: r.nombre,
            codigo: r.codigo,
            direccion: r.direccion,
            esPrincipal: r.es_principal,
            activo: r.activo,
            creadoEn: r.creado_en,
          };
        },
      );

      return await reply.code(201).send(nuevo);
    } catch (err) {
      return handleRouteError(err, request, reply);
    }
  });

  // 3. Editar o activar/desactivar depósito
  app.patch('/depositos/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno', 'encargado']);
      const { id } = request.params as { id: string };
      uuidSchema.parse(id);
      const body = actualizarDepositoSchema.parse(request.body);

      const editado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }): Promise<DepositoItem> => {
          const campos: string[] = [];
          const valores: unknown[] = [id, claims.negocioId];

          if (body.nombre !== undefined) {
            valores.push(body.nombre.trim());
            campos.push(`nombre = $${valores.length}`);
          }
          if (body.direccion !== undefined) {
            valores.push(body.direccion ? body.direccion.trim() : null);
            campos.push(`direccion = $${valores.length}`);
          }
          if (body.esPrincipal !== undefined) {
            if (body.esPrincipal) {
              await client.query(
                `update deposito set es_principal = false where negocio_id = $1`,
                [claims.negocioId],
              );
            }
            valores.push(body.esPrincipal);
            campos.push(`es_principal = $${valores.length}`);
          }
          if (body.activo !== undefined) {
            valores.push(body.activo);
            campos.push(`activo = $${valores.length}`);
          }

          if (campos.length === 0) {
            throw new Error('No se enviaron campos a modificar');
          }

          const res = await client.query<SqlRowDeposito>(
            `update deposito set ${campos.join(', ')}
             where id = $1 and negocio_id = $2
             returning
               id, nombre, codigo, direccion, es_principal, activo,
               to_char(creado_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as creado_en`,
            valores,
          );

          const r = res.rows[0];
          if (!r) throw new Error('Depósito no encontrado');

          return {
            id: r.id,
            nombre: r.nombre,
            codigo: r.codigo,
            direccion: r.direccion,
            esPrincipal: r.es_principal,
            activo: r.activo,
            creadoEn: r.creado_en,
          };
        },
      );

      return await reply.send(editado);
    } catch (err) {
      return handleRouteError(err, request, reply);
    }
  });

  // 4. Stock actual por depósito
  app.get('/depositos/:id/stock', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const { id } = request.params as { id: string };
      uuidSchema.parse(id);

      const items = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }): Promise<StockPorDepositoItem[]> => {
          const res = await client.query<SqlRowStockDeposito>(
            `select
               producto_id, producto_codigo, producto_nombre, producto_marca, unidad_principal,
               deposito_id, deposito_codigo, deposito_nombre, stock_actual_base::text
             from v_stock_por_deposito
             where negocio_id = $1 and deposito_id = $2
             order by producto_nombre asc`,
            [claims.negocioId, id],
          );

          return res.rows.map((r) => ({
            productoId: r.producto_id,
            productoCodigo: r.producto_codigo,
            productoNombre: r.producto_nombre,
            productoMarca: r.producto_marca,
            unidadPrincipal: r.unidad_principal,
            depositoId: r.deposito_id,
            depositoCodigo: r.deposito_codigo,
            depositoNombre: r.deposito_nombre,
            stockActualBase: r.stock_actual_base,
          }));
        },
      );

      return await reply.send(items);
    } catch (err) {
      return handleRouteError(err, request, reply);
    }
  });

  // 5. Listar transferencias de stock
  app.get('/depositos/transferencias', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const transferencias = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }): Promise<TransferenciaStockResumen[]> => {
          const res = await client.query<SqlRowTransferenciaResumen>(
            `select
               t.id, t.numero, t.deposito_origen_id, dor.nombre as deposito_origen_nombre,
               t.deposito_destino_id, dde.nombre as deposito_destino_nombre,
               t.estado, t.motivo, t.observaciones, t.creado_por,
               to_char(t.creado_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as creado_en,
               to_char(t.completado_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as completado_en,
               count(it.id)::int as total_articulos
             from transferencia_stock t
             join deposito dor on dor.id = t.deposito_origen_id and dor.negocio_id = t.negocio_id
             join deposito dde on dde.id = t.deposito_destino_id and dde.negocio_id = t.negocio_id
             left join item_transferencia_stock it on it.transferencia_id = t.id and it.negocio_id = t.negocio_id
             where t.negocio_id = $1
             group by t.id, t.numero, t.deposito_origen_id, dor.nombre, t.deposito_destino_id, dde.nombre,
                      t.estado, t.motivo, t.observaciones, t.creado_por, t.creado_en, t.completado_en
             order by t.creado_en desc`,
            [claims.negocioId],
          );

          return res.rows.map((r) => ({
            id: r.id,
            numero: r.numero,
            depositoOrigenId: r.deposito_origen_id,
            depositoOrigenNombre: r.deposito_origen_nombre,
            depositoDestinoId: r.deposito_destino_id,
            depositoDestinoNombre: r.deposito_destino_nombre,
            estado: r.estado,
            motivo: r.motivo,
            observaciones: r.observaciones,
            creadoPor: r.creado_por,
            creadoEn: r.creado_en,
            completadoEn: r.completado_en,
            totalArticulos: r.total_articulos,
          }));
        },
      );

      return await reply.send(transferencias);
    } catch (err) {
      return handleRouteError(err, request, reply);
    }
  });

  // 6. Detalle de transferencia
  app.get('/depositos/transferencias/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const { id } = request.params as { id: string };
      uuidSchema.parse(id);

      const detalle = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }): Promise<TransferenciaStockCompleta> => {
          const resHead = await client.query<SqlRowTransferenciaResumen>(
            `select
               t.id, t.numero, t.deposito_origen_id, dor.nombre as deposito_origen_nombre,
               t.deposito_destino_id, dde.nombre as deposito_destino_nombre,
               t.estado, t.motivo, t.observaciones, t.creado_por,
               to_char(t.creado_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as creado_en,
               to_char(t.completado_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as completado_en,
               0 as total_articulos
             from transferencia_stock t
             join deposito dor on dor.id = t.deposito_origen_id and dor.negocio_id = t.negocio_id
             join deposito dde on dde.id = t.deposito_destino_id and dde.negocio_id = t.negocio_id
             where t.id = $1 and t.negocio_id = $2`,
            [id, claims.negocioId],
          );

          const head = resHead.rows[0];
          if (!head) throw new Error('Transferencia no encontrada');

          const resItems = await client.query<SqlRowItemTransferencia>(
            `select
               it.id, it.producto_id, p.codigo as producto_codigo, p.nombre as producto_nombre,
               it.cantidad::text, it.unidad, it.cantidad_base::text, it.notas
             from item_transferencia_stock it
             join producto p on p.id = it.producto_id and p.negocio_id = it.negocio_id
             where it.transferencia_id = $1 and it.negocio_id = $2
             order by p.nombre asc`,
            [id, claims.negocioId],
          );

          const items: ItemTransferenciaStockDetalle[] = resItems.rows.map((i) => ({
            id: i.id,
            productoId: i.producto_id,
            productoCodigo: i.producto_codigo,
            productoNombre: i.producto_nombre,
            cantidad: i.cantidad,
            unidad: i.unidad,
            cantidadBase: i.cantidad_base,
            notas: i.notas,
          }));

          return {
            id: head.id,
            numero: head.numero,
            depositoOrigenId: head.deposito_origen_id,
            depositoOrigenNombre: head.deposito_origen_nombre,
            depositoDestinoId: head.deposito_destino_id,
            depositoDestinoNombre: head.deposito_destino_nombre,
            estado: head.estado,
            motivo: head.motivo,
            observaciones: head.observaciones,
            creadoPor: head.creado_por,
            creadoEn: head.creado_en,
            completadoEn: head.completado_en,
            items,
          };
        },
      );

      return await reply.send(detalle);
    } catch (err) {
      return handleRouteError(err, request, reply);
    }
  });

  // 7. Crear transferencia (atómica con movimientos de stock)
  app.post('/depositos/transferencias', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const body = crearTransferenciaStockSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          // Validar existencia de ambos depósitos
          const depRes = await client.query<{ id: string; nombre: string }>(
            `select id, nombre from deposito where id in ($1, $2) and negocio_id = $3 and activo = true`,
            [body.depositoOrigenId, body.depositoDestinoId, claims.negocioId],
          );
          if (depRes.rows.length !== 2) {
            throw new Error('Uno o ambos depósitos no existen o están inactivos.');
          }

          // Generar número correlativo
          const countRes = await client.query<{ count: string }>(
            `select count(*)::text as count from transferencia_stock where negocio_id = $1`,
            [claims.negocioId],
          );
          const seq = (parseInt(countRes.rows[0]?.count ?? '0', 10) + 1)
            .toString()
            .padStart(4, '0');
          const numero = `TRF-${seq}`;
          const trfId = randomUUID();

          // Insertar cabecera
          await client.query(
            `insert into transferencia_stock
               (id, negocio_id, numero, deposito_origen_id, deposito_destino_id, estado, motivo, observaciones, creado_por, completado_en)
             values ($1, $2, $3, $4, $5, 'completada', $6, $7, $8, now())`,
            [
              trfId,
              claims.negocioId,
              numero,
              body.depositoOrigenId,
              body.depositoDestinoId,
              body.motivo ?? null,
              body.observaciones ?? null,
              claims.usuarioId,
            ],
          );

          // Insertar ítems y movimientos de stock correspondientes
          for (const it of body.items) {
            const itemId = randomUUID();
            await client.query(
              `insert into item_transferencia_stock
                 (id, negocio_id, transferencia_id, producto_id, cantidad, unidad, cantidad_base, notas)
               values ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                itemId,
                claims.negocioId,
                trfId,
                it.productoId,
                it.cantidad,
                it.unidad,
                it.cantidadBase,
                it.notas ?? null,
              ],
            );

            // 1. Movimiento OUT en depósito origen
            await client.query(
              `insert into movimiento_stock
                 (negocio_id, producto_id, deposito_id, tipo, sentido, cantidad, unidad, cantidad_base, costo_unitario, notas, creado_por)
               values ($1, $2, $3, 'transferencia_origen', 'out', $4, $5, $6, '0.00', $7, $8)`,
              [
                claims.negocioId,
                it.productoId,
                body.depositoOrigenId,
                it.cantidad,
                it.unidad,
                it.cantidadBase,
                `Transferencia ${numero} hacia depósito destino`,
                claims.usuarioId,
              ],
            );

            // 2. Movimiento IN en depósito destino
            await client.query(
              `insert into movimiento_stock
                 (negocio_id, producto_id, deposito_id, tipo, sentido, cantidad, unidad, cantidad_base, costo_unitario, notas, creado_por)
               values ($1, $2, $3, 'transferencia_destino', 'in', $4, $5, $6, '0.00', $7, $8)`,
              [
                claims.negocioId,
                it.productoId,
                body.depositoDestinoId,
                it.cantidad,
                it.unidad,
                it.cantidadBase,
                `Transferencia ${numero} desde depósito origen`,
                claims.usuarioId,
              ],
            );
          }

          await registrarAuditoria(client, {
            negocioId: claims.negocioId,
            usuarioId: claims.usuarioId,
            rol: claims.rol,
            accion: 'crear_transferencia_stock',
            entidad: 'transferencia_stock',
            entidadId: trfId,
            detalles: { numero, totalArticulos: body.items.length },
          });

          return {
            id: trfId,
            numero,
            estado: 'completada',
            mensaje: `Transferencia ${numero} procesada exitosamente.`,
          };
        },
      );

      return await reply.code(201).send(resultado);
    } catch (err) {
      return handleRouteError(err, request, reply);
    }
  });
}
