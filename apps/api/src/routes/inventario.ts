import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import {
  aCentavos,
  aplicarInventarioSchema,
  deCentavos,
  guardarConteosInventarioSchema,
  iniciarInventarioSchema,
  uuidSchema,
  type DetalleInventarioFisico,
  type InventarioFisicoItem,
  type ItemInventarioDetalle,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';
import { registrarAsientoAutomatico } from '../services/contabilidad-service.js';

export interface InventarioRoutesOptions {
  pool: pg.Pool;
  verifyToken?: TokenVerifier | undefined;
}

function handleInventarioError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (err instanceof AuthError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: 'Datos de inventario inválidos',
      detalles: err.issues,
    });
  }
  request.log.error(
    { err, modulo: 'inventario' },
    'Error en ruta de inventario físico',
  );
  return reply.code(500).send({ error: 'Error interno del servidor' });
}

export function registerInventarioRoutes(
  app: FastifyInstance,
  options: InventarioRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Listar tomas de inventario
  app.get('/inventarios', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno', 'encargado']);

      const inventarios = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const res = await client.query<{
            id: string;
            numero: number;
            nombre: string;
            rubro_id: string | null;
            rubro_nombre: string | null;
            estado: 'en_proceso' | 'aplicado' | 'cancelado';
            total_articulos: number;
            articulos_con_diferencia: number;
            diferencia_neta_valorizada: string;
            observaciones: string | null;
            iniciado_por_nombre: string;
            aplicado_por_nombre: string | null;
            creado_en: string;
            aplicado_en: string | null;
          }>(
            `
            select i.id, i.numero, i.nombre, i.rubro_id, r.nombre as rubro_nombre,
                   i.estado, i.total_articulos, i.articulos_con_diferencia,
                   i.diferencia_neta_valorizada, i.observaciones,
                   i.iniciado_por_nombre, i.aplicado_por_nombre,
                   to_char(i.creado_en, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as creado_en,
                   to_char(i.aplicado_en, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as aplicado_en
            from inventario_fisico i
            left join rubro r on r.id = i.rubro_id and r.negocio_id = i.negocio_id
            where i.negocio_id = $1
            order by i.numero desc
            `,
            [claims.negocioId],
          );

          return res.rows.map(
            (r): InventarioFisicoItem => ({
              id: r.id,
              numero: r.numero,
              nombre: r.nombre,
              rubroId: r.rubro_id,
              rubroNombre: r.rubro_nombre,
              estado: r.estado,
              totalArticulos: r.total_articulos,
              articulosConDiferencia: r.articulos_con_diferencia,
              diferenciaNetaValorizada: r.diferencia_neta_valorizada,
              observaciones: r.observaciones,
              iniciadoPorNombre: r.iniciado_por_nombre,
              aplicadoPorNombre: r.aplicado_por_nombre,
              creadoEn: r.creado_en,
              aplicadoEn: r.aplicado_en,
            }),
          );
        },
      );

      return await reply.code(200).send({ inventarios });
    } catch (err: unknown) {
      return handleInventarioError(err, request, reply);
    }
  });

  // 2. Iniciar una nueva toma de inventario físico (general o por rubro)
  app.post('/inventarios/iniciar', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno', 'encargado']);

      const body = iniciarInventarioSchema.parse(request.body);

      const nuevoInventario = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          // Bloqueo advisory para correlatividad sin saltos
          await client.query(
            "select pg_advisory_xact_lock(hashtext('inventario_' || $1))",
            [claims.negocioId],
          );

          // Obtener nombre del usuario que inicia
          const uRes = await client.query<{ nombre: string }>(
            'select nombre from usuario where id = $1 and negocio_id = $2',
            [claims.usuarioId, claims.negocioId],
          );
          const usuarioNombre = uRes.rows[0]?.nombre ?? 'Operador';

          // Siguiente número
          const numRes = await client.query<{ sig: number }>(
            'select coalesce(max(numero), 0) + 1 as sig from inventario_fisico where negocio_id = $1',
            [claims.negocioId],
          );
          const siguienteNumero = numRes.rows[0]?.sig ?? 1;

          // Crear cabecera
          const invRes = await client.query<{
            id: string;
            numero: number;
            nombre: string;
            rubro_id: string | null;
            estado: 'en_proceso' | 'aplicado' | 'cancelado';
            observaciones: string | null;
            iniciado_por_nombre: string;
            creado_en: string;
          }>(
            `
            insert into inventario_fisico (
              negocio_id, numero, nombre, rubro_id, estado, observaciones,
              iniciado_por_usuario_id, iniciado_por_nombre
            ) values ($1, $2, $3, $4, 'en_proceso', $5, $6, $7)
            returning id, numero, nombre, rubro_id, estado, observaciones,
                      iniciado_por_nombre,
                      to_char(creado_en, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as creado_en
            `,
            [
              claims.negocioId,
              siguienteNumero,
              body.nombre,
              body.rubroId ?? null,
              body.observaciones ?? null,
              claims.usuarioId,
              usuarioNombre,
            ],
          );

          const inv = invRes.rows[0];
          if (!inv) {
            throw new Error('No se pudo crear la cabecera de inventario');
          }

          // Congelar la foto de stock actual de los artículos correspondientes
          const productosRes = await client.query<{
            id: string;
            stock_actual: string;
            costo_base: string;
          }>(
            `
            select p.id,
                   coalesce(v.stock_actual_base, 0) as stock_actual,
                   p.costo_base
            from producto p
            left join v_stock_actual v on v.producto_id = p.id and v.negocio_id = p.negocio_id
            where p.negocio_id = $1 and p.activo = true
              and ($2::uuid is null or p.rubro_id = $2::uuid)
            order by p.nombre asc
            `,
            [claims.negocioId, body.rubroId ?? null],
          );

          if (productosRes.rows.length > 0) {
            for (const prod of productosRes.rows) {
              await client.query(
                `
                insert into item_inventario_fisico (
                  negocio_id, inventario_id, producto_id, stock_sistema, costo_unitario
                ) values ($1, $2, $3, $4, $5)
                `,
                [
                  claims.negocioId,
                  inv.id,
                  prod.id,
                  prod.stock_actual,
                  prod.costo_base,
                ],
              );
            }

            // Actualizar total_articulos en la cabecera
            await client.query(
              `
              update inventario_fisico
              set total_articulos = $1
              where id = $2 and negocio_id = $3
              `,
              [productosRes.rows.length, inv.id, claims.negocioId],
            );
          }

          return {
            id: inv.id,
            numero: inv.numero,
            nombre: inv.nombre,
            rubroId: inv.rubro_id,
            rubroNombre: null,
            estado: inv.estado,
            totalArticulos: productosRes.rows.length,
            articulosConDiferencia: 0,
            diferenciaNetaValorizada: '0.00',
            observaciones: inv.observaciones,
            iniciadoPorNombre: inv.iniciado_por_nombre,
            aplicadoPorNombre: null,
            creadoEn: inv.creado_en,
            aplicadoEn: null,
          };
        },
      );

      request.log.info(
        {
          accion: 'iniciar_inventario',
          inventarioId: nuevoInventario.id,
          numero: nuevoInventario.numero,
          totalArticulos: nuevoInventario.totalArticulos,
          negocioId: claims.negocioId,
        },
        'Inventario físico iniciado',
      );

      return await reply.code(201).send({ inventario: nuevoInventario });
    } catch (err: unknown) {
      return handleInventarioError(err, request, reply);
    }
  });

  // 3. Detalle completo de un inventario con sus ítems
  app.get('/inventarios/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const params = request.params as { id: string };
      const inventarioId = uuidSchema.parse(params.id);

      const detalle = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }): Promise<DetalleInventarioFisico | null> => {
          const invRes = await client.query<{
            id: string;
            numero: number;
            nombre: string;
            rubro_id: string | null;
            rubro_nombre: string | null;
            estado: 'en_proceso' | 'aplicado' | 'cancelado';
            total_articulos: number;
            articulos_con_diferencia: number;
            diferencia_neta_valorizada: string;
            observaciones: string | null;
            iniciado_por_nombre: string;
            aplicado_por_nombre: string | null;
            creado_en: string;
            aplicado_en: string | null;
          }>(
            `
            select i.id, i.numero, i.nombre, i.rubro_id, r.nombre as rubro_nombre,
                   i.estado, i.total_articulos, i.articulos_con_diferencia,
                   i.diferencia_neta_valorizada, i.observaciones,
                   i.iniciado_por_nombre, i.aplicado_por_nombre,
                   to_char(i.creado_en, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as creado_en,
                   to_char(i.aplicado_en, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as aplicado_en
            from inventario_fisico i
            left join rubro r on r.id = i.rubro_id and r.negocio_id = i.negocio_id
            where i.id = $1 and i.negocio_id = $2
            `,
            [inventarioId, claims.negocioId],
          );

          const inv = invRes.rows[0];
          if (!inv) return null;

          const itemsRes = await client.query<{
            id: string;
            inventario_id: string;
            producto_id: string;
            producto_codigo: string;
            producto_nombre: string;
            rubro_nombre: string | null;
            unidad_principal: string;
            stock_sistema: string;
            stock_contado: string | null;
            diferencia: string;
            costo_unitario: string;
            diferencia_valorizada: string;
            contado_en: string | null;
            contado_por_nombre: string | null;
          }>(
            `
            select it.id, it.inventario_id, it.producto_id,
                   p.codigo as producto_codigo, p.nombre as producto_nombre,
                   r.nombre as rubro_nombre, p.unidad_principal,
                   it.stock_sistema, it.stock_contado, it.diferencia,
                   it.costo_unitario, it.diferencia_valorizada,
                   to_char(it.contado_en, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as contado_en,
                   it.contado_por_nombre
            from item_inventario_fisico it
            join producto p on p.id = it.producto_id and p.negocio_id = it.negocio_id
            left join rubro r on r.id = p.rubro_id and r.negocio_id = p.negocio_id
            where it.inventario_id = $1 and it.negocio_id = $2
            order by p.nombre asc
            `,
            [inventarioId, claims.negocioId],
          );

          return {
            inventario: {
              id: inv.id,
              numero: inv.numero,
              nombre: inv.nombre,
              rubroId: inv.rubro_id,
              rubroNombre: inv.rubro_nombre,
              estado: inv.estado,
              totalArticulos: inv.total_articulos,
              articulosConDiferencia: inv.articulos_con_diferencia,
              diferenciaNetaValorizada: inv.diferencia_neta_valorizada,
              observaciones: inv.observaciones,
              iniciadoPorNombre: inv.iniciado_por_nombre,
              aplicadoPorNombre: inv.aplicado_por_nombre,
              creadoEn: inv.creado_en,
              aplicadoEn: inv.aplicado_en,
            },
            items: itemsRes.rows.map(
              (r): ItemInventarioDetalle => ({
                id: r.id,
                inventarioId: r.inventario_id,
                productoId: r.producto_id,
                productoCodigo: r.producto_codigo,
                productoNombre: r.producto_nombre,
                rubroNombre: r.rubro_nombre,
                unidadPrincipal: r.unidad_principal,
                stockSistema: r.stock_sistema,
                stockContado: r.stock_contado,
                diferencia: r.diferencia,
                costoUnitario: r.costo_unitario,
                diferenciaValorizada: r.diferencia_valorizada,
                contadoEn: r.contado_en,
                contadoPorNombre: r.contado_por_nombre,
              }),
            ),
          };
        },
      );

      if (!detalle) {
        return await reply
          .code(404)
          .send({ error: 'Inventario físico no encontrado' });
      }

      return await reply.code(200).send(detalle);
    } catch (err: unknown) {
      return handleInventarioError(err, request, reply);
    }
  });

  // 4. Guardar conteos progresivos del inventario
  app.put('/inventarios/:id/conteos', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const params = request.params as { id: string };
      const inventarioId = uuidSchema.parse(params.id);
      const body = guardarConteosInventarioSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          // Verificar que el inventario exista y esté en proceso
          const invCheck = await client.query<{ estado: string }>(
            'select estado from inventario_fisico where id = $1 and negocio_id = $2',
            [inventarioId, claims.negocioId],
          );
          const estado = invCheck.rows[0]?.estado;
          if (!estado) return { noEncontrado: true };
          if (estado !== 'en_proceso') return { yaFinalizado: true };

          // Obtener nombre del operador
          const uRes = await client.query<{ nombre: string }>(
            'select nombre from usuario where id = $1 and negocio_id = $2',
            [claims.usuarioId, claims.negocioId],
          );
          const operadorNombre = uRes.rows[0]?.nombre ?? 'Operador';

          // Actualizar cada conteo
          for (const item of body.items) {
            await client.query(
              `
              update item_inventario_fisico
              set stock_contado = $1,
                  diferencia = $1 - stock_sistema,
                  diferencia_valorizada = round(($1 - stock_sistema) * costo_unitario, 2),
                  contado_en = now(),
                  contado_por_nombre = coalesce($2, $3)
              where inventario_id = $4 and producto_id = $5 and negocio_id = $6
              `,
              [
                item.stockContado,
                item.contadoPorNombre ?? null,
                operadorNombre,
                inventarioId,
                item.productoId,
                claims.negocioId,
              ],
            );
          }

          // Recalcular métricas en inventario_fisico
          await client.query(
            `
            update inventario_fisico
            set articulos_con_diferencia = (
                  select count(*) from item_inventario_fisico
                  where inventario_id = $1 and negocio_id = $2
                    and stock_contado is not null and diferencia <> 0
                ),
                diferencia_neta_valorizada = (
                  select coalesce(sum(diferencia_valorizada), 0) from item_inventario_fisico
                  where inventario_id = $1 and negocio_id = $2
                    and stock_contado is not null
                )
            where id = $1 and negocio_id = $2
            `,
            [inventarioId, claims.negocioId],
          );

          return { ok: true };
        },
      );

      if ('noEncontrado' in resultado) {
        return await reply
          .code(404)
          .send({ error: 'Inventario físico no encontrado' });
      }
      if ('yaFinalizado' in resultado) {
        return await reply.code(400).send({
          error:
            'El inventario ya fue aplicado o cancelado y no admite modificaciones',
        });
      }

      return await reply
        .code(200)
        .send({ ok: true, mensaje: 'Conteos guardados correctamente' });
    } catch (err: unknown) {
      return handleInventarioError(err, request, reply);
    }
  });

  // 5. Aplicar y consolidar inventario físico (impacta kardex y contabilidad)
  app.post('/inventarios/:id/aplicar', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const params = request.params as { id: string };
      const inventarioId = uuidSchema.parse(params.id);
      const body = aplicarInventarioSchema.parse(request.body ?? {});

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const invRes = await client.query<{
            id: string;
            numero: number;
            nombre: string;
            estado: string;
            diferencia_neta_valorizada: string;
          }>(
            `
            select id, numero, nombre, estado, diferencia_neta_valorizada
            from inventario_fisico
            where id = $1 and negocio_id = $2
            `,
            [inventarioId, claims.negocioId],
          );

          const inv = invRes.rows[0];
          if (!inv) return { noEncontrado: true };
          if (inv.estado !== 'en_proceso') return { yaFinalizado: true };

          // Obtener nombre del usuario que aplica
          const uRes = await client.query<{ nombre: string }>(
            'select nombre from usuario where id = $1 and negocio_id = $2',
            [claims.usuarioId, claims.negocioId],
          );
          const usuarioNombre = uRes.rows[0]?.nombre ?? 'Encargado';

          // Obtener todos los ítems que tienen conteo y diferencia
          const itemsDiffRes = await client.query<{
            producto_id: string;
            producto_codigo: string;
            unidad_principal: string;
            diferencia: string;
            costo_unitario: string;
            diferencia_valorizada: string;
          }>(
            `
            select it.producto_id, p.codigo as producto_codigo, p.unidad_principal,
                   it.diferencia, it.costo_unitario, it.diferencia_valorizada
            from item_inventario_fisico it
            join producto p on p.id = it.producto_id and p.negocio_id = it.negocio_id
            where it.inventario_id = $1 and it.negocio_id = $2
              and it.stock_contado is not null
              and it.diferencia <> 0
            `,
            [inventarioId, claims.negocioId],
          );

          let movimientosGenerados = 0;

          // 1. Registrar movimientos inmutables en movimiento_stock
          for (const it of itemsDiffRes.rows) {
            const diffNum = parseFloat(it.diferencia);
            if (diffNum > 0) {
              // Sobrante de stock: inyecta stock
              await client.query(
                `
                insert into movimiento_stock (
                  id, negocio_id, producto_id, tipo, sentido, cantidad,
                  unidad, cantidad_base, costo_unitario, notas, creado_por
                ) values ($1, $2, $3, 'ajuste_sobrante', 'in', $4, $5, $4, $6, $7, $8)
                `,
                [
                  randomUUID(),
                  claims.negocioId,
                  it.producto_id,
                  it.diferencia,
                  it.unidad_principal,
                  it.costo_unitario,
                  `Conciliación Inventario #${inv.numero}: Sobrante de ${it.diferencia}`,
                  claims.usuarioId,
                ],
              );
              movimientosGenerados++;
            } else if (diffNum < 0) {
              // Faltante de stock / merma: reduce stock
              const cantPositiva = Math.abs(diffNum).toFixed(3);
              await client.query(
                `
                insert into movimiento_stock (
                  id, negocio_id, producto_id, tipo, sentido, cantidad,
                  unidad, cantidad_base, costo_unitario, notas, creado_por
                ) values ($1, $2, $3, 'ajuste_faltante', 'out', $4, $5, $4, $6, $7, $8)
                `,
                [
                  randomUUID(),
                  claims.negocioId,
                  it.producto_id,
                  cantPositiva,
                  it.unidad_principal,
                  it.costo_unitario,
                  `Conciliación Inventario #${inv.numero}: Faltante de ${cantPositiva}`,
                  claims.usuarioId,
                ],
              );
              movimientosGenerados++;
            }
          }

          // 2. Asiento contable automático por diferencia neta valorizada
          let asientoId: string | null = null;
          const diffCents = aCentavos(inv.diferencia_neta_valorizada);

          if (diffCents !== 0n) {
            if (diffCents < 0n) {
              // Pérdida neta por faltante: Débito Gastos Operativos (5.1.02), Crédito Mercaderías en Stock (1.1.05)
              const montoAbsoluto = deCentavos(-diffCents);
              asientoId = await registrarAsientoAutomatico(client, {
                negocioId: claims.negocioId,
                concepto: `Ajuste por Faltante de Inventario Físico #${inv.numero}`,
                origen: 'ajuste',
                referenciaId: inv.id,
                usuarioId: claims.usuarioId,
                renglones: [
                  {
                    cuentaCodigo: '5.1.02',
                    debe: montoAbsoluto,
                    haber: '0.00',
                    descripcion: `Pérdida por merma/faltante inventario #${inv.numero}`,
                  },
                  {
                    cuentaCodigo: '1.1.05',
                    debe: '0.00',
                    haber: montoAbsoluto,
                    descripcion: `Disminución de mercaderías inventario #${inv.numero}`,
                  },
                ],
              });
            } else {
              // Ganancia neta por sobrante: Débito Mercaderías en Stock (1.1.05), Crédito Otros Ingresos (4.1.02)
              const montoAbsoluto = deCentavos(diffCents);
              asientoId = await registrarAsientoAutomatico(client, {
                negocioId: claims.negocioId,
                concepto: `Ajuste por Sobrante de Inventario Físico #${inv.numero}`,
                origen: 'ajuste',
                referenciaId: inv.id,
                usuarioId: claims.usuarioId,
                renglones: [
                  {
                    cuentaCodigo: '1.1.05',
                    debe: montoAbsoluto,
                    haber: '0.00',
                    descripcion: `Aumento de mercaderías inventario #${inv.numero}`,
                  },
                  {
                    cuentaCodigo: '4.1.02',
                    debe: '0.00',
                    haber: montoAbsoluto,
                    descripcion: `Sobrante de mercaderías inventario #${inv.numero}`,
                  },
                ],
              });
            }
          }

          // 3. Marcar inventario como aplicado
          await client.query(
            `
            update inventario_fisico
            set estado = 'aplicado',
                aplicado_por_usuario_id = $1,
                aplicado_por_nombre = $2,
                aplicado_en = now(),
                asiento_id = $3,
                observaciones = coalesce($4, observaciones)
            where id = $5 and negocio_id = $6
            `,
            [
              claims.usuarioId,
              usuarioNombre,
              asientoId,
              body.observaciones ?? null,
              inv.id,
              claims.negocioId,
            ],
          );

          return {
            ok: true,
            movimientosGenerados,
            asientoId,
          };
        },
      );

      if ('noEncontrado' in resultado) {
        return await reply
          .code(404)
          .send({ error: 'Inventario físico no encontrado' });
      }
      if ('yaFinalizado' in resultado) {
        return await reply
          .code(400)
          .send({ error: 'El inventario ya fue aplicado o cancelado' });
      }

      request.log.info(
        {
          accion: 'aplicar_inventario',
          inventarioId,
          movimientosGenerados: resultado.movimientosGenerados,
          asientoId: resultado.asientoId,
          negocioId: claims.negocioId,
        },
        'Inventario físico aplicado con conciliación de stock',
      );

      return await reply.code(200).send({
        ok: true,
        mensaje: 'Inventario aplicado y stock conciliado con éxito',
        movimientosGenerados: resultado.movimientosGenerados,
        asientoId: resultado.asientoId,
      });
    } catch (err: unknown) {
      return handleInventarioError(err, request, reply);
    }
  });

  // 6. Cancelar inventario físico sin aplicar movimientos
  app.post('/inventarios/:id/cancelar', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const params = request.params as { id: string };
      const inventarioId = uuidSchema.parse(params.id);

      const cancelado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const res = await client.query(
            `
            update inventario_fisico
            set estado = 'cancelado'
            where id = $1 and negocio_id = $2 and estado = 'en_proceso'
            returning id
            `,
            [inventarioId, claims.negocioId],
          );
          return (res.rowCount ?? 0) > 0;
        },
      );

      if (!cancelado) {
        return await reply.code(400).send({
          error:
            'Inventario no encontrado o ya no se encuentra en estado en proceso',
        });
      }

      request.log.info(
        {
          accion: 'cancelar_inventario',
          inventarioId,
          negocioId: claims.negocioId,
        },
        'Inventario físico cancelado por encargado',
      );

      return await reply
        .code(200)
        .send({ ok: true, mensaje: 'Inventario cancelado correctamente' });
    } catch (err: unknown) {
      return handleInventarioError(err, request, reply);
    }
  });
}
