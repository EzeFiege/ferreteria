import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

const { Client } = pg;

export interface TestDatabaseHandle {
  url: string;
  cleanup: () => Promise<void>;
}

function tryStartLocalDockerPostgres(): void {
  if (process.platform !== 'win32') {
    return;
  }
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
  } catch {
    // Ignorar si WSL no está disponible
  }
}

async function connectAdminWithRetry(adminUrl: string): Promise<pg.Client> {
  try {
    const client = new Client({
      connectionString: adminUrl,
      connectionTimeoutMillis: 2000,
    });
    await client.connect();
    return client;
  } catch {
    tryStartLocalDockerPostgres();
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const client = new Client({
          connectionString: adminUrl,
          connectionTimeoutMillis: 2000,
        });
        await client.connect();
        return client;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new Error('No se pudo conectar a PostgreSQL local');
  }
}

export async function createIsolatedTestDatabase(): Promise<TestDatabaseHandle> {
  const adminUrl =
    process.env['DATABASE_URL'] ??
    'postgresql://postgres:postgres@localhost:5432/ferreteria';

  try {
    const adminClient = await connectAdminWithRetry(adminUrl);
    const testDbName = `ferreteria_test_${randomUUID().replace(/-/g, '')}`;
    await adminClient.query(`create database ${testDbName}`);
    await adminClient.end();

    const parsedUrl = new URL(adminUrl);
    parsedUrl.pathname = `/${testDbName}`;

    return {
      url: parsedUrl.toString(),
      cleanup: async () => {
        const dropClient = new Client({ connectionString: adminUrl });
        await dropClient.connect();
        try {
          await dropClient.query(
            `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
            [testDbName],
          );
          await dropClient.query(`drop database if exists ${testDbName}`);
        } finally {
          await dropClient.end();
        }
      },
    };
  } catch {
    process.env['TESTCONTAINERS_RYUK_DISABLED'] ??= 'true';
    const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
      'postgres:16-alpine',
    ).start();
    return {
      url: container.getConnectionUri(),
      cleanup: async () => {
        await container.stop();
      },
    };
  }
}
