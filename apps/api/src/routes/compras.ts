import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import {
  ajusteCtaCteProveedorSchema,
  guardarOrdenCompraSchema,
  guardarProveedorSchema,
  recibirOrdenCompraSchema,
  registrarPagoProveedorSchema,
} from '@ferreteria/shared';
import { withTenantTransaction } from '../db/context.js';
import { registrarAsientoAutomatico } from '../services/contabilidad-service.js';
import { registrarAuditoria } from '../services/auditoria-service.js';
import {
  categoria,
  itemOrdenCompra,
  medioPago,
  movimiento,
  movimientoCtaCteProveedor,
  movimientoStock,
  ordenCompra,
  producto,
  proveedor,
  turnoCaja,
} from '../db/schema.js';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';

export interface ComprasRoutesOptions extends FastifyPluginOptions {
  pool: Pool;
  verifyToken?: TokenVerifier | undefined;
}

export interface SaldoProveedorRow {
  id: string;
  codigo: string;
  razonSocial: string;
  nombreFantasia: string | null;
  cuit: string | null;
  condicionIva: string;
  telefono: string | null;
  email: string | null;
  contactoNombre: string | null;
  diasPlazoPago: number;
  activo: boolean;
  totalCompras: string;
  totalPagos: string;
  saldoDeudor: string;
}

export interface MovimientoCtaCteProveedorRow {
  id: string;
  tipo: string;
  sentido: string;
  monto: string;
  descripcion: string | null;
  ordenCompraId: string | null;
  movimientoCajaId: string | null;
  revierteId: string | null;
  creadoEn: string;
  usuarioNombre: string | null;
}

export interface OrdenCompraRow {
  id: string;
  numero: string;
  proveedorId: string;
  proveedorNombre: string;
  estado: string;
  condicionPago: string;
  fechaEmision: string;
  fechaEsperada: string | null;
  fechaRecepcion: string | null;
  total: string;
  notas: string | null;
  creadoEn: string;
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
  request.log.error({ err, modulo: 'compras' }, 'Error en ruta de compras/proveedores');
  return reply.code(500).send({ error: 'Error interno del servidor' });
}

