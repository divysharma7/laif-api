import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '../lib/secretEncryption.js'

const encryptionKey = Buffer.alloc(32, 7).toString('base64')

describe('secret encryption', () => {
  it('round-trips a secret without storing the plaintext', () => {
    const encrypted = encryptSecret('google-refresh-token', encryptionKey)

    expect(encrypted).toMatch(/^v1:/)
    expect(encrypted).not.toContain('google-refresh-token')
    expect(decryptSecret(encrypted, encryptionKey)).toBe('google-refresh-token')
  })

  it('rejects ciphertext that has been modified', () => {
    const encrypted = encryptSecret('google-access-token', encryptionKey)
    const parts = encrypted.split(':')
    parts[2] = `${parts[2][0] === 'a' ? 'b' : 'a'}${parts[2].slice(1)}`
    const tampered = parts.join(':')

    expect(() => decryptSecret(tampered, encryptionKey)).toThrow()
  })

  it('rejects a key that is not exactly 32 bytes', () => {
    const invalidKey = Buffer.alloc(16, 7).toString('base64')

    expect(() => encryptSecret('secret', invalidKey))
      .toThrow('GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key')
  })
})
