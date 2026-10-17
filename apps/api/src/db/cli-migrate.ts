import pino from 'pino';
import { runMigrations } from './migrate.js';

const logger = pino({ name: 'db:migrate' });

async function main(): Promise<void> {
  const applied = await runMigrations();
  if (applied.length === 0) {
    logger.info('No hay migraciones pendientes.');
  } else {
    logger.info({ applied }, 'Migraciones aplicadas correctamente.');
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Error al aplicar las migraciones');
  process.exitCode = 1;
});
