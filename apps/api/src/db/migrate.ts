import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

export interface RunMigrationsOptions {
  connectionString?: string;
  migrationsDir?: string;
  appUserPassword?: string;
}

async function connectWithLocalFallback(
  connectionString: string,
): Promise<pg.Client> {
  try {
    const client = new Client({ connectionString });
    await client.connect();
    return client;
  } catch (err: unknown) {
    if (
      process.platform === 'win32' &&
      (connectionString.includes('localhost') ||
        connectionString.includes('127.0.0.1'))
    ) {
      try {
        execFileSync(
          'wsl.exe',
          [
            '-d',
            'Ubuntu',
            '-u',
            'root',
            '--',
            'sh',
            '-c',
            'systemctl start docker && docker start ferreteria-db',
          ],
          { stdio: 'ignore', timeout: 15_000 },
        );
        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            const retryClient = new Client({ connectionString });
            await retryClient.connect();
            return retryClient;
          } catch {
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      } catch {
        // Si falla el arranque de WSL, propagamos el error original
      }
    }
    throw err;
  }
}

/**
 * Aplica todas las migraciones SQL de `db/migrations/*.sql` en orden alfabético.
 * Registra cada archivo aplicado en la tabla `_migraciones` para que sea idempotente.
 */
export async function runMigrations(
  options: RunMigrationsOptions = {},
): Promise<string[]> {
  const connectionString =
    options.connectionString ??
    process.env['DATABASE_URL'] ??
    'postgresql://postgres:postgres@localhost:5432/ferreteria';

  const migrationsDir =
    options.migrationsDir ??
    path.resolve(import.meta.dirname, '../../../../db/migrations');

  const appUserPassword =
    options.appUserPassword ?? process.env['APP_USER_PASSWORD'];

  const client = await connectWithLocalFallback(connectionString);

  try {
    await client.query(`
      create table if not exists _migraciones (
        nombre text primary key,
        aplicada_en timestamptz not null default now()
      );
    `);

    const appliedResult = await client.query<{ nombre: string }>(
      'select nombre from _migraciones order by nombre asc',
    );
    const appliedSet = new Set(appliedResult.rows.map((row) => row.nombre));

    const entries = await readdir(migrationsDir, { withFileTypes: true });
    const sqlFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    const newlyApplied: string[] = [];

    for (const fileName of sqlFiles) {
      if (appliedSet.has(fileName)) {
        continue;
      }

      const filePath = path.join(migrationsDir, fileName);
      const sqlContent = await readFile(filePath, 'utf8');

      await queryWithCatalogRetry(client, sqlContent);
      await client.query('insert into _migraciones (nombre) values ($1)', [
        fileName,
      ]);
      newlyApplied.push(fileName);
    }

    if (appUserPassword !== undefined && appUserPassword.length > 0) {
      const escapedPassword = client.escapeLiteral(appUserPassword);
      await queryWithCatalogRetry(
        client,
        `alter role app_user with password ${escapedPassword}`,
      );
    }

    return newlyApplied;
  } finally {
    await client.end();
  }
}

async function queryWithCatalogRetry(
  client: pg.Client,
  sql: string,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await client.query(sql);
      return;
    } catch (err: unknown) {
      const pgErr = err as { code?: string; message?: string };
      if (
        attempt < 4 &&
        (pgErr.code === 'XX000' ||
          pgErr.code === '40001' ||
          (pgErr.message?.includes('tuple concurrently updated') ?? false))
      ) {
        await client.query('rollback').catch(() => {});
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}
