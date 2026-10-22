import { runMigrations } from './db/migrate.js';
import { buildServer } from './server.js';

const port = Number(process.env['PORT'] ?? 3000);
const host = process.env['HOST'] ?? '0.0.0.0';

async function start(): Promise<void> {
  // En entornos de producción (Railway/Cloud Run/Docker) o cuando AUTO_MIGRATE=true,
  // ejecuta automáticamente las migraciones pendientes antes de escuchar peticiones.
  if (
    process.env['AUTO_MIGRATE'] === 'true' ||
    process.env['NODE_ENV'] === 'production'
  ) {
    try {
      const aplicadas = await runMigrations();
      if (aplicadas.length > 0) {
        console.log(`[db:migrate] Migraciones aplicadas en arranque: ${aplicadas.join(', ')}`);
      }
    } catch (migErr) {
      console.error('[db:migrate] Error al aplicar migraciones en arranque:', migErr);
    }
  }

  const server = buildServer({ logger: true });

  await server.listen({ port, host });
}

start().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
