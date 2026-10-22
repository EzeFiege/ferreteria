import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import {
  loginInputSchema,
  type LoginResponse,
  type RolUsuario,
} from '@ferreteria/shared';
import {
  authenticateRequest,
  AuthError,
  createAuthToken,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';
import { usuario, negocio } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '../services/password.js';

export interface AuthRoutesOptions extends FastifyPluginOptions {
  pool: Pool;
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
  request.log.error({ err, modulo: 'auth' }, 'Error en ruta de autenticación');
  return reply.code(500).send({ error: 'Error interno del servidor' });
}

interface UsuarioAutenticadoRow {
  id: string;
  negocio_id: string;
  negocio_nombre: string;
  proveedor_uid: string;
  nombre: string;
  email: string | null;
  rol: RolUsuario;
  activo: boolean;
  password_hash: string | null;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Iniciar sesión con usuario/email y contraseña
  app.post('/auth/login', async (request, reply) => {
    try {
      const body = loginInputSchema.parse(request.body);

      // Usar cliente de pool para invocar la función de autenticación
      const client = await pool.connect();
      try {
        const res = await client.query<UsuarioAutenticadoRow>(
          'select * from autenticar_usuario($1, $2)',
          [body.usuario, body.negocioId ?? null],
        );

        const fila = res.rows[0];
        if (!fila || !fila.password_hash) {
          return await reply.code(401).send({
            error: 'Usuario o contraseña incorrectos',
          });
        }

        const passwordValida = verifyPassword(body.password, fila.password_hash);
        if (!passwordValida) {
          return await reply.code(401).send({
            error: 'Usuario o contraseña incorrectos',
          });
        }

        // Registrar último ingreso
        await client.query(
          'update usuario set ultimo_ingreso = now() where id = $1',
          [fila.id],
        );

        const token = createAuthToken({
          negocio_id: fila.negocio_id,
          usuario_id: fila.id,
          rol: fila.rol,
          ...(fila.email ? { email: fila.email } : {}),
        });

        const respuesta: LoginResponse = {
          token,
          usuario: {
            id: fila.id,
            negocioId: fila.negocio_id,
            negocioNombre: fila.negocio_nombre,
            nombre: fila.nombre,
            email: fila.email,
            rol: fila.rol,
          },
        };

        return await reply.code(200).send(respuesta);
      } finally {
        client.release();
      }
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 2. Obtener datos del usuario en sesión
  app.get('/auth/me', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [u] = await db
            .select()
            .from(usuario)
            .where(eq(usuario.id, claims.usuarioId));

          if (!u || !u.activo) {
            throw new AuthError('Usuario no encontrado o inactivo', 404);
          }

          const [n] = await db
            .select()
            .from(negocio)
            .where(eq(negocio.id, claims.negocioId));

          return {
            id: u.id,
            negocioId: u.negocioId,
            negocioNombre: n?.nombre,
            nombre: u.nombre,
            email: u.email,
            rol: u.rol,
          };
        },
      );

      return await reply.code(200).send({ usuario: resultado });
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 3. Cerrar sesión
  app.post('/auth/logout', async (_request, reply) => {
    return await reply.code(200).send({ status: 'ok' });
  });
}