export function registerComprasRoutes(
  app: FastifyInstance,
  options: ComprasRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Listar proveedores con saldo y filtros
  app.get('/proveedores', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const query = request.query as {
        q?: string;
        soloConDeuda?: string;
      };

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          let sqlQuery = `
            select
              v.proveedor_id as id,
              v.codigo,
              v.razon_social as "razonSocial",
              v.nombre_fantasia as "nombreFantasia",
              v.cuit,
              v.condicion_iva as "condicionIva",
              v.telefono,
              v.email,
              v.contacto_nombre as "contactoNombre",
              v.dias_plazo_pago as "diasPlazoPago",
              v.activo,
              v.total_compras as "totalCompras",
              v.total_pagos as "totalPagos",
              v.saldo_deudor as "saldoDeudor"
            from v_saldo_proveedor v
            where v.negocio_id = $1
          `;
          const params: unknown[] = [claims.negocioId];

          if (query.q && query.q.trim()) {
            params.push(`%${query.q.trim()}%`);
            sqlQuery += ` and (v.razon_social ilike $${params.length} or v.nombre_fantasia ilike $${params.length} or v.codigo ilike $${params.length} or v.cuit ilike $${params.length})`;
          }

          if (query.soloConDeuda === 'true') {
            sqlQuery += ` and v.saldo_deudor > 0`;
          }

          sqlQuery += ` order by v.razon_social asc`;

          const res = await client.query<SaldoProveedorRow>(sqlQuery, params);
          return res.rows;
        },
      );

      return await reply.send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 2. Obtener un proveedor en detalle
  app.get('/proveedores/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const { id } = request.params as { id: string };

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const resSaldo = await client.query<SaldoProveedorRow>(
            `select
              v.proveedor_id as id,
              v.codigo,
              v.razon_social as "razonSocial",
              v.nombre_fantasia as "nombreFantasia",
              v.cuit,
              v.condicion_iva as "condicionIva",
              v.telefono,
              v.email,
              v.contacto_nombre as "contactoNombre",
              v.dias_plazo_pago as "diasPlazoPago",
              v.activo,
              v.total_compras as "totalCompras",
              v.total_pagos as "totalPagos",
              v.saldo_deudor as "saldoDeudor"
            from v_saldo_proveedor v
            where v.proveedor_id = $1 and v.negocio_id = $2`,
            [id, claims.negocioId],
          );

          const prov = resSaldo.rows[0];
          if (!prov) {
            throw new AuthError('Proveedor no encontrado', 404);
          }

          return prov;
        },
      );

      return await reply.send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 3. Crear proveedor
  app.post('/proveedores', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const body = guardarProveedorSchema.parse(request.body);

      const nuevo = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db, client }) => {
          let codigo = body.codigo;
          if (!codigo || !codigo.trim()) {
            const countRes = await client.query<{ total: string }>(
              'select count(*)::text as total from proveedor where negocio_id = $1',
              [claims.negocioId],
            );
            const proximoNumero = (Number(countRes.rows[0]?.total ?? '0') + 1)
              .toString()
              .padStart(3, '0');
            codigo = `PRV-${proximoNumero}`;
          }

          const [insertado] = await db
            .insert(proveedor)
            .values({
              id: body.id,
              negocioId: claims.negocioId,
              codigo,
              razonSocial: body.razonSocial,
              nombreFantasia: body.nombreFantasia || null,
              cuit: body.cuit || null,
              condicionIva: body.condicionIva,
              telefono: body.telefono || null,
              email: body.email || null,
              direccion: body.direccion || null,
              contactoNombre: body.contactoNombre || null,
              diasPlazoPago: body.diasPlazoPago,
              activo: body.activo,
              notas: body.notas || null,
            })
            .returning();

          return insertado;
        },
      );

      return await reply.code(201).send(nuevo);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 4. Editar proveedor
  app.put('/proveedores/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const { id } = request.params as { id: string };
      const body = guardarProveedorSchema.parse(request.body);

      const actualizado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [modificado] = await db
            .update(proveedor)
            .set({
              codigo: body.codigo,
              razonSocial: body.razonSocial,
              nombreFantasia: body.nombreFantasia || null,
              cuit: body.cuit || null,
              condicionIva: body.condicionIva,
              telefono: body.telefono || null,
              email: body.email || null,
              direccion: body.direccion || null,
              contactoNombre: body.contactoNombre || null,
              diasPlazoPago: body.diasPlazoPago,
              activo: body.activo,
              notas: body.notas || null,
            })
            .where(
              and(eq(proveedor.id, id), eq(proveedor.negocioId, claims.negocioId)),
            )
            .returning();

          if (!modificado) {
            throw new AuthError('Proveedor no encontrado', 404);
          }

          return modificado;
        },
      );

      return await reply.send(actualizado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 5. Cuenta corriente proveedor: extracto de movimientos
  app.get('/proveedores/:id/cuenta-corriente', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const { id } = request.params as { id: string };

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const resSaldo = await client.query<SaldoProveedorRow>(
            `select
              v.proveedor_id as id,
              v.codigo,
              v.razon_social as "razonSocial",
              v.cuit,
              v.dias_plazo_pago as "diasPlazoPago",
              v.total_compras as "totalCompras",
              v.total_pagos as "totalPagos",
              v.saldo_deudor as "saldoDeudor"
            from v_saldo_proveedor v
            where v.proveedor_id = $1 and v.negocio_id = $2`,
            [id, claims.negocioId],
          );

          const prov = resSaldo.rows[0];
          if (!prov) {
            throw new AuthError('Proveedor no encontrado', 404);
          }

          const resMovs = await client.query<MovimientoCtaCteProveedorRow>(
            `select
              m.id,
              m.tipo,
              m.sentido,
              m.monto,
              m.descripcion,
              m.orden_compra_id as "ordenCompraId",
              m.movimiento_caja_id as "movimientoCajaId",
              m.revierte_id as "revierteId",
              m.creado_en as "creadoEn",
              u.nombre as "usuarioNombre"
            from movimiento_cta_cte_proveedor m
            left join usuario u on u.id = m.creado_por
            where m.proveedor_id = $1 and m.negocio_id = $2
            order by m.creado_en desc`,
            [id, claims.negocioId],
          );

          return {
            proveedor: prov,
            saldoDeudor: prov.saldoDeudor,
            movimientos: resMovs.rows,
          };
        },
      );

      return await reply.send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 6. Registrar pago a proveedor desde turno de caja (egreso + cta cte)
  app.post('/proveedores/:id/pagos', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const { id } = request.params as { id: string };
      const body = registrarPagoProveedorSchema.parse({
        ...request.body as Record<string, unknown>,
        proveedorId: id,
      });

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db, client }) => {
          // 1. Validar turno abierto
          const [turno] = await db
            .select()
            .from(turnoCaja)
            .where(
              and(
                eq(turnoCaja.id, body.turnoId),
                eq(turnoCaja.negocioId, claims.negocioId),
              ),
            );

          if (!turno) {
            throw new AuthError('El turno de caja especificado no existe', 404);
          }
          if (turno.cierraEn !== null) {
            throw new AuthError('No se pueden registrar pagos en un turno cerrado', 400);
          }

          // 2. Validar proveedor
          const [p] = await db
            .select()
            .from(proveedor)
            .where(
              and(eq(proveedor.id, id), eq(proveedor.negocioId, claims.negocioId)),
            );

          if (!p) {
            throw new AuthError('Proveedor no encontrado', 404);
          }

          // 3. Obtener o crear categoría 'Proveedores'
          let [catProveedores] = await db
            .select()
            .from(categoria)
            .where(
              and(
                eq(categoria.negocioId, claims.negocioId),
                eq(categoria.nombre, 'Proveedores'),
                eq(categoria.tipo, 'egreso'),
              ),
            );

          if (!catProveedores) {
            [catProveedores] = await db
              .insert(categoria)
              .values({
                negocioId: claims.negocioId,
                nombre: 'Proveedores',
                tipo: 'egreso',
              })
              .returning();
          }

          // 4. Insertar egreso en el turno de caja
          const descPago =
            body.descripcion ||
            `Pago a proveedor ${p.codigo} · ${p.razonSocial}`;

          const [movCaja] = await db
            .insert(movimiento)
            .values({
              id: body.id ?? crypto.randomUUID(),
              negocioId: claims.negocioId,
              turnoId: body.turnoId,
              tipo: 'egreso',
              sentido: 'out',
              monto: body.monto,
              medioPagoId: body.medioPagoId,
              categoriaId: catProveedores?.id ?? null,
              descripcion: descPago,
              creadoPor: claims.usuarioId,
            })
            .onConflictDoNothing({ target: movimiento.id })
            .returning();

          // 5. Insertar crédito en cuenta corriente del proveedor (cancela/reduce deuda)
          const [movCtaCte] = await db
            .insert(movimientoCtaCteProveedor)
            .values({
              negocioId: claims.negocioId,
              proveedorId: id,
              tipo: 'credito_pago',
              sentido: 'credito',
              monto: body.monto,
              movimientoCajaId: movCaja?.id ?? null,
              descripcion: descPago,
              creadoPor: claims.usuarioId,
            })
            .returning();

          if (!movCtaCte) {
            throw new AuthError('Error al registrar pago en cuenta corriente', 500);
          }

          // Asiento contable automático de pago a proveedor
          const [mpPago] = await db
            .select()
            .from(medioPago)
            .where(eq(medioPago.id, body.medioPagoId));

          let cuentaHaber = '1.1.02'; // Banco / Cuentas Virtuales por defecto
          if (mpPago) {
            const nom = mpPago.nombre.toLowerCase();
            if (mpPago.esEfectivo) {
              cuentaHaber = '1.1.01'; // Caja Efectivo
            } else if (nom.includes('cheque')) {
              cuentaHaber = '1.1.03'; // Valores a Depositar (Cheques)
            }
          }

          await registrarAsientoAutomatico(client, {
            negocioId: claims.negocioId,
            concepto: `Pago a proveedor ${p.razonSocial}`,
            origen: 'pago_proveedor',
            referenciaId: movCtaCte.id,
            usuarioId: claims.usuarioId,
            renglones: [
              {
                cuentaCodigo: '2.1.01', // Proveedores (Cta Cte)
                debe: body.monto,
                haber: '0.00',
                descripcion: `Cancelación deuda cta cte proveedor ${p.razonSocial}`,
              },
              {
                cuentaCodigo: cuentaHaber,
                debe: '0.00',
                haber: body.monto,
                descripcion: `Salida de fondos (${mpPago?.nombre ?? 'Pago'})`,
              },
            ],
          });

          return {
            pagoId: movCtaCte.id,
            movimientoCajaId: movCaja?.id ?? null,
          };
        },
      );

      return await reply.code(201).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 7. Ajuste manual de cuenta corriente de proveedor
  app.post('/proveedores/:id/ajustes', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const { id } = request.params as { id: string };
      const body = ajusteCtaCteProveedorSchema.parse({
        ...request.body as Record<string, unknown>,
        proveedorId: id,
      });

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db, client }) => {
          const [p] = await db
            .select()
            .from(proveedor)
            .where(
              and(eq(proveedor.id, id), eq(proveedor.negocioId, claims.negocioId)),
            );

          if (!p) {
            throw new AuthError('Proveedor no encontrado', 404);
          }

          const sentido =
            body.tipo === 'ajuste_debito' ? ('debito' as const) : ('credito' as const);

          const [mov] = await db
            .insert(movimientoCtaCteProveedor)
            .values({
              id: body.id,
              negocioId: claims.negocioId,
              proveedorId: id,
              tipo: body.tipo,
              sentido,
              monto: body.monto,
              descripcion: body.descripcion,
              creadoPor: claims.usuarioId,
            })
            .returning();

          await registrarAuditoria(client, {
            negocioId: claims.negocioId,
            usuarioId: claims.usuarioId,
            usuarioEmail: claims.email,
            rol: claims.rol,
            accion: 'ajuste_cta_cte_proveedor',
            entidad: 'proveedor',
            entidadId: id,
            detalles: {
              tipo: body.tipo,
              sentido,
              monto: body.monto,
              descripcion: body.descripcion,
            },
          });

          return mov;
        },
      );

      return await reply.code(201).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 8. Listar órdenes de compra
  app.get('/compras', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const query = request.query as {
        proveedorId?: string;
        estado?: string;
      };

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          let sql = `
            select
              oc.id,
              oc.numero,
              oc.proveedor_id as "proveedorId",
              p.razon_social as "proveedorNombre",
              oc.estado,
              oc.condicion_pago as "condicionPago",
              oc.fecha_emision as "fechaEmision",
              oc.fecha_esperada as "fechaEsperada",
              oc.fecha_recepcion as "fechaRecepcion",
              oc.total,
              oc.notas,
              oc.creado_en as "creadoEn"
            from orden_compra oc
            inner join proveedor p on p.id = oc.proveedor_id and p.negocio_id = oc.negocio_id
            where oc.negocio_id = $1
          `;
          const params: unknown[] = [claims.negocioId];

          if (query.proveedorId) {
            params.push(query.proveedorId);
            sql += ` and oc.proveedor_id = $${params.length}`;
          }

          if (query.estado) {
            params.push(query.estado);
            sql += ` and oc.estado = $${params.length}`;
          }

          sql += ` order by oc.creado_en desc`;

          const res = await client.query<OrdenCompraRow>(sql, params);
          return res.rows;
        },
      );

      return await reply.send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 9. Crear orden de compra con ítems
  app.post('/compras', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const body = guardarOrdenCompraSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [nuevaOC] = await db
            .insert(ordenCompra)
            .values({
              id: body.id,
              negocioId: claims.negocioId,
              numero: body.numero,
              proveedorId: body.proveedorId,
              condicionPago: body.condicionPago,
              fechaEmision: body.fechaEmision ?? undefined,
              fechaEsperada: body.fechaEsperada ? body.fechaEsperada : null,
              total: body.total,
              notas: body.notas || null,
              creadoPor: claims.usuarioId,
            })
            .returning();

          if (!nuevaOC) {
            throw new AuthError('Error al crear orden de compra', 500);
          }

          for (const it of body.items) {
            await db.insert(itemOrdenCompra).values({
              id: it.id,
              negocioId: claims.negocioId,
              ordenCompraId: nuevaOC.id,
              productoId: it.productoId,
              descripcion: it.descripcion,
              cantidadPedida: it.cantidadPedida,
              costoUnitario: it.costoUnitario,
              subtotal: it.subtotal,
            });
          }

          return nuevaOC;
        },
      );

      return await reply.code(201).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 10. Recepción de mercadería (impacto en kardex stock + actualización de costo + deuda cta cte)
  app.post('/compras/:id/recibir', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const { id } = request.params as { id: string };
      const body = recibirOrdenCompraSchema.parse({
        ...request.body as Record<string, unknown>,
        ordenCompraId: id,
      });

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db, client }) => {
          // 1. Obtener la orden de compra
          const [oc] = await db
            .select()
            .from(ordenCompra)
            .where(
              and(eq(ordenCompra.id, id), eq(ordenCompra.negocioId, claims.negocioId)),
            );

          if (!oc) {
            throw new AuthError('Orden de compra no encontrada', 404);
          }

          if (oc.estado === 'recibida') {
            throw new AuthError('Esta orden de compra ya fue recibida anteriormente', 400);
          }
          if (oc.estado === 'anulada') {
            throw new AuthError('No se puede recibir una orden anulada', 400);
          }

          // 2. Procesar ítems recibidos e insertar en movimiento_stock
          for (const itemRecibido of body.itemsRecibidos) {
            const [prod] = await db
              .select()
              .from(producto)
              .where(
                and(
                  eq(producto.id, itemRecibido.productoId),
                  eq(producto.negocioId, claims.negocioId),
                ),
              );

            if (!prod) continue;

            const cantRec = parseFloat(itemRecibido.cantidadRecibida);
            if (cantRec > 0) {
              // Insertar movimiento_stock inmutable ('ingreso_compra', sentido 'in')
              await db.insert(movimientoStock).values({
                negocioId: claims.negocioId,
                productoId: prod.id,
                tipo: 'ingreso_compra',
                sentido: 'in',
                cantidad: itemRecibido.cantidadRecibida,
                unidad: prod.unidadPrincipal,
                cantidadBase: itemRecibido.cantidadRecibida,
                costoUnitario: itemRecibido.costoUnitario,
                notas: `Recepción Orden de Compra ${oc.numero}`,
                creadoPor: claims.usuarioId,
              });

              // Si se solicita, actualizar el costo_base del artículo
              if (body.actualizarCostoBase) {
                await db
                  .update(producto)
                  .set({ costoBase: itemRecibido.costoUnitario })
                  .where(
                    and(
                      eq(producto.id, prod.id),
                      eq(producto.negocioId, claims.negocioId),
                    ),
                  );
              }

              // Actualizar item_orden_compra con la cantidad recibida
              await db
                .update(itemOrdenCompra)
                .set({ cantidadRecibida: itemRecibido.cantidadRecibida })
                .where(
                  and(
                    eq(itemOrdenCompra.ordenCompraId, oc.id),
                    eq(itemOrdenCompra.productoId, prod.id),
                    eq(itemOrdenCompra.negocioId, claims.negocioId),
                  ),
                );
            }
          }

          // 3. Si la orden fue pactada a cuenta corriente, generar el débito en la cuenta corriente del proveedor
          if (oc.condicionPago === 'cuenta_corriente') {
            await db.insert(movimientoCtaCteProveedor).values({
              negocioId: claims.negocioId,
              proveedorId: oc.proveedorId,
              tipo: 'debito_compra',
              sentido: 'debito',
              monto: oc.total,
              ordenCompraId: oc.id,
              descripcion: `Factura/Remito recepción OC ${oc.numero}`,
              creadoPor: claims.usuarioId,
            });
          }

          // Generar asiento contable automático de recepción de stock
          await registrarAsientoAutomatico(client, {
            negocioId: claims.negocioId,
            concepto: `Recepción Orden de Compra #${oc.numero}`,
            origen: 'compra_stock',
            referenciaId: oc.id,
            usuarioId: claims.usuarioId,
            renglones: [
              {
                cuentaCodigo: '1.1.05', // Mercaderías en Stock
                debe: oc.total,
                haber: '0.00',
                descripcion: `Ingreso de mercadería por OC #${oc.numero}`,
              },
              {
                cuentaCodigo: '2.1.01', // Proveedores (Cta Cte)
                debe: '0.00',
                haber: oc.total,
                descripcion: `Deuda cta cte OC #${oc.numero}`,
              },
            ],
          });

          // 4. Marcar orden como recibida
          const [recibida] = await db
            .update(ordenCompra)
            .set({
              estado: 'recibida',
              fechaRecepcion: new Date(),
              recibidoPor: claims.usuarioId,
            })
            .where(
              and(eq(ordenCompra.id, id), eq(ordenCompra.negocioId, claims.negocioId)),
            )
            .returning();

          return recibida;
        },
      );

      return await reply.send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });
}
