import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const FORMAT_VERSION = 'v1'
const IV_LENGTH = 12

function parseKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, 'base64')
  if (key.length !== 32) {
    throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key')
  }
  return key
}

export function encryptSecret(plaintext: string, encodedKey: string): string {
  const key = parseKey(encodedKey)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    FORMAT_VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':')
}

export function decryptSecret(encryptedValue: string, encodedKey: string): string {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext, ...extra] =
    encryptedValue.split(':')
  if (
    version !== FORMAT_VERSION
    || !encodedIv
    || !encodedAuthTag
    || !encodedCiphertext
    || extra.length > 0
  ) {
    throw new Error('Unsupported encrypted secret format')
  }

  const key = parseKey(encodedKey)
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(encodedIv, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(encodedAuthTag, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
