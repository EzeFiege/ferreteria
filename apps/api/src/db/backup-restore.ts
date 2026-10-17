import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runMigrations } from './migrate.js';

const { Client } = pg;

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

async function connectClientWithRetry(
  connectionString: string,
): Promise<pg.Client> {
  try {
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 2000,
    });
    await client.connect();
    return client;
  } catch {
    tryStartLocalDockerPostgres();
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const client = new Client({
          connectionString,
          connectionTimeoutMillis: 2000,
        });
        await client.connect();
        return client;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new Error('No se pudo conectar a PostgreSQL para backup/restore');
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_BACKUP_DIR = path.resolve(__dirname, '../../../../backups');

const TABLAS_CATALOGO = [
  'negocio',
  'sucursal',
  'caja',
  'usuario',
  'medio_pago',
  'rubro',
  'categoria',
] as const;

const TABLAS_ORDENADAS = [
  ...TABLAS_CATALOGO,
  'turno_caja',
  'venta',
  'venta_item',
  'movimiento',
] as const;

export interface BackupVerificationResult {
  archivoBackup: string;
  baseTemporal: string;
  tablasVerificadas: number;
  filasExportadas: Record<string, number>;
  filasRestauradas: Record<string, number>;
  rlsActivo: boolean;
  vistasOperativas: boolean;
}

function formatSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return `'${str.replace(/'/g, "''")}'`;
}

function buildInsertStatement(
  tabla: string,
  row: Record<string, unknown>,
): string {
  const columnas = Object.keys(row);
  const valores = columnas.map((col) => formatSqlLiteral(row[col]));
  return `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${valores.join(', ')}) ON CONFLICT DO NOTHING;`;
}

