import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import {
  actualizarReglaVolumenSchema,
  crearListaPrecioSchema,
  crearReglaVolumenSchema,
  fijarPrecioProductoListaSchema,
  uuidSchema,
  type ReglaDescuentoVolumenItem,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';

export interface PreciosReglasRoutesOptions {
  pool: pg.Pool;
  verifyToken?: TokenVerifier | undefined;
}

function handlePreciosReglasError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (err instanceof AuthError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: 'Datos de listas o reglas inválidos',
      detalles: err.issues,
    });
  }
  request.log.error(
    { err, modulo: 'precios-reglas' },
    'Error en rutas de listas de precios y reglas de volumen',
  );
  return reply.code(500).send({ error: 'Error interno del servidor' });
}

export function registerPreciosReglasRoutes(
  app: FastifyInstance,
  options: PreciosReglasRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Crear nueva lista de precios (solo dueño)
  app.post('/listas-precios', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno']);

      const body = crearListaPrecioSchema.parse(request.body);

      const nuevaLista = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          // Verificar nombre no duplicado
          const existRes = await client.query(
            'select id from lista_precio where negocio_id = $1 and lower(nombre) = lower($2)',
            [claims.negocioId, body.nombre],
          );
          if ((existRes.rowCount ?? 0) > 0) {
            throw new AuthError('Ya existe una lista de precios con ese nombre', 400);
          }

          const res = await client.query<{
            id: string;
            nombre: string;
            margen_pct: string;
            orden: number;
            activo: boolean;
            creado_en: string;
          }>(
            `
            insert into lista_precio (
              id, negocio_id, nombre, margen_pct, orden, activo
            ) values ($1, $2, $3, $4, $5, $6)
            returning id, nombre, margen_pct as "margenPct", orden, activo,
                      to_char(creado_en, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "creadoEn"
            `,
            [
              randomUUID(),
              claims.negocioId,
              body.nombre,
              body.margenPct,
              body.orden,
              body.activo,
            ],
          );

          return res.rows[0];
        },
      );

      return await reply.code(201).send(nuevaLista);
    } catch (err: unknown) {
      return handlePreciosReglasError(err, request, reply);
    }
  });

  // 2. Eliminar lista de precios (solo dueño, prohibido eliminar la lista 'Mostrador')
  app.delete('/listas-precios/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno']);

      const { id } = request.params as { id: string };
      uuidSchema.parse(id);

      await withTenantTransaction(pool, claims.negocioId, async ({ client }) => {
        const existRes = await client.query<{ nombre: string }>(
          'select nombre from lista_precio where id = $1 and negocio_id = $2',
          [id, claims.negocioId],
        );
        const l = existRes.rows[0];
        if (!l) {
          throw new AuthError('Lista de precios no encontrada', 404);
        }
        if (l.nombre.toLowerCase() === 'mostrador') {
          throw new AuthError('No se puede eliminar la lista de precios Mostrador base', 400);
        }

        // Baja lógica o borrado en cascada
        await client.query(
          'delete from lista_precio where id = $1 and negocio_id = $2',
          [id, claims.negocioId],
        );
      });

      return await reply.send({ ok: true, mensaje: 'Lista de precios eliminada' });
    } catch (err: unknown) {
      return handlePreciosReglasError(err, request, reply);
    }
  });

  // 3. Fijar o sobreescribir precio fijo por producto en una lista (dueno o encargado)
  app.post('/listas-precios/fijar-precio', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno', 'encargado']);

      const body = fijarPrecioProductoListaSchema.parse(request.body);

      const precioGuardado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          // Verificar que el producto y la lista existan en este tenant
          const prodCheck = await client.query(
            'select id from producto where id = $1 and negocio_id = $2',
            [body.productoId, claims.negocioId],
          );
          if ((prodCheck.rowCount ?? 0) === 0) {
            throw new AuthError('Producto no encontrado', 404);
          }

          const listaCheck = await client.query(
            'select id from lista_precio where id = $1 and negocio_id = $2',
            [body.listaPrecioId, claims.negocioId],
          );
          if ((listaCheck.rowCount ?? 0) === 0) {
            throw new AuthError('Lista de precios no encontrada', 404);
          }

          const res = await client.query<{
            id: string;
            producto_id: string;
            lista_precio_id: string;
            precio_fijo: string;
          }>(
            `
            insert into precio_producto_lista (
              id, negocio_id, producto_id, lista_precio_id, precio_fijo, actualizado_en
            ) values ($1, $2, $3, $4, $5, now())
            on conflict (negocio_id, producto_id, lista_precio_id)
            do update set precio_fijo = excluded.precio_fijo, actualizado_en = now()
            returning id, producto_id as "productoId", lista_precio_id as "listaPrecioId", precio_fijo as "precioFijo"
            `,
            [
              randomUUID(),
              claims.negocioId,
              body.productoId,
              body.listaPrecioId,
              body.precioFijo,
            ],
          );

          return res.rows[0];
        },
      );

      return await reply.code(200).send(precioGuardado);
    } catch (err: unknown) {
      return handlePreciosReglasError(err, request, reply);
    }
  });

  // 4. Eliminar precio fijo (volver al cálculo por margen de la lista)
  app.delete(
    '/listas-precios/fijar-precio/:productoId/:listaPrecioId',
    async (request, reply) => {
      try {
        const claims = await authenticateRequest(request, verifyToken);
        assertRoles(claims, ['dueno', 'encargado']);

        const { productoId, listaPrecioId } = request.params as {
          productoId: string;
          listaPrecioId: string;
        };
        uuidSchema.parse(productoId);
        uuidSchema.parse(listaPrecioId);

        await withTenantTransaction(pool, claims.negocioId, async ({ client }) => {
          await client.query(
            'delete from precio_producto_lista where producto_id = $1 and lista_precio_id = $2 and negocio_id = $3',
            [productoId, listaPrecioId, claims.negocioId],
          );
        });

        return await reply.send({ ok: true, mensaje: 'Precio fijo eliminado' });
      } catch (err: unknown) {
        return handlePreciosReglasError(err, request, reply);
      }
    },
  );

  // 5. Listar reglas de descuento por volumen activas
  app.get('/reglas-volumen', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);

      const reglas = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const res = await client.query<{
            id: string;
            nombre: string;
            producto_id: string | null;
            producto_codigo: string | null;
            producto_nombre: string | null;
            rubro_id: string | null;
            rubro_nombre: string | null;
            lista_precio_id: string | null;
            lista_precio_nombre: string | null;
            cantidad_minima: string;
            descuento_pct: string;
            activo: boolean;
            creado_en: string;
          }>(
            `
            select r.id, r.nombre, r.producto_id, p.codigo as producto_codigo, p.nombre as producto_nombre,
                   r.rubro_id, rb.nombre as rubro_nombre,
                   r.lista_precio_id, lp.nombre as lista_precio_nombre,
                   r.cantidad_minima, r.descuento_pct, r.activo,
                   to_char(r.creado_en, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as creado_en
            from regla_descuento_volumen r
            left join producto p on p.id = r.producto_id and p.negocio_id = r.negocio_id
            left join rubro rb on rb.id = r.rubro_id and rb.negocio_id = r.negocio_id
            left join lista_precio lp on lp.id = r.lista_precio_id and lp.negocio_id = r.negocio_id
            where r.negocio_id = $1
            order by r.activo desc, r.descuento_pct desc, r.cantidad_minima asc
            `,
            [claims.negocioId],
          );

          return res.rows.map(
            (row): ReglaDescuentoVolumenItem => ({
              id: row.id,
              nombre: row.nombre,
              productoId: row.producto_id,
              productoCodigo: row.producto_codigo,
              productoNombre: row.producto_nombre,
              rubroId: row.rubro_id,
              rubroNombre: row.rubro_nombre,
              listaPrecioId: row.lista_precio_id,
              listaPrecioNombre: row.lista_precio_nombre,
              cantidadMinima: row.cantidad_minima,
              descuentoPct: row.descuento_pct,
              activo: row.activo,
              creadoEn: row.creado_en,
            }),
          );
        },
      );

      return await reply.send(reglas);
    } catch (err: unknown) {
      return handlePreciosReglasError(err, request, reply);
    }
  });

  // 6. Crear regla de descuento por volumen (dueno o encargado)
  app.post('/reglas-volumen', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno', 'encargado']);

      const body = crearReglaVolumenSchema.parse(request.body);

      const nuevaRegla = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          if (body.productoId) {
            const pCheck = await client.query(
              'select id from producto where id = $1 and negocio_id = $2',
              [body.productoId, claims.negocioId],
            );
            if ((pCheck.rowCount ?? 0) === 0) {
              throw new AuthError('Producto no encontrado', 404);
            }
          }

          if (body.rubroId) {
            const rCheck = await client.query(
              'select id from rubro where id = $1 and negocio_id = $2',
              [body.rubroId, claims.negocioId],
            );
            if ((rCheck.rowCount ?? 0) === 0) {
              throw new AuthError('Rubro no encontrado', 404);
            }
          }

          if (body.listaPrecioId) {
            const lpCheck = await client.query(
              'select id from lista_precio where id = $1 and negocio_id = $2',
              [body.listaPrecioId, claims.negocioId],
            );
            if ((lpCheck.rowCount ?? 0) === 0) {
              throw new AuthError('Lista de precios no encontrada', 404);
            }
          }

          const res = await client.query<{
            id: string;
            nombre: string;
            producto_id: string | null;
            rubro_id: string | null;
            lista_precio_id: string | null;
            cantidad_minima: string;
            descuento_pct: string;
            activo: boolean;
            creado_en: string;
          }>(
            `
            insert into regla_descuento_volumen (
              id, negocio_id, nombre, producto_id, rubro_id, lista_precio_id,
              cantidad_minima, descuento_pct, activo
            ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            returning id, nombre, producto_id, rubro_id, lista_precio_id,
                      cantidad_minima, descuento_pct, activo,
                      to_char(creado_en, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as creado_en
            `,
            [
              randomUUID(),
              claims.negocioId,
              body.nombre,
              body.productoId ?? null,
              body.rubroId ?? null,
              body.listaPrecioId ?? null,
              body.cantidadMinima,
              body.descuentoPct,
              body.activo,
            ],
          );

          const r = res.rows[0];
          if (!r) throw new Error('No se pudo crear la regla de volumen');

          return {
            id: r.id,
            nombre: r.nombre,
            productoId: r.producto_id,
            productoCodigo: null,
            productoNombre: null,
            rubroId: r.rubro_id,
            rubroNombre: null,
            listaPrecioId: r.lista_precio_id,
            listaPrecioNombre: null,
            cantidadMinima: r.cantidad_minima,
            descuentoPct: r.descuento_pct,
            activo: r.activo,
            creadoEn: r.creado_en,
          };
        },
      );

      return await reply.code(201).send(nuevaRegla);
    } catch (err: unknown) {
      return handlePreciosReglasError(err, request, reply);
    }
  });

  // 7. Modificar regla de volumen
  app.put('/reglas-volumen/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno', 'encargado']);

      const { id } = request.params as { id: string };
      uuidSchema.parse(id);

      const body = actualizarReglaVolumenSchema.parse(request.body);

      const reglaActualizada = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const existRes = await client.query(
            'select id from regla_descuento_volumen where id = $1 and negocio_id = $2',
            [id, claims.negocioId],
          );
          if ((existRes.rowCount ?? 0) === 0) {
            throw new AuthError('Regla de volumen no encontrada', 404);
          }

          const res = await client.query<{
            id: string;
            nombre: string;
            producto_id: string | null;
            rubro_id: string | null;
            lista_precio_id: string | null;
            cantidad_minima: string;
            descuento_pct: string;
            activo: boolean;
            creado_en: string;
          }>(
            `
            update regla_descuento_volumen
            set
              nombre = coalesce($1, nombre),
              producto_id = case when $2::text is not null then $3::uuid else producto_id end,
              rubro_id = case when $4::text is not null then $5::uuid else rubro_id end,
              lista_precio_id = case when $6::text is not null then $7::uuid else lista_precio_id end,
              cantidad_minima = coalesce($8, cantidad_minima),
              descuento_pct = coalesce($9, descuento_pct),
              activo = coalesce($10, activo)
            where id = $11 and negocio_id = $12
            returning id, nombre, producto_id, rubro_id, lista_precio_id,
                      cantidad_minima, descuento_pct, activo,
                      to_char(creado_en, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as creado_en
            `,
            [
              body.nombre ?? null,
              body.productoId !== undefined ? 'set' : null,
              body.productoId ?? null,
              body.rubroId !== undefined ? 'set' : null,
              body.rubroId ?? null,
              body.listaPrecioId !== undefined ? 'set' : null,
              body.listaPrecioId ?? null,
              body.cantidadMinima ?? null,
              body.descuentoPct ?? null,
              body.activo ?? null,
              id,
              claims.negocioId,
            ],
          );

          const r = res.rows[0];
          if (!r) throw new Error('Error al actualizar regla');

          return {
            id: r.id,
            nombre: r.nombre,
            productoId: r.producto_id,
            productoCodigo: null,
            productoNombre: null,
            rubroId: r.rubro_id,
            rubroNombre: null,
            listaPrecioId: r.lista_precio_id,
            listaPrecioNombre: null,
            cantidadMinima: r.cantidad_minima,
            descuentoPct: r.descuento_pct,
            activo: r.activo,
            creadoEn: r.creado_en,
          };
        },
      );

      return await reply.send(reglaActualizada);
    } catch (err: unknown) {
      return handlePreciosReglasError(err, request, reply);
    }
  });

  // 8. Eliminar regla de volumen
  app.delete('/reglas-volumen/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno', 'encargado']);

      const { id } = request.params as { id: string };
      uuidSchema.parse(id);

      await withTenantTransaction(pool, claims.negocioId, async ({ client }) => {
        const delRes = await client.query(
          'delete from regla_descuento_volumen where id = $1 and negocio_id = $2',
          [id, claims.negocioId],
        );
        if ((delRes.rowCount ?? 0) === 0) {
          throw new AuthError('Regla de volumen no encontrada', 404);
        }
      });

      return await reply.send({ ok: true, mensaje: 'Regla de volumen eliminada' });
    } catch (err: unknown) {
      return handlePreciosReglasError(err, request, reply);
    }
  });
}
