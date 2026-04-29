import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { config } from '../config.js';

/**
 * Returns a stable 32-byte AES key derived from CRYPTO_KEY.
 * @returns {Buffer} AES-256 key.
 */
function getAesKey() {
  if (/^[a-f0-9]{64}$/i.test(config.cryptoKey)) {
    return Buffer.from(config.cryptoKey, 'hex');
  }

  return createHash('sha256').update(config.cryptoKey, 'utf8').digest();
}

/**
 * Encrypts plaintext with AES-256-GCM.
 * @param {string} plaintext Plain text value.
 * @returns {string} Base64 iv:authTag:ciphertext payload.
 */
export function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getAesKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64')
  ].join(':');
}

/**
 * Decrypts an AES-256-GCM payload.
 * @param {string} ciphertext Base64 iv:authTag:ciphertext payload.
 * @returns {string} Decrypted plaintext.
 */
export function decrypt(ciphertext) {
  if (!ciphertext) {
    return '';
  }

  const parts = String(ciphertext).split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format.');
  }

  const [iv, authTag, encrypted] = parts.map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', getAesKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]).toString('utf8');
}
