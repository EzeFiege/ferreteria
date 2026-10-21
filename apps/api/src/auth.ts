import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  rolUsuarioSchema,
  uuidSchema,
  type RolUsuario,
} from '@ferreteria/shared';

const rawTokenClaimsSchema = z.object({
  negocio_id: uuidSchema,
  usuario_id: uuidSchema,
  rol: rolUsuarioSchema,
  uid: z.string().optional(),
  email: z.string().optional(),
});

export interface AuthClaims {
  negocioId: string;
  usuarioId: string;
  rol: RolUsuario;
  uid?: string | undefined;
  email?: string | undefined;
}

export type TokenVerifier = (
  token: string,
) => Promise<AuthClaims> | AuthClaims;

export class AuthError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

/**
 * Decodifica el payload de un token JWT (header.payload.sig) o base64url JSON
 * y valida los claims `negocio_id`, `usuario_id` y `rol` con Zod.
 */
export function defaultVerifyToken(token: string): AuthClaims {
  const parts = token.split('.');
  const payloadSegment = parts.length === 3 ? parts[1] : parts[0];
  if (payloadSegment === undefined || payloadSegment.length === 0) {
    throw new AuthError('Token malformado', 401);
  }

  let parsedJson: unknown;
  try {
    const decoded = Buffer.from(payloadSegment, 'base64url').toString('utf8');
    parsedJson = JSON.parse(decoded);
  } catch {
    throw new AuthError('Token inválido', 401);
  }

  const parsed = rawTokenClaimsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new AuthError(
      'El token no contiene negocio_id, usuario_id y rol válidos',
      401,
    );
  }

  return {
    negocioId: parsed.data.negocio_id,
    usuarioId: parsed.data.usuario_id,
    rol: parsed.data.rol,
    uid: parsed.data.uid,
    email: parsed.data.email,
  };
}

/**
 * Helper para generar tokens con claims `{ negocio_id, usuario_id, rol }` en pruebas.
 */
export function createAuthToken(claims: {
  negocio_id: string;
  usuario_id: string;
  rol: RolUsuario;
  uid?: string;
  email?: string;
}): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

export async function authenticateRequest(
  request: FastifyRequest,
  verifyToken: TokenVerifier = defaultVerifyToken,
): Promise<AuthClaims> {
  const authHeader = request.headers.authorization;
  if (authHeader === undefined || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Falta el encabezado Authorization Bearer', 401);
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (token.length === 0) {
    throw new AuthError('Token vacío', 401);
  }

  return await verifyToken(token);
}

export function assertRoles(
  claims: AuthClaims,
  rolesPermitidos: readonly RolUsuario[],
): void {
  if (!rolesPermitidos.includes(claims.rol)) {
    throw new AuthError(
      `El rol '${claims.rol}' no tiene permiso para esta operación`,
      403,
    );
  }
}
