import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import {
  ajusteStockSchema,
  guardarListaPrecioSchema,
  guardarProductoSchema,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';
import {
  listaPrecio,
  movimientoStock,
  producto,
  productoCodigoBarra,
} from '../db/schema.js';
import { lookupEanExterno } from '../services/catalog-lookup.js';

export interface ProductosRoutesOptions {
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
      error: 'Datos inválidos',
      detalles: err.issues,
    });
  }
  request.log.error({ err, modulo: 'productos' }, 'Error en ruta de productos');
  return reply.code(500).send({ error: 'Error interno del servidor' });
}

export function registerProductosRoutes(
  app: FastifyInstance,
  options: ProductosRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Lookup de código de barras / EAN: busca primero local y luego en Mercado Libre
  app.get('/productos/lookup-ean/:codigo', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const params = request.params as { codigo: string };
      const codigoBuscado = params.codigo.trim();

      const resultadoLocal = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          // Busca coincidencia en códigos de barra o código SKU interno
          const res = await client.query<{
            producto_id: string;
            codigo: string;
            nombre: string;
            marca: string | null;
            imagen_url: string | null;
            costo_base: string;
            stock_actual_base: string;
            unidad_principal: string;
            unidad_secundaria: string | null;
            factor_conversion: string;
            permite_fraccion: boolean;
            rubro_nombre: string | null;
          }>(
            `select p.id as producto_id, p.codigo, p.nombre, p.marca, p.imagen_url,
                    p.costo_base, coalesce(s.stock_actual_base, 0) as stock_actual_base,
                    p.unidad_principal, p.unidad_secundaria, p.factor_conversion, p.permite_fraccion,
                    r.nombre as rubro_nombre
             from producto p
             left join v_stock_actual s on s.producto_id = p.id
             left join rubro r on r.id = p.rubro_id
             left join producto_codigo_barra cb on cb.producto_id = p.id
             where (cb.codigo_barra = $1 or p.codigo = $1 or p.codigo_qr = $1)
               and p.activo = true
             limit 1`,
            [codigoBuscado],
          );

          const prod = res.rows[0];
          if (!prod) return null;

          // Obtener precios por lista para este producto
          const preciosRes = await client.query<{
            lista_nombre: string;
            precio_venta_principal: string;
            precio_venta_secundaria: string | null;
          }>(
            `select lista_nombre, precio_venta_principal, precio_venta_secundaria
             from v_precios_producto
             where producto_id = $1`,
            [prod.producto_id],
          );

          const preciosMap: Record<string, string> = {};
          for (const row of preciosRes.rows) {
            preciosMap[row.lista_nombre] = row.precio_venta_principal;
          }

          return {
            encontrado: true as const,
            origen: 'local' as const,
            codigoBarra: codigoBuscado,
            productoId: prod.producto_id,
            codigo: prod.codigo,
            nombre: prod.nombre,
            marca: prod.marca ?? undefined,
            imagenUrl: prod.imagen_url ?? undefined,
            rubroSugerido: prod.rubro_nombre ?? undefined,
            costoBase: prod.costo_base,
            stockActualBase: prod.stock_actual_base,
            unidadPrincipal: prod.unidad_principal,
            unidadSecundaria: prod.unidad_secundaria ?? undefined,
            permiteFraccion: prod.permite_fraccion,
            precios: preciosMap,
          };
        },
      );

      if (resultadoLocal) {
        return await reply.send(resultadoLocal);
      }

      // Si no existe localmente, busca en internet (Mercado Libre)
      const resultadoExterno = await lookupEanExterno(codigoBuscado);
      return await reply.send(resultadoExterno);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 2. Listar productos con búsqueda rápida, stock actual y precios por lista
  app.get('/productos', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const query = (request.query ?? {}) as {
        q?: string;
        rubroId?: string;
        activo?: string;
      };

      const qTerm = query.q?.trim() || null;
      const rubroId = query.rubroId?.trim() || null;
      const soloActivos = query.activo !== 'false';

      const productos = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const sqlQuery = `
            select p.id, p.codigo, p.nombre, p.marca, p.descripcion, p.imagen_url, p.codigo_qr,
                   p.costo_base, p.unidad_principal, p.unidad_secundaria, p.factor_conversion,
                   p.permite_fraccion, p.stock_minimo, p.activo, p.rubro_id,
                   coalesce(r.nombre, 'Sin rubro') as rubro_nombre,
                   coalesce(s.stock_actual_base, 0) as stock_actual_base
            from producto p
            left join v_stock_actual s on s.producto_id = p.id
            left join rubro r on r.id = p.rubro_id
            where ($1::boolean is false or p.activo = true)
              and ($2::uuid is null or p.rubro_id = $2::uuid)
              and ($3::text is null or (
                p.nombre ilike '%' || $3 || '%' or
                p.codigo ilike '%' || $3 || '%' or
                p.marca ilike '%' || $3 || '%' or
                exists (
                  select 1 from producto_codigo_barra cb
                  where cb.producto_id = p.id and cb.codigo_barra ilike '%' || $3 || '%'
                )
              ))
            order by p.nombre asc
            limit 100
          `;

          interface ProductoRow {
            id: string;
            codigo: string;
            nombre: string;
            marca: string | null;
            descripcion: string | null;
            imagen_url: string | null;
            codigo_qr: string | null;
            costo_base: string;
            unidad_principal: string;
            unidad_secundaria: string | null;
            factor_conversion: string;
            permite_fraccion: boolean;
            stock_minimo: string;
            activo: boolean;
            rubro_id: string | null;
            rubro_nombre: string;
            stock_actual_base: string;
          }

          const res = await client.query<ProductoRow>(sqlQuery, [
            soloActivos,
            rubroId,
            qTerm,
          ]);

          // Cargar precios de las listas para todos los productos resultantes
          const preciosRes = await client.query<{
            producto_id: string;
            lista_nombre: string;
            precio_venta_principal: string;
            precio_venta_secundaria: string | null;
          }>(
            `select producto_id, lista_nombre, precio_venta_principal, precio_venta_secundaria
             from v_precios_producto`,
          );

          const preciosPorProducto = new Map<string, Record<string, string>>();
          for (const row of preciosRes.rows) {
            const map = preciosPorProducto.get(row.producto_id) ?? {};
            map[row.lista_nombre] = row.precio_venta_principal;
            preciosPorProducto.set(row.producto_id, map);
          }

          return res.rows.map((row) => ({
            ...row,
            precios: preciosPorProducto.get(row.id) ?? {},
          }));
        },
      );

      return await reply.send(productos);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 3. Detalle de producto con códigos de barra y últimos movimientos de stock
  app.get('/productos/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const params = request.params as { id: string };

      const detalle = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client, db }) => {
          const [prod] = await db
            .select()
            .from(producto)
            .where(eq(producto.id, params.id));

          if (!prod) {
            throw new AuthError('Producto no encontrado', 404);
          }

          const codigosBarra = await db
            .select()
            .from(productoCodigoBarra)
            .where(eq(productoCodigoBarra.productoId, params.id));

          const ultimosMovimientos = await client.query(
            `select id, tipo, sentido, cantidad, unidad, cantidad_base, costo_unitario, notas, creado_en
             from movimiento_stock
             where producto_id = $1
             order by creado_en desc
             limit 30`,
            [params.id],
          );

          const preciosRes = await client.query(
            `select lista_nombre, margen_pct, precio_venta_principal, precio_venta_secundaria
             from v_precios_producto
             where producto_id = $1`,
            [params.id],
          );

          const stockRes = await client.query<{ stock_actual_base: string }>(
            `select stock_actual_base from v_stock_actual where producto_id = $1`,
            [params.id],
          );

          return {
            producto: prod,
            codigosBarra: codigosBarra.map((c) => c.codigoBarra),
            stockActualBase: stockRes.rows[0]?.stock_actual_base ?? '0.000',
            precios: preciosRes.rows,
            movimientos: ultimosMovimientos.rows,
          };
        },
      );

      return await reply.send(detalle);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 4. Crear producto nuevo
  app.post('/productos', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const body = guardarProductoSchema.parse(request.body);

      const nuevo = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [creado] = await db
            .insert(producto)
            .values({
              negocioId: claims.negocioId,
              rubroId: body.rubroId ?? null,
              codigo: body.codigo,
              nombre: body.nombre,
              marca: body.marca ?? null,
              descripcion: body.descripcion ?? null,
              imagenUrl: body.imagenUrl || null,
              codigoQr: body.codigoQr ?? null,
              costoBase: body.costoBase,
              unidadPrincipal: body.unidadPrincipal,
              unidadSecundaria: body.unidadSecundaria || null,
              factorConversion: body.factorConversion,
              permiteFraccion: body.permiteFraccion,
              stockMinimo: body.stockMinimo,
              activo: body.activo,
            })
            .returning();

          if (creado && body.codigosBarra && body.codigosBarra.length > 0) {
            for (let i = 0; i < body.codigosBarra.length; i++) {
              const cb = body.codigosBarra[i]?.trim();
              if (cb) {
                await db
                  .insert(productoCodigoBarra)
                  .values({
                    negocioId: claims.negocioId,
                    productoId: creado.id,
                    codigoBarra: cb,
                    esPrincipal: i === 0,
                  })
                  .onConflictDoNothing();
              }
            }
          }

          return creado;
        },
      );

      return await reply.code(201).send(nuevo);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 5. Modificar producto existente
  app.put('/productos/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const params = request.params as { id: string };
      const body = guardarProductoSchema.parse(request.body);

      const actualizado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [upd] = await db
            .update(producto)
            .set({
              rubroId: body.rubroId ?? null,
              codigo: body.codigo,
              nombre: body.nombre,
              marca: body.marca ?? null,
              descripcion: body.descripcion ?? null,
              imagenUrl: body.imagenUrl || null,
              codigoQr: body.codigoQr ?? null,
              costoBase: body.costoBase,
              unidadPrincipal: body.unidadPrincipal,
              unidadSecundaria: body.unidadSecundaria || null,
              factorConversion: body.factorConversion,
              permiteFraccion: body.permiteFraccion,
              stockMinimo: body.stockMinimo,
              activo: body.activo,
            })
            .where(eq(producto.id, params.id))
            .returning();

          if (!upd) {
            throw new AuthError('Producto no encontrado', 404);
          }

          if (body.codigosBarra) {
            await db
              .delete(productoCodigoBarra)
              .where(eq(productoCodigoBarra.productoId, params.id));

            for (let i = 0; i < body.codigosBarra.length; i++) {
              const cb = body.codigosBarra[i]?.trim();
              if (cb) {
                await db
                  .insert(productoCodigoBarra)
                  .values({
                    negocioId: claims.negocioId,
                    productoId: upd.id,
                    codigoBarra: cb,
                    esPrincipal: i === 0,
                  })
                  .onConflictDoNothing();
              }
            }
          }

          return upd;
        },
      );

      return await reply.send(actualizado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 6. Consultar listas de precios
  app.get('/listas-precios', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const listas = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          return await db
            .select()
            .from(listaPrecio)
            .orderBy(asc(listaPrecio.orden), asc(listaPrecio.nombre));
        },
      );
      return await reply.send(listas);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 7. Modificar margen de lista de precios (solo dueño)
  app.put('/listas-precios/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno']);

      const params = request.params as { id: string };
      const body = guardarListaPrecioSchema.parse(request.body);

      const lista = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [upd] = await db
            .update(listaPrecio)
            .set({
              nombre: body.nombre,
              margenPct: body.margenPct,
              activo: body.activo ?? true,
              orden: body.orden ?? 1,
            })
            .where(eq(listaPrecio.id, params.id))
            .returning();
          return upd;
        },
      );

      if (!lista) {
        throw new AuthError('Lista de precios no encontrada', 404);
      }

      return await reply.send(lista);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 8. Ajuste manual de stock (recuento físico, merma, rotura o compra) - Libro inmutable
  app.post('/stock/ajuste', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const body = ajusteStockSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [prod] = await db
            .select()
            .from(producto)
            .where(eq(producto.id, body.productoId));

          if (!prod) {
            throw new AuthError('Producto no encontrado', 404);
          }

          // Si la operación se ingresa en la unidad secundaria, normalizar a unidad principal
          let cantidadBaseNum = Number(body.cantidad);
          if (body.unidad === 'secundaria') {
            const factor = Number(prod.factorConversion);
            cantidadBaseNum = factor > 0 ? cantidadBaseNum / factor : cantidadBaseNum;
          }
          const cantidadBaseStr = cantidadBaseNum.toFixed(3);

          const sentido: 'in' | 'out' =
            body.tipo === 'ajuste_sobrante' ||
            body.tipo === 'ingreso_compra' ||
            body.tipo === 'devolucion'
              ? 'in'
              : 'out';

          const [mov] = await db
            .insert(movimientoStock)
            .values({
              id: body.id,
              negocioId: claims.negocioId,
              productoId: body.productoId,
              tipo: body.tipo,
              sentido,
              cantidad: body.cantidad,
              unidad:
                body.unidad === 'secundaria'
                  ? prod.unidadSecundaria ?? 'un'
                  : prod.unidadPrincipal,
              cantidadBase: cantidadBaseStr,
              costoUnitario: body.costoUnitario ?? prod.costoBase,
              notas: body.notas ?? null,
              creadoPor: claims.usuarioId,
            })
            .returning();

          return mov;
        },
      );

      return await reply.code(201).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });
}