export async function runBackupAndVerifyRestore(options?: {
  connectionString?: string;
  backupDir?: string;
}): Promise<BackupVerificationResult> {
  const sourceUrl =
    options?.connectionString ??
    process.env['DATABASE_URL'] ??
    'postgresql://postgres:postgres@localhost:5432/ferreteria';
  const backupDir = options?.backupDir ?? DEFAULT_BACKUP_DIR;

  await mkdir(backupDir, { recursive: true });

  const sourceClient = await connectClientWithRetry(sourceUrl);

  const filasExportadas: Record<string, number> = {
    negocio: 0,
    sucursal: 0,
    caja: 0,
    usuario: 0,
    medio_pago: 0,
    rubro: 0,
    categoria: 0,
    turno_caja: 0,
    venta: 0,
    venta_item: 0,
    movimiento: 0,
  };
  const sqlStatements: string[] = [
    '-- Backup lógico generado por @ferreteria/api (Etapa 4)',
    `-- Fecha: ${new Date().toISOString()}`,
    'BEGIN;',
  ];

  try {
    for (const tabla of TABLAS_CATALOGO) {
      const res = await sourceClient.query<Record<string, unknown>>(
        `SELECT * FROM ${tabla}`,
      );
      filasExportadas[tabla] = res.rows.length;
      for (const row of res.rows) {
        sqlStatements.push(buildInsertStatement(tabla, row));
      }
    }

    const turnosRes = await sourceClient.query<Record<string, unknown>>(
      'SELECT * FROM turno_caja ORDER BY abre_en ASC',
    );
    filasExportadas['turno_caja'] = turnosRes.rows.length;

    for (const turno of turnosRes.rows) {
      const turnoId = String(turno['id']);
      const estabaCerrado =
        turno['cierra_en'] !== null && turno['cierra_en'] !== undefined;

      const turnoAbiertoRow: Record<string, unknown> = {
        ...turno,
        cerrado_por: null,
        cierra_en: null,
        efectivo_contado: null,
      };
      sqlStatements.push(buildInsertStatement('turno_caja', turnoAbiertoRow));

      const ventasRes = await sourceClient.query<Record<string, unknown>>(
        'SELECT * FROM venta WHERE turno_id = $1 ORDER BY creado_en ASC',
        [turnoId],
      );
      filasExportadas['venta'] =
        (filasExportadas['venta'] ?? 0) + ventasRes.rows.length;

      for (const v of ventasRes.rows) {
        sqlStatements.push(buildInsertStatement('venta', v));
        const itemsRes = await sourceClient.query<Record<string, unknown>>(
          'SELECT * FROM venta_item WHERE venta_id = $1',
          [String(v['id'])],
        );
        filasExportadas['venta_item'] =
          (filasExportadas['venta_item'] ?? 0) + itemsRes.rows.length;
        for (const item of itemsRes.rows) {
          sqlStatements.push(buildInsertStatement('venta_item', item));
        }
      }

      const movsRes = await sourceClient.query<Record<string, unknown>>(
        'SELECT * FROM movimiento WHERE turno_id = $1 ORDER BY (revierte_id IS NOT NULL) ASC, creado_en ASC',
        [turnoId],
      );
      filasExportadas['movimiento'] =
        (filasExportadas['movimiento'] ?? 0) + movsRes.rows.length;
      for (const mov of movsRes.rows) {
        sqlStatements.push(buildInsertStatement('movimiento', mov));
      }

      if (estabaCerrado) {
        sqlStatements.push(
          `UPDATE turno_caja SET cerrado_por = ${formatSqlLiteral(turno['cerrado_por'])}, cierra_en = ${formatSqlLiteral(turno['cierra_en'])}, efectivo_contado = ${formatSqlLiteral(turno['efectivo_contado'])}, notas = ${formatSqlLiteral(turno['notas'])} WHERE id = ${formatSqlLiteral(turnoId)};`,
        );
      }
    }

    sqlStatements.push('COMMIT;');
  } finally {
    await sourceClient.end();
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivoBackup = path.join(backupDir, `backup-${timestamp}.sql`);
  const contenidoSql = sqlStatements.join('\n') + '\n';
  await writeFile(archivoBackup, contenidoSql, 'utf8');

  // Crear base temporal para probar restauración real
  const baseTemporal = `ferreteria_restore_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';

  const adminClient = await connectClientWithRetry(adminUrl.toString());

  const filasRestauradas: Record<string, number> = {};
  let rlsActivo = false;
  let vistasOperativas = false;

  try {
    await adminClient.query(`CREATE DATABASE "${baseTemporal}"`);

    const restoreUrl = new URL(sourceUrl);
    restoreUrl.pathname = `/${baseTemporal}`;
    const restoreConnString = restoreUrl.toString();

    await runMigrations({ connectionString: restoreConnString });

    const restoreClient = await connectClientWithRetry(restoreConnString);

    try {
      await restoreClient.query(contenidoSql);

      for (const tabla of TABLAS_ORDENADAS) {
        const countRes = await restoreClient.query<{ total: string }>(
          `SELECT count(*)::text AS total FROM ${tabla}`,
        );
        const total = Number(countRes.rows[0]?.total ?? '0');
        filasRestauradas[tabla] = total;

        if (total !== filasExportadas[tabla]) {
          throw new Error(
            `Diferencia en restauración de tabla ${tabla}: exportadas=${String(filasExportadas[tabla])}, restauradas=${String(total)}`,
          );
        }
      }

      // Verificar vistas de reporte y RLS con app_user
      await restoreClient.query('BEGIN');
      await restoreClient.query('SET LOCAL ROLE app_user');
      await restoreClient.query(
        "SELECT set_config('app.negocio_id', '00000000-0000-4000-8000-000000000000', true)",
      );

      const rlsCheck = await restoreClient.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM movimiento',
      );
      rlsActivo = Number(rlsCheck.rows[0]?.total ?? '-1') === 0;

      await restoreClient.query('SELECT * FROM v_resumen_turno LIMIT 1');
      await restoreClient.query(
        'SELECT * FROM v_ventas_por_medio_rubro LIMIT 1',
      );
      vistasOperativas = true;

      await restoreClient.query('COMMIT');
    } finally {
      await restoreClient.end();
    }
  } finally {
    await adminClient.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [baseTemporal],
    );
    await adminClient.query(`DROP DATABASE IF EXISTS "${baseTemporal}"`);
    await adminClient.end();
  }

  return {
    archivoBackup,
    baseTemporal,
    tablasVerificadas: TABLAS_ORDENADAS.length,
    filasExportadas,
    filasRestauradas,
    rlsActivo,
    vistasOperativas,
  };
}
