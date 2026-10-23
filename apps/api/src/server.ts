import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { rolUsuarioSchema } from '@ferreteria/shared';
import type { TokenVerifier } from './auth.js';
import { registerCajaRoutes } from './routes/caja.js';
import { registerClientesRoutes } from './routes/clientes.js';
import { registerComprasRoutes } from './routes/compras.js';
import { registerConfiguracionRoutes } from './routes/configuracion.js';
import { registerProductosRoutes } from './routes/productos.js';
import { registerReportesRoutes } from './routes/reportes.js';
import { registerTesoreriaRoutes } from './routes/tesoreria.js';
import { registerFacturacionRoutes } from './routes/facturacion.js';
import { registerContabilidadRoutes } from './routes/contabilidad.js';
import { registerPresupuestosRoutes } from './routes/presupuestos.js';
import { registerAuditoriaRoutes } from './routes/auditoria.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerInventarioRoutes } from './routes/inventario.js';

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

  // Registrador común para soportar llamadas con y sin prefijo /api
  const registerDomainRoutes = (targetApp: FastifyInstance): void => {
    registerCajaRoutes(targetApp, { pool, verifyToken: options.verifyToken });
    registerReportesRoutes(targetApp, { pool, verifyToken: options.verifyToken });
    registerConfiguracionRoutes(targetApp, { pool, verifyToken: options.verifyToken });
    registerProductosRoutes(targetApp, { pool, verifyToken: options.verifyToken });
    registerClientesRoutes(targetApp, { pool, verifyToken: options.verifyToken });
    registerComprasRoutes(targetApp, { pool, verifyToken: options.verifyToken });
    registerTesoreriaRoutes(targetApp, { pool, verifyToken: options.verifyToken });
    registerFacturacionRoutes(targetApp, { pool, verifyToken: options.verifyToken });
    registerContabilidadRoutes(targetApp, { pool, verifyToken: options.verifyToken });
    registerPresupuestosRoutes(targetApp, { pool, verifyToken: options.verifyToken });
    registerAuditoriaRoutes(targetApp, { pool, verifyToken: options.verifyToken });
    registerAuthRoutes(targetApp, { pool, verifyToken: options.verifyToken });
    registerInventarioRoutes(targetApp, { pool, verifyToken: options.verifyToken });
  };

  // 1. Registro directo en la raíz (ej: /auth/login, /contexto-mostrador)
  registerDomainRoutes(app);

  // 2. Registro con prefijo /api (ej: /api/auth/login, /api/contexto-mostrador)
  void app.register(
    (apiSub, _opts, done) => {
      registerDomainRoutes(apiSub);
      done();
    },
    { prefix: '/api' },
  );

  const webDistPath =
    process.env['WEB_DIST_PATH'] ??
    path.resolve(import.meta.dirname, '../../web/dist');

  if (
    fs.existsSync(webDistPath) &&
    fs.existsSync(path.join(webDistPath, 'index.html'))
  ) {
    void app.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
    });

    app.setNotFoundHandler((request, reply) => {
      const urlRaw = request.raw.url ?? request.url;
      const esRutaApi =
        urlRaw.startsWith('/api') ||
        urlRaw.startsWith('/auth') ||
        urlRaw.startsWith('/auditoria') ||
        urlRaw.startsWith('/turnos') ||
        urlRaw.startsWith('/cajas') ||
        urlRaw.startsWith('/movimientos') ||
        urlRaw.startsWith('/ventas') ||
        urlRaw.startsWith('/productos') ||
        urlRaw.startsWith('/clientes') ||
        urlRaw.startsWith('/proveedores') ||
        urlRaw.startsWith('/compras') ||
        urlRaw.startsWith('/tesoreria') ||
        urlRaw.startsWith('/facturacion') ||
        urlRaw.startsWith('/contabilidad') ||
        urlRaw.startsWith('/presupuestos') ||
        urlRaw.startsWith('/listas-precios') ||
        urlRaw.startsWith('/stock') ||
        urlRaw.startsWith('/reportes') ||
        urlRaw.startsWith('/configuracion') ||
        urlRaw.startsWith('/inventarios') ||
        urlRaw.startsWith('/contexto-mostrador') ||
        urlRaw.startsWith('/health');

      if (esRutaApi) {
        return reply.code(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Ruta ${request.method}:${request.url} no encontrada`,
        });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
