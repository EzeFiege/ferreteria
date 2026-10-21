import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import {
  filtroAuditoriaSchema,
  type RegistroAuditoriaItem,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';

export interface AuditoriaRoutesOptions extends FastifyPluginOptions {
  pool: Pool;
  verifyToken?: TokenVerifier | undefined;
}

interface AuditoriaRow {
  id: string;
  negocio_id: string;
  usuario_id: string;
  usuario_email: string | null;
  rol: string;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  detalles: Record<string, unknown>;
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
  request.log.error({ err, modulo: 'auditoria' }, 'Error en ruta de auditoría');
  return await reply.code(500).send({ error: 'Error interno del servidor' });
}

export function registerAuditoriaRoutes(
  app: FastifyInstance,
  options: AuditoriaRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // Consulta de registro inmutable de auditoría (solo encargado y dueño)
  app.get('/auditoria', async (request, reply) => {
    try {
      const user = await authenticateRequest(request, verifyToken);
      assertRoles(user, ['encargado', 'dueno']);

      const queryParams = filtroAuditoriaSchema.parse(request.query);

      const items = await withTenantTransaction(
        pool,
        user.negocioId,
        async ({ client }) => {
          const conditions: string[] = ['negocio_id = $1'];
          const values: unknown[] = [user.negocioId];
          let paramIndex = 2;

          if (queryParams.desde) {
            conditions.push(`creado_en >= $${paramIndex}`);
            values.push(new Date(queryParams.desde));
            paramIndex++;
          }

          if (queryParams.hasta) {
            conditions.push(`creado_en <= $${paramIndex}`);
            values.push(new Date(queryParams.hasta));
            paramIndex++;
          }

          if (queryParams.accion) {
            conditions.push(`accion = $${paramIndex}`);
            values.push(queryParams.accion);
            paramIndex++;
          }

          if (queryParams.entidad) {
            conditions.push(`entidad = $${paramIndex}`);
            values.push(queryParams.entidad);
            paramIndex++;
          }

          if (queryParams.usuarioId) {
            conditions.push(`usuario_id = $${paramIndex}`);
            values.push(queryParams.usuarioId);
            paramIndex++;
          }

          const limit = queryParams.limite;
          values.push(limit);
          const limitParamIndex = paramIndex;

          const query = `
            select
              id,
              negocio_id,
              usuario_id,
              usuario_email,
              rol,
              accion,
              entidad,
              entidad_id,
              detalles,
              creado_en
            from registro_auditoria
            where ${conditions.join(' and ')}
            order by creado_en desc
            limit $${limitParamIndex}
          `;

          const result = await client.query<AuditoriaRow>(query, values);

          return result.rows.map(
            (r): RegistroAuditoriaItem => ({
              id: r.id,
              negocioId: r.negocio_id,
              usuarioId: r.usuario_id,
              usuarioEmail: r.usuario_email,
              rol: r.rol,
              accion: r.accion as RegistroAuditoriaItem['accion'],
              entidad: r.entidad as RegistroAuditoriaItem['entidad'],
              entidadId: r.entidad_id,
              detalles: r.detalles,
              creadoEn: r.creado_en.toISOString(),
            }),
          );
        },
      );

      return await reply.send(items);
    } catch (err) {
      return await handleRouteError(err, request, reply);
    }
  });
}
