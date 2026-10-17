import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import {
  aCentavos,
  deCentavos,
  guardarCategoriaSchema,
  guardarMedioPagoSchema,
  guardarRubroSchema,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';
import { categoria, medioPago, rubro } from '../db/schema.js';

export interface ConfiguracionRoutesOptions {
  pool: pg.Pool;
  verifyToken?: TokenVerifier | undefined;
}

function normalizarPct(pct: string): string {
  return deCentavos(aCentavos(pct));
}

function handleConfigError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (err instanceof AuthError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: 'Datos de configuración inválidos',
      detalles: err.issues,
    });
  }
  request.log.error(
    { err, alerta: true, modulo: 'configuracion' },
    'Error inesperado en ruta de configuración',
  );
  return reply.code(500).send({ error: 'Error interno del servidor' });
}

export function registerConfiguracionRoutes(
  app: FastifyInstance,
  options: ConfiguracionRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Healthcheck de readiness para monitoreo y alertas en producción (Railway / Cloud Run)
  app.get('/health/ready', async (request, reply) => {
    const client = await pool.connect().catch((err: unknown) => {
      request.log.error(
        { err, alerta: true, tipoAlerta: 'db_conexion_caida' },
        'ALERTA: No se pudo conectar a PostgreSQL en /health/ready',
      );
      return null;
    });

    if (client === null) {
      return await reply.code(503).send({
        status: 'unhealthy',
        db: 'down',
        timestamp: new Date().toISOString(),
      });
    }

    try {
      await client.query('begin');
      await client.query('set local role app_user');
      const roleRes = await client.query<{ current_user: string }>(
        'select current_user',
      );
      await client.query('commit');

      return await reply.code(200).send({
        status: 'ready',
        db: 'ok',
        dbRole: roleRes.rows[0]?.current_user ?? 'app_user',
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      await client.query('rollback').catch(() => {});
      request.log.error(
        { err, alerta: true, tipoAlerta: 'db_query_fallida' },
        'ALERTA: Falló la verificación de app_user en /health/ready',
      );
      return await reply.code(503).send({
        status: 'unhealthy',
        db: 'error',
        timestamp: new Date().toISOString(),
      });
    } finally {
      client.release();
    }
  });

  // 2. Consultar todos los catálogos del negocio actual
  app.get('/configuracion/catalogos', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const medios = await db
            .select()
            .from(medioPago)
            .orderBy(asc(medioPago.nombre));
          const rubros = await db
            .select()
            .from(rubro)
            .orderBy(asc(rubro.nombre));
          const categorias = await db
            .select()
            .from(categoria)
            .orderBy(asc(categoria.tipo), asc(categoria.nombre));

          return {
            mediosPago: medios.map((m) => ({
              ...m,
              comisionPct: normalizarPct(m.comisionPct),
            })),
            rubros,
            categorias,
          };
        },
      );

      return await reply.code(200).send(resultado);
    } catch (err: unknown) {
      return handleConfigError(err, request, reply);
    }
  });

  // 3. Crear o actualizar un medio de pago real (días de acreditación y comisión) — solo rol dueno
  app.post('/configuracion/medios-pago', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno']);

      const body = guardarMedioPagoSchema.parse(request.body);
      const comisionNormalizada = normalizarPct(body.comisionPct);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client, db }) => {
          if (body.id !== undefined) {
            const [actualizado] = await db
              .update(medioPago)
              .set({
                nombre: body.nombre,
                esEfectivo: body.esEfectivo,
                diasAcreditacion: body.diasAcreditacion,
                comisionPct: comisionNormalizada,
                activo: body.activo ?? true,
              })
              .where(eq(medioPago.id, body.id))
              .returning();

            if (actualizado === undefined) {
              return null;
            }
            return {
              ...actualizado,
              comisionPct: normalizarPct(actualizado.comisionPct),
            };
          }

          const res = await client.query<{
            id: string;
            negocio_id: string;
            nombre: string;
            es_efectivo: boolean;
            dias_acreditacion: number;
            comision_pct: string;
            activo: boolean;
          }>(
            `
            insert into medio_pago (negocio_id, nombre, es_efectivo, dias_acreditacion, comision_pct, activo)
            values ($1, $2, $3, $4, $5, $6)
            on conflict (negocio_id, nombre) do update
              set es_efectivo = excluded.es_efectivo,
                  dias_acreditacion = excluded.dias_acreditacion,
                  comision_pct = excluded.comision_pct,
                  activo = excluded.activo
            returning id, negocio_id, nombre, es_efectivo, dias_acreditacion, comision_pct, activo
            `,
            [
              claims.negocioId,
              body.nombre,
              body.esEfectivo,
              body.diasAcreditacion,
              comisionNormalizada,
              body.activo ?? true,
            ],
          );

          const fila = res.rows[0];
          if (fila === undefined) {
            return null;
          }

          return {
            id: fila.id,
            negocioId: fila.negocio_id,
            nombre: fila.nombre,
            esEfectivo: fila.es_efectivo,
            diasAcreditacion: fila.dias_acreditacion,
            comisionPct: normalizarPct(fila.comision_pct),
            activo: fila.activo,
          };
        },
      );

      if (resultado === null) {
        return await reply
          .code(404)
          .send({ error: 'Medio de pago no encontrado' });
      }

      request.log.info(
        {
          accion: 'configurar_medio_pago',
          usuarioId: claims.usuarioId,
          negocioId: claims.negocioId,
          medioPagoId: resultado.id,
          nombre: resultado.nombre,
          diasAcreditacion: resultado.diasAcreditacion,
          comisionPct: resultado.comisionPct,
        },
        'Medio de pago configurado por dueño',
      );

      return await reply.code(200).send({ medioPago: resultado });
    } catch (err: unknown) {
      return handleConfigError(err, request, reply);
    }
  });

  // 4. Crear o actualizar un rubro real de la ferretería — solo rol dueno
  app.post('/configuracion/rubros', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno']);

      const body = guardarRubroSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client, db }) => {
          if (body.id !== undefined) {
            const [actualizado] = await db
              .update(rubro)
              .set({ nombre: body.nombre })
              .where(eq(rubro.id, body.id))
              .returning();
            return actualizado ?? null;
          }

          const res = await client.query<{
            id: string;
            negocio_id: string;
            nombre: string;
          }>(
            `
            insert into rubro (negocio_id, nombre)
            values ($1, $2)
            on conflict (negocio_id, nombre) do update
              set nombre = excluded.nombre
            returning id, negocio_id, nombre
            `,
            [claims.negocioId, body.nombre],
          );

          const fila = res.rows[0];
          if (fila === undefined) {
            return null;
          }

          return {
            id: fila.id,
            negocioId: fila.negocio_id,
            nombre: fila.nombre,
          };
        },
      );

      if (resultado === null) {
        return await reply.code(404).send({ error: 'Rubro no encontrado' });
      }

      request.log.info(
        {
          accion: 'configurar_rubro',
          usuarioId: claims.usuarioId,
          negocioId: claims.negocioId,
          rubroId: resultado.id,
          nombre: resultado.nombre,
        },
        'Rubro configurado por dueño',
      );

      return await reply.code(200).send({ rubro: resultado });
    } catch (err: unknown) {
      return handleConfigError(err, request, reply);
    }
  });

  // 5. Crear o actualizar una categoría real de ingresos/egresos — solo rol dueno
  app.post('/configuracion/categorias', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno']);

      const body = guardarCategoriaSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client, db }) => {
          if (body.id !== undefined) {
            const [actualizada] = await db
              .update(categoria)
              .set({ nombre: body.nombre, tipo: body.tipo })
              .where(eq(categoria.id, body.id))
              .returning();
            return actualizada ?? null;
          }

          const res = await client.query<{
            id: string;
            negocio_id: string;
            nombre: string;
            tipo: 'ingreso' | 'egreso';
          }>(
            `
            insert into categoria (negocio_id, nombre, tipo)
            values ($1, $2, $3)
            on conflict (negocio_id, nombre, tipo) do update
              set nombre = excluded.nombre
            returning id, negocio_id, nombre, tipo
            `,
            [claims.negocioId, body.nombre, body.tipo],
          );

          const fila = res.rows[0];
          if (fila === undefined) {
            return null;
          }

          return {
            id: fila.id,
            negocioId: fila.negocio_id,
            nombre: fila.nombre,
            tipo: fila.tipo,
          };
        },
      );

      if (resultado === null) {
        return await reply.code(404).send({ error: 'Categoría no encontrada' });
      }

      request.log.info(
        {
          accion: 'configurar_categoria',
          usuarioId: claims.usuarioId,
          negocioId: claims.negocioId,
          categoriaId: resultado.id,
          nombre: resultado.nombre,
          tipo: resultado.tipo,
        },
        'Categoría configurada por dueño',
      );

      return await reply.code(200).send({ categoria: resultado });
    } catch (err: unknown) {
      return handleConfigError(err, request, reply);
    }
  });
}
