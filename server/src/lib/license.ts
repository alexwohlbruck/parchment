import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

ed.hashes.sha512 = (...m) => sha512(ed.etc.concatBytes(...m))

// Ed25519 public key for license verification. Only Parchment's
// official build pipeline holds the corresponding private key.
const LICENSE_PUBLIC_KEY = 'a]placeholder-replace-with-real-key'

export type LicensePayload = {
  org: string
  features: string[]
  exp?: number // Unix timestamp, omit for perpetual
}

/**
 * Verify and decode a license token. The token format is:
 *   base64(JSON payload) + "." + hex(Ed25519 signature)
 *
 * Returns the decoded payload if valid, or null if invalid/expired.
 */
export async function verifyLicense(
  token: string,
): Promise<LicensePayload | null> {
  try {
    const [payloadB64, signatureHex] = token.split('.')
    if (!payloadB64 || !signatureHex) return null

    const payloadBytes = Buffer.from(payloadB64, 'base64')
    const signature = Buffer.from(signatureHex, 'hex')
    const publicKey = Buffer.from(LICENSE_PUBLIC_KEY, 'hex')

    const valid = await ed.verifyAsync(signature, payloadBytes, publicKey)
    if (!valid) return null

    const payload: LicensePayload = JSON.parse(payloadBytes.toString('utf-8'))

    if (payload.exp && Date.now() > payload.exp * 1000) return null

    return payload
  } catch {
    return null
  }
}
