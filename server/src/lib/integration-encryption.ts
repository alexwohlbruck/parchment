/**
 * Integration-credential encryption.
 *
 * Third-party integration credentials (bearer tokens, API keys, OAuth
 * refresh tokens) MUST NOT sit in the DB as cleartext. They're decrypted
 * in-process at call time and never persisted unencrypted.
 *
 * This module wraps a single master AES-256-GCM key loaded from the
 * `PARCHMENT_INTEGRATION_ENCRYPTION_KEY` environment variable. That env
 * var is the whole mechanism — no external dependency, no AWS, no cloud
 * service. Just put a good 32-byte random value in your environment:
 *
 *     openssl rand -base64 32
 *
 * Operators who WANT a hosted key-management service (AWS KMS, GCP KMS,
 * HashiCorp Vault, etc.) can still use one by configuring their deploy to
 * unseal the value from that service BEFORE the process starts and inject
 * it as the env var. The code here treats the input as opaque 32-byte key
 * material regardless of origin.
 *
 * The key is held in process memory for the life of the server. Callers
 * should never log the key or cleartext plaintexts; `decryptIntegrationConfig`
 * returns a parsed object and the caller is responsible for downstream
 * handling.
 *
 * Key rotation: each ciphertext is tagged with `keyVersion`. When rotating,
 * deploy a new key under the same env var and a background job re-encrypts
 * rows, bumping `keyVersion`. For now we ship version 1 only — the hook is
 * there for later.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const KEY_ENV_VAR = 'PARCHMENT_INTEGRATION_ENCRYPTION_KEY'
const CURRENT_KEY_VERSION = 1
const NONCE_LEN = 12
const TAG_LEN = 16

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}

function bytesToBase64(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString('base64')
}

let cachedKey: Buffer | null = null

function loadMasterKey(): Buffer {
  if (cachedKey) return cachedKey

  const raw = process.env[KEY_ENV_VAR]
  if (!raw) {
    throw new Error(
      `${KEY_ENV_VAR} is not set. Add it to server/.env: run \`openssl rand -base64 32\` and paste the output.`,
    )
  }

  const bytes = base64ToBytes(raw.trim())
  if (bytes.length !== 32) {
    throw new Error(
      `${KEY_ENV_VAR} must be 32 bytes (base64). Got ${bytes.length}.`,
    )
  }
  cachedKey = Buffer.from(bytes)
  return cachedKey
}

export interface EncryptedBlob {
  ciphertext: string // base64 (ciphertext || tag)
  nonce: string // base64 (12B)
  keyVersion: number
}

/**
 * Encrypt a JSON-serializable object under the master encryption key.
 * Returns base64-encoded components suitable for text columns.
 */
export function encryptIntegrationConfig(
  config: Record<string, unknown>,
): EncryptedBlob {
  const key = loadMasterKey()
  const nonce = randomBytes(NONCE_LEN)
  const plaintext = Buffer.from(JSON.stringify(config), 'utf8')
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  // Concatenate ciphertext and tag for a single column value — mirrors the
  // web-side envelope approach, minus the AAD (which we don't need here:
  // there's only one record type and the server is the only principal).
  const ciphertext = Buffer.concat([encrypted, tag])
  return {
    ciphertext: bytesToBase64(ciphertext),
    nonce: bytesToBase64(nonce),
    keyVersion: CURRENT_KEY_VERSION,
  }
}

/**
 * Decrypt an EncryptedBlob produced by encryptIntegrationConfig.
 * Throws on tamper or wrong key — callers should surface this as a 500
 * with NO cleartext exposure (even error messages must not leak fragments).
 */
export function decryptIntegrationConfig(
  blob: EncryptedBlob,
): Record<string, unknown> {
  if (blob.keyVersion !== CURRENT_KEY_VERSION) {
    throw new Error(
      `Unsupported integration-config keyVersion ${blob.keyVersion}`,
    )
  }
  const key = loadMasterKey()
  const nonce = Buffer.from(base64ToBytes(blob.nonce))
  const combined = Buffer.from(base64ToBytes(blob.ciphertext))
  if (combined.length < TAG_LEN) {
    throw new Error('Integration config ciphertext too short')
  }
  const ciphertext = combined.subarray(0, combined.length - TAG_LEN)
  const tag = combined.subarray(combined.length - TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>
}

export function getCurrentKeyVersion(): number {
  return CURRENT_KEY_VERSION
}

export const integrationEncryptionInternals = {
  resetCache: () => {
    cachedKey = null
  },
}
