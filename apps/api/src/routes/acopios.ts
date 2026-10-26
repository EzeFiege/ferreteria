import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import {
  aCentavos,
  deCentavos,
  crearAcopioSchema,
  registrarEntregaAcopioSchema,
  uuidSchema,
  type AcopioDetalleCompleto,
  type AcopioResumenItem,
  type ItemAcopioDetalle,
  type RemitoEntregaDetalle,
  type RemitoEntregaItemDetalle,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';
import { registrarAuditoria } from '../services/auditoria-service.js';

export interface AcopiosRoutesOptions {
  pool: pg.Pool;
  verifyToken?: TokenVerifier | undefined;
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
      error: 'Datos de acopio inválidos',
      detalles: err.issues,
    });
  }
  request.log.error({ err, modulo: 'acopios' }, 'Error en ruta de acopios');
  const msg = err instanceof Error ? err.message : 'Error interno del servidor';
  return reply.code(500).send({ error: msg });
}

export function registerAcopiosRoutes(
  app: FastifyInstance,
  options: AcopiosRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Listar acopios del negocio con filtros por cliente y estado
  app.get('/acopios', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const query = (request.query ?? {}) as {
        clienteId?: string;
        estado?: string;
      };

      const acopios = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          let sql = `
            select
              id,
              numero,
              estado,
              to_char(fecha_emision, 'YYYY-MM-DD') as fecha_emision,
              cliente_id,
              cliente_nombre,
              cliente_cuit_dni,
              cliente_telefono,
              venta_id,
              notas,
              creado_por,
              to_char(creado_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as creado_en,
              total_articulos,
              total_unidades_compradas::text as total_unidades_compradas,
              total_unidades_entregadas::text as total_unidades_entregadas,
              saldo_unidades_pendientes::text as saldo_unidades_pendientes,
              total_valorizado::text as total_valorizado,
              pct_entregado
            from v_acopios_resumen
            where 1=1
          `;
          const params: unknown[] = [];

          if (query.clienteId?.trim()) {
            params.push(query.clienteId.trim());
            sql += ` and cliente_id = $${String(params.length)}::uuid`;
          }

          if (query.estado && query.estado !== 'todos') {
            params.push(query.estado.trim());
            sql += ` and estado = $${String(params.length)}`;
          }

          sql += ' order by creado_en desc';

          const res = await client.query<{
            id: string;
            numero: string;
            estado: 'activo' | 'completado' | 'cancelado';
            fecha_emision: string;
            cliente_id: string;
            cliente_nombre: string;
            cliente_cuit_dni: string | null;
            cliente_telefono: string | null;
            venta_id: string | null;
            notas: string | null;
            creado_por: string;
            creado_en: string;
            total_articulos: number;
            total_unidades_compradas: string;
            total_unidades_entregadas: string;
            saldo_unidades_pendientes: string;
            total_valorizado: string;
            pct_entregado: string | number;
          }>(sql, params);

          return res.rows.map((r): AcopioResumenItem => ({
            id: r.id,
            numero: r.numero,
            estado: r.estado,
            fechaEmision: r.fecha_emision,
            clienteId: r.cliente_id,
            clienteNombre: r.cliente_nombre,
            clienteCuitDni: r.cliente_cuit_dni,
            clienteTelefono: r.cliente_telefono,
            ventaId: r.venta_id,
            notas: r.notas,
            creadoPor: r.creado_por,
            creadoEn: r.creado_en,
            totalArticulos: r.total_articulos,
            totalUnidadesCompradas: r.total_unidades_compradas,
            totalUnidadesEntregadas: r.total_unidades_entregadas,
            saldoUnidadesPendientes: r.saldo_unidades_pendientes,
            totalValorizado: r.total_valorizado,
            pctEntregado: Number(r.pct_entregado),
          }));
        },
      );

      return await reply.send({ acopios });
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 2. Consulta rápida de saldo de acopio por cliente
  app.get('/acopios/cliente/:clienteId/saldo', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const params = request.params as { clienteId: string };
      const clienteIdValido = uuidSchema.parse(params.clienteId);

      const itemsConSaldo = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const res = await client.query<{
            producto_id: string;
            codigo: string;
            nombre: string;
            unidad_principal: string;
            cantidad_comprada: string;
            cantidad_entregada: string;
            saldo_pendiente: string;
          }>(
            `
            select
              ia.producto_id,
              p.codigo,
              p.nombre,
              p.unidad_principal,
              sum(ia.cantidad_comprada)::text as cantidad_comprada,
              sum(ia.cantidad_entregada)::text as cantidad_entregada,
              sum(ia.cantidad_comprada - ia.cantidad_entregada)::text as saldo_pendiente
            from item_acopio ia
            join acopio a on a.id = ia.acopio_id and a.negocio_id = ia.negocio_id
            join producto p on p.id = ia.producto_id and p.negocio_id = ia.negocio_id
            where a.cliente_id = $1
              and a.estado = 'activo'
            group by ia.producto_id, p.codigo, p.nombre, p.unidad_principal
            having sum(ia.cantidad_comprada - ia.cantidad_entregada) > 0
            order by p.nombre asc
            `,
            [clienteIdValido],
          );

          return res.rows.map((r) => ({
            productoId: r.producto_id,
            codigo: r.codigo,
            nombre: r.nombre,
            unidadPrincipal: r.unidad_principal,
            cantidadComprada: r.cantidad_comprada,
            cantidadEntregada: r.cantidad_entregada,
            saldoPendiente: r.saldo_pendiente,
          }));
        },
      );

      return await reply.send({ saldoItems: itemsConSaldo });
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 3. Detalle completo de un acopio con renglones, saldo e historial de remitos
  app.get('/acopios/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const params = request.params as { id: string };
      const acopioId = uuidSchema.parse(params.id);

      const detalle = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }): Promise<AcopioDetalleCompleto | null> => {
          // Cabecera
          const resAcopio = await client.query<{
            id: string;
            numero: string;
            estado: 'activo' | 'completado' | 'cancelado';
            fecha_emision: string;
            cliente_id: string;
            cliente_nombre: string;
            cliente_cuit_dni: string | null;
            cliente_telefono: string | null;
            venta_id: string | null;
            notas: string | null;
            creado_por: string;
            creado_en: string;
            total_articulos: number;
            total_unidades_compradas: string;
            total_unidades_entregadas: string;
            saldo_unidades_pendientes: string;
            total_valorizado: string;
            pct_entregado: string | number;
          }>(
            `
            select
              id, numero, estado, to_char(fecha_emision, 'YYYY-MM-DD') as fecha_emision,
              cliente_id, cliente_nombre, cliente_cuit_dni, cliente_telefono,
              venta_id, notas, creado_por, to_char(creado_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as creado_en,
              total_articulos, total_unidades_compradas::text, total_unidades_entregadas::text,
              saldo_unidades_pendientes::text, total_valorizado::text, pct_entregado
            from v_acopios_resumen
            where id = $1
            `,
            [acopioId],
          );

          const rowAcopio = resAcopio.rows[0];
          if (!rowAcopio) return null;

          const acopioHeader: AcopioResumenItem = {
            id: rowAcopio.id,
            numero: rowAcopio.numero,
            estado: rowAcopio.estado,
            fechaEmision: rowAcopio.fecha_emision,
            clienteId: rowAcopio.cliente_id,
            clienteNombre: rowAcopio.cliente_nombre,
            clienteCuitDni: rowAcopio.cliente_cuit_dni,
            clienteTelefono: rowAcopio.cliente_telefono,
            ventaId: rowAcopio.venta_id,
            notas: rowAcopio.notas,
            creadoPor: rowAcopio.creado_por,
            creadoEn: rowAcopio.creado_en,
            totalArticulos: rowAcopio.total_articulos,
            totalUnidadesCompradas: rowAcopio.total_unidades_compradas,
            totalUnidadesEntregadas: rowAcopio.total_unidades_entregadas,
            saldoUnidadesPendientes: rowAcopio.saldo_unidades_pendientes,
            totalValorizado: rowAcopio.total_valorizado,
            pctEntregado: Number(rowAcopio.pct_entregado),
          };

          // Ítems de acopio
          const resItems = await client.query<{
            id: string;
            producto_id: string;
            codigo: string;
            nombre: string;
            unidad_principal: string;
            cantidad_comprada: string;
            cantidad_entregada: string;
            saldo_pendiente: string;
            precio_unitario: string;
            subtotal: string;
            stock_actual_deposito: string;
          }>(
            `
            select
              ia.id,
              ia.producto_id,
              p.codigo,
              p.nombre,
              p.unidad_principal,
              ia.cantidad_comprada::text,
              ia.cantidad_entregada::text,
              (ia.cantidad_comprada - ia.cantidad_entregada)::text as saldo_pendiente,
              ia.precio_unitario::text,
              ia.subtotal::text,
              coalesce(sa.stock_actual_base, 0)::text as stock_actual_deposito
            from item_acopio ia
            join producto p on p.id = ia.producto_id and p.negocio_id = ia.negocio_id
            left join v_stock_actual sa on sa.producto_id = ia.producto_id
            where ia.acopio_id = $1
            order by p.nombre asc
            `,
            [acopioId],
          );

          const items: ItemAcopioDetalle[] = resItems.rows.map((r) => ({
            id: r.id,
            productoId: r.producto_id,
            productoCodigo: r.codigo,
            productoNombre: r.nombre,
            unidadPrincipal: r.unidad_principal,
            cantidadComprada: r.cantidad_comprada,
            cantidadEntregada: r.cantidad_entregada,
            saldoPendiente: r.saldo_pendiente,
            precioUnitario: r.precio_unitario,
            subtotal: r.subtotal,
            stockActualDeposito: r.stock_actual_deposito,
          }));

          // Remitos de entrega emitidos
          const resRemitos = await client.query<{
            id: string;
            numero: string;
            fecha: string;
            retirado_por_nombre: string;
            retirado_por_dni: string | null;
            vehiculo_patente: string | null;
            observaciones: string | null;
            creado_por: string;
          }>(
            `
            select
              id, numero, to_char(fecha, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as fecha,
              retirado_por_nombre, retirado_por_dni, vehiculo_patente, observaciones, creado_por
            from remito_entrega_acopio
            where acopio_id = $1
            order by fecha desc
            `,
            [acopioId],
          );

          const remitos: RemitoEntregaDetalle[] = [];
          for (const rem of resRemitos.rows) {
            const resItemRem = await client.query<{
              id: string;
              producto_id: string;
              codigo: string;
              nombre: string;
              unidad_principal: string;
              cantidad: string;
            }>(
              `
              select
                ira.id, ira.producto_id, p.codigo, p.nombre, p.unidad_principal, ira.cantidad::text
              from item_remito_entrega_acopio ira
              join producto p on p.id = ira.producto_id and p.negocio_id = ira.negocio_id
              where ira.remito_id = $1
              order by p.nombre asc
              `,
              [rem.id],
            );

            const remItems: RemitoEntregaItemDetalle[] = resItemRem.rows.map((ri) => ({
              id: ri.id,
              productoId: ri.producto_id,
              productoCodigo: ri.codigo,
              productoNombre: ri.nombre,
              unidadPrincipal: ri.unidad_principal,
              cantidad: ri.cantidad,
            }));

            remitos.push({
              id: rem.id,
              numero: rem.numero,
              fecha: rem.fecha,
              retiradoPorNombre: rem.retirado_por_nombre,
              retiradoPorDni: rem.retirado_por_dni,
              vehiculoPatente: rem.vehiculo_patente,
              observaciones: rem.observaciones,
              creadoPor: rem.creado_por,
              items: remItems,
            });
          }

          return {
            acopio: acopioHeader,
            items,
            remitos,
          };
        },
      );

      if (!detalle) {
        return await reply.code(404).send({ error: 'Acopio no encontrado' });
      }

      return await reply.send(detalle);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 4. Crear nuevo Acopio de Materiales
  app.post('/acopios', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno', 'encargado', 'cajero']);

      const body = crearAcopioSchema.parse(request.body);
      const usuarioNombre = claims.email ?? 'Operador';

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          // Validar existencia de cliente
          const resCliente = await client.query<{ id: string; nombre: string }>(
            'select id, nombre from cliente where id = $1',
            [body.clienteId],
          );
          if (!resCliente.rows[0]) {
            throw new Error('Cliente no encontrado');
          }

          // Generar correlativo de acopio (ACP-XXXX)
          const maxNumRes = await client.query<{ max_num: number }>(
            `
            select coalesce(
              max(
                case
                  when numero ~ '^ACP-[0-9]+$' then substring(numero from 5)::integer
                  else 0
                end
              ),
              0
            ) as max_num
            from acopio
            `,
          );
          const siguienteNum = (maxNumRes.rows[0]?.max_num ?? 0) + 1;
          const numeroAcopio = `ACP-${String(siguienteNum).padStart(4, '0')}`;

          const acopioId = randomUUID();
          await client.query(
            `
            insert into acopio (
              id, negocio_id, numero, cliente_id, venta_id, estado,
              fecha_emision, notas, creado_por
            ) values ($1, $2, $3, $4, $5, 'activo', coalesce($6::date, current_date), $7, $8)
            `,
            [
              acopioId,
              claims.negocioId,
              numeroAcopio,
              body.clienteId,
              body.ventaId ?? null,
              body.fechaEmision ?? null,
              body.notas ?? null,
              usuarioNombre,
            ],
          );

          // Insertar ítems calculando subtotales en centavos
          for (const item of body.items) {
            const cantNum = parseFloat(item.cantidad);
            const unitCent = aCentavos(item.precioUnitario);
            const subtotalCent =
              (unitCent * BigInt(Math.round(cantNum * 1000))) / 1000n;

            await client.query(
              `
              insert into item_acopio (
                id, negocio_id, acopio_id, producto_id, cantidad_comprada,
                cantidad_entregada, precio_unitario, subtotal
              ) values ($1, $2, $3, $4, $5, 0, $6, $7)
              `,
              [
                randomUUID(),
                claims.negocioId,
                acopioId,
                item.productoId,
                item.cantidad,
                item.precioUnitario,
                deCentavos(subtotalCent),
              ],
            );
          }

          // Auditoría
          await registrarAuditoria(client, {
            negocioId: claims.negocioId,
            usuarioId: claims.usuarioId,
            usuarioEmail: claims.email ?? null,
            rol: claims.rol,
            accion: 'crear_acopio',
            entidad: 'acopio',
            entidadId: acopioId,
            detalles: {
              numero: numeroAcopio,
              clienteId: body.clienteId,
              articulosCount: body.items.length,
            },
          });

          return { id: acopioId, numero: numeroAcopio };
        },
      );

      return await reply.code(201).send({
        ok: true,
        id: resultado.id,
        numero: resultado.numero,
        mensaje: `Acopio ${resultado.numero} registrado con éxito.`,
      });
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 5. Registrar Remito de Entrega Parcial o Total de Acopio (impacta en Kardex)
  app.post('/acopios/:id/entregas', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno', 'encargado', 'cajero']);

      const params = request.params as { id: string };
      const acopioId = uuidSchema.parse(params.id);
      const body = registrarEntregaAcopioSchema.parse(request.body);
      const usuarioNombre = claims.email ?? 'Operador';

      const resultadoEntrega = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          // Verificar que el acopio exista y esté activo
          const resAcopio = await client.query<{
            id: string;
            numero: string;
            estado: string;
            cliente_id: string;
          }>('select id, numero, estado, cliente_id from acopio where id = $1', [acopioId]);

          const acopioRow = resAcopio.rows[0];
          if (!acopioRow) {
            throw new Error('Acopio no encontrado');
          }
          if (acopioRow.estado !== 'activo') {
            throw new Error('Solo se pueden emitir entregas para acopios activos');
          }

          // Correlativo de Remito (REM-XXXX)
          const maxNumRem = await client.query<{ max_num: number }>(
            `
            select coalesce(
              max(
                case
                  when numero ~ '^REM-[0-9]+$' then substring(numero from 5)::integer
                  else 0
                end
              ),
              0
            ) as max_num
            from remito_entrega_acopio
            `,
          );
          const siguienteNumRem = (maxNumRem.rows[0]?.max_num ?? 0) + 1;
          const numeroRemito = `REM-${String(siguienteNumRem).padStart(4, '0')}`;

          const remitoId = randomUUID();
          await client.query(
            `
            insert into remito_entrega_acopio (
              id, negocio_id, acopio_id, numero, fecha, retirado_por_nombre,
              retirado_por_dni, vehiculo_patente, observaciones, creado_por
            ) values ($1, $2, $3, $4, now(), $5, $6, $7, $8, $9)
            `,
            [
              remitoId,
              claims.negocioId,
              acopioId,
              numeroRemito,
              body.retiradoPorNombre,
              body.retiradoPorDni ?? null,
              body.vehiculoPatente ?? null,
              body.observaciones ?? null,
              usuarioNombre,
            ],
          );

          // Procesar cada ítem entregado
          for (const item of body.items) {
            const cantEntregar = parseFloat(item.cantidad);
            if (cantEntregar <= 0) continue;

            // Consultar saldo actual del ítem de acopio
            const resItemAcopio = await client.query<{
              cantidad_comprada: string;
              cantidad_entregada: string;
              producto_id: string;
            }>(
              'select cantidad_comprada, cantidad_entregada, producto_id from item_acopio where id = $1 and acopio_id = $2',
              [item.itemAcopioId, acopioId],
            );

            const rowItem = resItemAcopio.rows[0];
            if (!rowItem) {
              throw new Error(`Ítem de acopio ${item.itemAcopioId} no existe en este acopio`);
            }

            const comprada = parseFloat(rowItem.cantidad_comprada);
            const yaEntregada = parseFloat(rowItem.cantidad_entregada);
            const saldoPendiente = comprada - yaEntregada;

            if (cantEntregar > saldoPendiente + 0.0001) {
              throw new Error(
                `La cantidad a entregar (${item.cantidad}) supera el saldo pendiente (${saldoPendiente.toFixed(3)}) del producto`,
              );
            }

            // Consultar datos del producto para factor de conversión y costo
            const prodRes = await client.query<{
              factor_conversion: string;
              costo_base: string;
            }>(
              'select factor_conversion, costo_base from producto where id = $1',
              [item.productoId],
            );
            const prod = prodRes.rows[0];
            const factorConversion = parseFloat(prod?.factor_conversion ?? '1');
            const costoBase = prod?.costo_base ?? '0.00';
            const cantidadBase = (cantEntregar * factorConversion).toFixed(3);

            // 1. Insertar en item_remito_entrega_acopio
            await client.query(
              `
              insert into item_remito_entrega_acopio (
                id, negocio_id, remito_id, item_acopio_id, producto_id, cantidad
              ) values ($1, $2, $3, $4, $5, $6)
              `,
              [
                randomUUID(),
                claims.negocioId,
                remitoId,
                item.itemAcopioId,
                item.productoId,
                item.cantidad,
              ],
            );

            // 2. Incrementar cantidad_entregada en item_acopio
            const nuevaCantidadEntregada = (yaEntregada + cantEntregar).toFixed(3);
            await client.query(
              'update item_acopio set cantidad_entregada = $1 where id = $2 and negocio_id = $3',
              [nuevaCantidadEntregada, item.itemAcopioId, claims.negocioId],
            );

            // 3. Registrar egreso físico en Kardex inmutable (movimiento_stock)
            await client.query(
              `
              insert into movimiento_stock (
                id, negocio_id, producto_id, tipo, sentido, cantidad,
                unidad, cantidad_base, costo_unitario, notas, creado_por
              ) values ($1, $2, $3, 'entrega_acopio', 'out', $4, 'principal', $5, $6, $7, $8)
              `,
              [
                randomUUID(),
                claims.negocioId,
                item.productoId,
                item.cantidad,
                cantidadBase,
                costoBase,
                `Salida física por Remito de Acopio ${numeroRemito} (${acopioRow.numero}) a ${body.retiradoPorNombre}`,
                claims.usuarioId,
              ],
            );
          }

          // Verificar si todos los ítems fueron completamente entregados
          const checkSaldoRes = await client.query<{ pendientes: number }>(
            `
            select count(*)::int as pendientes
            from item_acopio
            where acopio_id = $1
              and (cantidad_comprada - cantidad_entregada) > 0.0001
            `,
            [acopioId],
          );

          const quedanPendientes = (checkSaldoRes.rows[0]?.pendientes ?? 0) > 0;
          if (!quedanPendientes) {
            await client.query(
              "update acopio set estado = 'completado' where id = $1 and negocio_id = $2",
              [acopioId, claims.negocioId],
            );
          }

          // Auditoría
          await registrarAuditoria(client, {
            negocioId: claims.negocioId,
            usuarioId: claims.usuarioId,
            usuarioEmail: claims.email ?? null,
            rol: claims.rol,
            accion: 'entrega_acopio',
            entidad: 'acopio',
            entidadId: remitoId,
            detalles: {
              acopioId,
              acopioNumero: acopioRow.numero,
              numeroRemito,
              retiradoPor: body.retiradoPorNombre,
              completado: !quedanPendientes,
            },
          });

          return {
            remitoId,
            numeroRemito,
            acopioCompletado: !quedanPendientes,
          };
        },
      );

      return await reply.code(201).send({
        ok: true,
        remitoId: resultadoEntrega.remitoId,
        numeroRemito: resultadoEntrega.numeroRemito,
        acopioCompletado: resultadoEntrega.acopioCompletado,
        mensaje: `Remito ${resultadoEntrega.numeroRemito} emitido correctamente.`,
      });
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });
}
