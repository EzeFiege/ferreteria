import type { PoolClient } from 'pg';
import type { AccionAuditoria, EntidadAuditoria } from '@ferreteria/shared';

export interface RegistrarAuditoriaParams {
  negocioId: string;
  usuarioId: string;
  usuarioEmail?: string | null | undefined;
  rol: string;
  accion: AccionAuditoria;
  entidad: EntidadAuditoria;
  entidadId?: string | null | undefined;
  detalles?: Record<string, unknown> | undefined;
}

/**
 * Registra una acción sensible en el libro inmutable de auditoría.
 * Se debe ejecutar dentro de la transacción existente usando el mismo PoolClient.
 */
export async function registrarAuditoria(
  client: PoolClient,
  params: RegistrarAuditoriaParams,
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `insert into registro_auditoria (
      negocio_id,
      usuario_id,
      usuario_email,
      rol,
      accion,
      entidad,
      entidad_id,
      detalles
    ) values ($1, $2, $3, $4, $5, $6, $7, $8)
    returning id`,
    [
      params.negocioId,
      params.usuarioId,
      params.usuarioEmail ?? null,
      params.rol,
      params.accion,
      params.entidad,
      params.entidadId ?? null,
      JSON.stringify(params.detalles ?? {}),
    ],
  );

  const fila = res.rows[0];
  if (!fila) {
    throw new Error('Error al registrar auditoría');
  }

  return fila.id;
}
