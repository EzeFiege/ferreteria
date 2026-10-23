import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import {
  aCentavos,
  deCentavos,
  generarOrdenesReabastecimientoSchema,
  type GenerarOrdenesReabastecimientoResponse,
  type OrdenCompraGeneradaInfo,
  type SugerenciaReabastecimientoItem,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';

export interface ReabastecimientoRoutesOptions {
  pool: pg.Pool;
  verifyToken?: TokenVerifier | undefined;
}

function handleReabastecimientoError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (err instanceof AuthError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: 'Datos de reabastecimiento inválidos',
      detalles: err.issues,
    });
  }
  request.log.error(
    { err, modulo: 'reabastecimiento' },
    'Error en rutas de reabastecimiento inteligente',
  );
  return reply.code(500).send({ error: 'Error interno del servidor' });
}

export function registerReabastecimientoRoutes(
  app: FastifyInstance,
  options: ReabastecimientoRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Obtener sugerencias inteligentes de reabastecimiento
  app.get('/reabastecimiento/sugerencias', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno', 'encargado', 'cajero']);

      const query = request.query as {
        urgencia?: string | undefined;
        proveedorId?: string | undefined;
        rubroId?: string | undefined;
      };

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          let sql = `
            select
              producto_id,
              codigo,
              nombre,
              unidad_principal,
              rubro_nombre,
              stock_actual,
              stock_minimo,
              punto_pedido,
              lead_time_dias,
              costo_base,
              unidades_vendidas_30d,
              consumo_diario_promedio,
              dias_autonomia,
              punto_pedido_efectivo,
              cantidad_sugerida,
              proveedor_id,
              proveedor_nombre,
              costo_compra_estimado,
              nivel_urgencia
            from v_articulos_reabastecimiento
            where negocio_id = $1
          `;

          const params: unknown[] = [claims.negocioId];

          // Filtro por nivel de urgencia (por defecto quiebres, críticos y preventivos)
          if (query.urgencia === 'quiebre') {
            params.push('quiebre');
            sql += ` and nivel_urgencia = $${String(params.length)}`;
          } else if (query.urgencia === 'critico') {
            sql += ` and nivel_urgencia in ('quiebre', 'critico')`;
          } else if (query.urgencia === 'preventivo') {
            sql += ` and nivel_urgencia in ('quiebre', 'critico', 'preventivo')`;
          } else if (query.urgencia !== 'todos') {
            // Por defecto sugerir aquellos que requieren atención (no normales)
            sql += ` and nivel_urgencia in ('quiebre', 'critico', 'preventivo')`;
          }

          if (query.proveedorId) {
            params.push(query.proveedorId);
            sql += ` and proveedor_id = $${String(params.length)}::uuid`;
          }

          if (query.rubroId) {
            params.push(query.rubroId);
            sql += ` and rubro_id = $${String(params.length)}::uuid`;
          }

          sql += ` order by case nivel_urgencia when 'quiebre' then 1 when 'critico' then 2 when 'preventivo' then 3 else 4 end, dias_autonomia asc, nombre asc`;

          const res = await client.query<{
            producto_id: string;
            codigo: string;
            nombre: string;
            unidad_principal: string;
            rubro_nombre: string | null;
            stock_actual: string;
            stock_minimo: string;
            punto_pedido: string;
            lead_time_dias: number;
            costo_base: string;
            unidades_vendidas_30d: string;
            consumo_diario_promedio: string;
            dias_autonomia: string;
            punto_pedido_efectivo: string;
            cantidad_sugerida: string;
            proveedor_id: string | null;
            proveedor_nombre: string | null;
            costo_compra_estimado: string;
            nivel_urgencia: 'quiebre' | 'critico' | 'preventivo' | 'normal';
          }>(sql, params);

          const items: SugerenciaReabastecimientoItem[] = res.rows.map((r) => ({
            productoId: r.producto_id,
            codigo: r.codigo,
            nombre: r.nombre,
            unidadPrincipal: r.unidad_principal,
            rubroNombre: r.rubro_nombre,
            stockActual: r.stock_actual,
            stockMinimo: r.stock_minimo,
            puntoPedido: r.punto_pedido,
            leadTimeDias: r.lead_time_dias,
            costoBase: r.costo_base,
            unidadesVendidas30d: r.unidades_vendidas_30d,
            consumoDiarioPromedio: r.consumo_diario_promedio,
            diasAutonomia: Number(r.dias_autonomia),
            puntoPedidoEfectivo: r.punto_pedido_efectivo,
            cantidadSugerida: r.cantidad_sugerida,
            proveedorId: r.proveedor_id,
            proveedorNombre: r.proveedor_nombre,
            costoCompraEstimado: r.costo_compra_estimado,
            nivelUrgencia: r.nivel_urgencia,
          }));

          // Agrupar por proveedor y calcular inversión total estimada
          const porProveedorMap = new Map<
            string,
            {
              proveedorId: string;
              proveedorNombre: string;
              cantidadArticulos: number;
              inversionEstimadaCentavos: bigint;
            }
          >();

          let totalQuiebres = 0;
          let totalCriticos = 0;
          let totalPreventivos = 0;

          for (const it of items) {
            if (it.nivelUrgencia === 'quiebre') totalQuiebres++;
            else if (it.nivelUrgencia === 'critico') totalCriticos++;
            else if (it.nivelUrgencia === 'preventivo') totalPreventivos++;

            const provKey = it.proveedorId ?? 'sin_proveedor';
            const provNombre = it.proveedorNombre ?? 'Sin proveedor asignado';
            const cantNum = parseFloat(it.cantidadSugerida) || 0;
            const costoUnitCent = aCentavos(it.costoCompraEstimado);
            const subtotalCent = (costoUnitCent * BigInt(Math.round(cantNum * 1000))) / 1000n;

            const actual = porProveedorMap.get(provKey) ?? {
              proveedorId: provKey,
              proveedorNombre: provNombre,
              cantidadArticulos: 0,
              inversionEstimadaCentavos: 0n,
            };

            actual.cantidadArticulos++;
            actual.inversionEstimadaCentavos += subtotalCent;
            porProveedorMap.set(provKey, actual);
          }

          const resumenProveedores = Array.from(porProveedorMap.values()).map((p) => ({
            proveedorId: p.proveedorId,
            proveedorNombre: p.proveedorNombre,
            cantidadArticulos: p.cantidadArticulos,
            inversionEstimada: deCentavos(p.inversionEstimadaCentavos),
          }));

          return {
            items,
            resumen: {
              totalSugeridos: items.length,
              totalQuiebres,
              totalCriticos,
              totalPreventivos,
              resumenProveedores,
            },
          };
        },
      );

      return await reply.send(resultado);
    } catch (err: unknown) {
      return handleReabastecimientoError(err, request, reply);
    }
  });

  // 2. Generar Órdenes de Compra Automáticas en Borrador agrupadas por Proveedor
  app.post('/reabastecimiento/generar-ordenes', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno', 'encargado']);

      const body = generarOrdenesReabastecimientoSchema.parse(request.body);

      const respuesta = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }): Promise<GenerarOrdenesReabastecimientoResponse> => {
          // Bloqueo de correlatividad para órdenes de compra
          await client.query(
            "select pg_advisory_xact_lock(hashtext('orden_compra_' || $1))",
            [claims.negocioId],
          );

          // Obtener usuario que genera la orden
          const uRes = await client.query<{ id: string; nombre: string }>(
            'select id, nombre from usuario where id = $1 and negocio_id = $2',
            [claims.usuarioId, claims.negocioId],
          );
          const usuarioId = uRes.rows[0]?.id ?? claims.usuarioId;

          const ordenesCreadas: OrdenCompraGeneradaInfo[] = [];

          for (const ordenInput of body.ordenes) {
            // Verificar existencia del proveedor
            const provRes = await client.query<{
              id: string;
              razon_social: string;
              nombre_fantasia: string | null;
            }>(
              'select id, razon_social, nombre_fantasia from proveedor where id = $1 and negocio_id = $2',
              [ordenInput.proveedorId, claims.negocioId],
            );
            const prov = provRes.rows[0];
            if (!prov) {
              throw new AuthError(`Proveedor ${ordenInput.proveedorId} no encontrado`, 404);
            }
            const provNombre = prov.nombre_fantasia ?? prov.razon_social;

            // Siguiente número de Orden de Compra: OC-0001
            const maxRes = await client.query<{ max_num: number | null }>(
              `
              select coalesce(
                max(
                  case
                    when numero ~ '^OC-[0-9]+$' then substring(numero from 4)::integer
                    else 0
                  end
                ),
                0
              ) as max_num
              from orden_compra
              where negocio_id = $1
              `,
              [claims.negocioId],
            );
            const siguienteNumeroInt = (maxRes.rows[0]?.max_num ?? 0) + 1;
            const numeroOC = `OC-${String(siguienteNumeroInt).padStart(4, '0')}`;

            // Calcular total de la orden
            let totalCentavos = 0n;
            const itemsValidados: Array<{
              productoId: string;
              descripcion: string;
              cantidad: string;
              costoUnitario: string;
              subtotal: string;
            }> = [];

            for (const item of ordenInput.items) {
              const prodCheck = await client.query<{ nombre: string; codigo: string }>(
                'select nombre, codigo from producto where id = $1 and negocio_id = $2',
                [item.productoId, claims.negocioId],
              );
              const prodDesc = prodCheck.rows[0]
                ? `${prodCheck.rows[0].nombre} (${prodCheck.rows[0].codigo})`
                : 'Artículo catálogo';

              const cantNum = parseFloat(item.cantidad);
              const costoUnitCent = aCentavos(item.costoUnitario);
              const subtotalCent =
                (costoUnitCent * BigInt(Math.round(cantNum * 1000))) / 1000n;
              totalCentavos += subtotalCent;

              itemsValidados.push({
                productoId: item.productoId,
                descripcion: prodDesc,
                cantidad: item.cantidad,
                costoUnitario: item.costoUnitario,
                subtotal: deCentavos(subtotalCent),
              });
            }

            const totalOC = deCentavos(totalCentavos);
            const ordenId = randomUUID();

            // Insertar orden de compra en estado 'borrador'
            await client.query(
              `
              insert into orden_compra (
                id, negocio_id, numero, proveedor_id, estado, condicion_pago,
                fecha_emision, total, notas, creado_por
              ) values ($1, $2, $3, $4, 'borrador', $5, current_date, $6, $7, $8)
              `,
              [
                ordenId,
                claims.negocioId,
                numeroOC,
                prov.id,
                ordenInput.condicionPago,
                totalOC,
                ordenInput.notas ?? 'Generada automáticamente por Asistente de Reabastecimiento',
                usuarioId,
              ],
            );

            // Insertar renglones de la orden de compra
            for (const it of itemsValidados) {
              await client.query(
                `
                insert into item_orden_compra (
                  id, negocio_id, orden_compra_id, producto_id, descripcion,
                  cantidad_pedida, costo_unitario, subtotal
                ) values ($1, $2, $3, $4, $5, $6, $7, $8)
                `,
                [
                  randomUUID(),
                  claims.negocioId,
                  ordenId,
                  it.productoId,
                  it.descripcion,
                  it.cantidad,
                  it.costoUnitario,
                  it.subtotal,
                ],
              );
            }

            ordenesCreadas.push({
              id: ordenId,
              numero: numeroOC,
              proveedorId: prov.id,
              proveedorNombre: provNombre,
              total: totalOC,
              cantidadItems: itemsValidados.length,
            });
          }

          return {
            ok: true,
            ordenesCreadas,
            mensaje: `Se crearon ${String(ordenesCreadas.length)} órdenes de compra en borrador con éxito.`,
          };
        },
      );

      return await reply.code(201).send(respuesta);
    } catch (err: unknown) {
      return handleReabastecimientoError(err, request, reply);
    }
  });
}
