import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_PREFIX = 'siv_';

export function newDeviceKey(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export async function hashDeviceKey(key: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(key, salt, 64) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyDeviceKey(key: string, encoded: string): Promise<boolean> {
  const [salt, expectedHex] = encoded.split(':');
  if (!salt || !expectedHex || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
  const actual = await scrypt(key, salt, 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(expectedHex, 'hex'));
}
