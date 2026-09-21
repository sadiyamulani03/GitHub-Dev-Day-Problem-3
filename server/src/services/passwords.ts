/**
 * Password hashing using scrypt (built into Node).
 */
import crypto from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Hash a plaintext password. Returns "salt:hash" (both hex). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const hash = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/** Verify a plaintext password against a stored "salt:hash". */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const hash = Buffer.from(hashHex, 'hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
  return crypto.timingSafeEqual(hash, derived);
}