import pino from 'pino';
import { runBackupAndVerifyRestore } from './backup-restore.js';

const logger = pino({ name: 'db-backup-verify' });

async function main(): Promise<void> {
  logger.info('Iniciando backup lógico y prueba de restauración...');
  const resultado = await runBackupAndVerifyRestore();
  logger.info(
    {
      archivoBackup: resultado.archivoBackup,
      baseTemporal: resultado.baseTemporal,
      tablasVerificadas: resultado.tablasVerificadas,
      filasRestauradas: resultado.filasRestauradas,
      rlsActivo: resultado.rlsActivo,
      vistasOperativas: resultado.vistasOperativas,
    },
    'Backup y prueba de restauración completados con éxito',
  );
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fallo en backup o prueba de restauración');
  process.exit(1);
});
