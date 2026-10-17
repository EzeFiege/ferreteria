import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { rolUsuarioSchema } from '@ferreteria/shared';
import type { TokenVerifier } from './auth.js';
import { registerCajaRoutes } from './routes/caja.js';
import { registerConfiguracionRoutes } from './routes/configuracion.js';
import { registerReportesRoutes } from './routes/reportes.js';

const { Pool } = pg;

export interface BuildServerOptions {
  logger?: boolean | undefined;
  databaseUrl?: string | undefined;
  pool?: pg.Pool | undefined;
  verifyToken?: TokenVerifier | undefined;
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
  });

  const ownsPool = options.pool === undefined;
  const pool =
    options.pool ??
    new Pool({
      connectionString:
        options.databaseUrl ??
        process.env['APP_DATABASE_URL'] ??
        process.env['DATABASE_URL'] ??
        'postgresql://postgres:postgres@localhost:5432/ferreteria',
    });

  if (ownsPool) {
    app.addHook('onClose', async () => {
      await pool.end();
    });
  }

  pool.on('error', (err) => {
    app.log.error(
      { err, alerta: true, tipoAlerta: 'pg_pool_idle_error' },
      'Error en cliente inactivo del pool de PostgreSQL',
    );
  });

  const corsOrigin = process.env['CORS_ORIGIN'] ?? '*';
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', corsOrigin);
    reply.header(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, OPTIONS',
    );
    reply.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );
    if (request.method === 'OPTIONS') {
      return await reply.code(204).send();
    }
  });

  app.addHook('onError', (request, reply, error, done) => {
    request.log.error(
      {
        alerta: true,
        severidad: reply.statusCode >= 500 ? 'critica' : 'advertencia',
        metodo: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        err: error,
      },
      'Alerta de monitoreo en API',
    );
    done();
  });

  app.get('/health', () => {
    return {
      status: 'ok',
      rolesDisponibles: rolUsuarioSchema.options,
    };
  });

  registerCajaRoutes(app, {
    pool,
    verifyToken: options.verifyToken,
  });

  registerReportesRoutes(app, {
    pool,
    verifyToken: options.verifyToken,
  });

  registerConfiguracionRoutes(app, {
    pool,
    verifyToken: options.verifyToken,
  });

  return app;
}
