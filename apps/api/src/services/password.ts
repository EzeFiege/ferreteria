import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

/**
 * Genera un hash seguro con sal aleatoria utilizando scrypt de node:crypto.
 * Formato resultante: "salt:hashHex"
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, KEY_LENGTH);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verifica si una contraseña en texto plano coincide con el hash almacenado.
 * Utiliza timingSafeEqual para prevenir ataques de canal lateral (timing attacks).
 */
export function verifyPassword(password: string, combinedHash: string): boolean {
  try {
    const parts = combinedHash.split(':');
    if (parts.length !== 2) {
      return false;
    }
    const [salt, expectedHashHex] = parts;
    if (!salt || !expectedHashHex) {
      return false;
    }

    const derivedKey = scryptSync(password, salt, KEY_LENGTH);
    const expectedBuffer = Buffer.from(expectedHashHex, 'hex');

    if (derivedKey.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(derivedKey, expectedBuffer);
  } catch {
    return false;
  }
}
