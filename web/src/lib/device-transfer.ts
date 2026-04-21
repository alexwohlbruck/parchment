/**
 * Device-to-device recovery transfer primitives (Part C.8).
 *
 * Two sides:
 *   - Receiver (new device, no seed yet): generates ephemeral X25519,
 *     shows QR, waits for sealed payload.
 *   - Sender (existing device, has seed): scans QR, confirms SAS with user,
 *     seals the seed, uploads.
 *
 * The Short Authentication String (SAS) is a 6-digit number derived from
 * both parties' ephemeral pubkeys. Both users see the same 6 digits; if
 * they match, the users confirm "yes this is me" on both devices before
 * the seed is transferred.
 *
 * Guards enforced HERE:
 *   - SAS derivation is deterministic & commutative.
 *   - Seed is sealed with AAD binding both ephemerals + the sessionId.
 *   - Sender signs `(receiverEph || senderEph || sessionId)` with long-term
 *     Ed25519 identity key. Receiver verifies BEFORE unsealing — if a
 *     malicious server swapped ephemeral pubkeys, the signature fails.
 *
 * Not enforced here (platform responsibilities):
 *   - Biometric unlock on the sender side.
 *   - One-shot-session: server enforces single fetch + 60s TTL.
 *   - Per-account pairing rate limit: server enforces 3/hr.
 */

import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
ed.hashes.sha512 = (...m) => sha512(ed.etc.concatBytes(...m))

import {
  encryptEnvelopeString,
  decryptEnvelopeString,
  type AAD,
} from './crypto-envelope'
import {
  base64ToBytes,
  bytesToBase64,
  buildSignableMessage,
} from './federation-crypto'

const TRANSFER_KEY_CONTEXT = 'parchment-device-transfer-v1'
const SAS_CONTEXT = 'parchment-device-sas-v1'

export interface TransferKeypair {
  privateKey: Uint8Array
  publicKey: Uint8Array
}

export function generateEphemeralKeypair(): TransferKeypair {
  const priv = crypto.getRandomValues(new Uint8Array(32))
  const pub = x25519.getPublicKey(priv)
  return { privateKey: priv, publicKey: pub }
}

/**
 * 6-digit Short Authentication String. Commutative — both sides sort
 * their own and the peer's pub before hashing so the result is the same
 * regardless of which side computes it.
 */
export function deriveSAS(
  receiverPub: Uint8Array,
  senderPub: Uint8Array,
  sessionId: string,
): string {
  const [a, b] =
    compareBytes(receiverPub, senderPub) <= 0
      ? [receiverPub, senderPub]
      : [senderPub, receiverPub]
  const ikm = new Uint8Array(a.length + b.length + sessionId.length)
  ikm.set(a, 0)
  ikm.set(b, a.length)
  ikm.set(new TextEncoder().encode(sessionId), a.length + b.length)
  const digest = hkdf(
    sha256,
    ikm,
    undefined,
    new TextEncoder().encode(SAS_CONTEXT),
    4,
  )
  let n = 0
  for (const byte of digest) n = (n << 8) | byte
  const mod = 1_000_000
  const six = (n >>> 0) % mod
  return six.toString().padStart(6, '0')
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

function transferAAD(params: {
  receiverPub: string
  senderPub: string
  sessionId: string
}): AAD {
  return {
    userId: params.sessionId,
    recordType: 'device-transfer',
    recordId: `${params.receiverPub}|${params.senderPub}`,
    keyContext: TRANSFER_KEY_CONTEXT,
  }
}

function canonicalSenderSignable(params: {
  sessionId: string
  receiverEphemeralPub: string
  senderEphemeralPub: string
}): string {
  return buildSignableMessage('device-transfer', {
    sessionId: params.sessionId,
    receiverEphemeralPub: params.receiverEphemeralPub,
    senderEphemeralPub: params.senderEphemeralPub,
  })
}

export interface SealSeedParams {
  seed: Uint8Array // the 32-byte master seed
  senderEphemeralPrivate: Uint8Array
  senderEphemeralPublic: Uint8Array
  receiverEphemeralPublic: Uint8Array
  sessionId: string
  senderIdentityPrivateKey: Uint8Array // long-term Ed25519 (seed/priv)
}

export interface SealedTransferPayload {
  senderEphemeralPub: string // base64
  sealedSeed: string // base64 v2 envelope
  senderSignature: string // base64 Ed25519 sig
}

/**
 * Sender-side: encrypt the seed for the receiver's ephemeral pub and
 * sign the ephemerals + session to authenticate the handshake.
 */
export async function sealSeedForTransfer(
  params: SealSeedParams,
): Promise<SealedTransferPayload> {
  const shared = x25519.getSharedSecret(
    params.senderEphemeralPrivate,
    params.receiverEphemeralPublic,
  )
  const aesKey = hkdf(
    sha256,
    shared,
    undefined,
    new TextEncoder().encode(TRANSFER_KEY_CONTEXT),
    32,
  )
  const senderPubB64 = bytesToBase64(params.senderEphemeralPublic)
  const receiverPubB64 = bytesToBase64(params.receiverEphemeralPublic)
  const sealedSeed = encryptEnvelopeString({
    plaintext: bytesToBase64(params.seed),
    key: aesKey,
    aad: transferAAD({
      receiverPub: receiverPubB64,
      senderPub: senderPubB64,
      sessionId: params.sessionId,
    }),
  })
  const canonical = canonicalSenderSignable({
    sessionId: params.sessionId,
    receiverEphemeralPub: receiverPubB64,
    senderEphemeralPub: senderPubB64,
  })
  const sig = await ed.signAsync(
    new TextEncoder().encode(canonical),
    params.senderIdentityPrivateKey,
  )
  return {
    senderEphemeralPub: senderPubB64,
    sealedSeed,
    senderSignature: bytesToBase64(sig),
  }
}

export interface OpenSeedParams {
  payload: SealedTransferPayload
  receiverEphemeralPrivate: Uint8Array
  receiverEphemeralPublic: Uint8Array
  sessionId: string
  senderIdentityPublicKey: Uint8Array
}

/**
 * Receiver-side: verify the sender signature, unseal the seed. Throws on
 * any verification or decryption failure — never returns a partial seed.
 */
export function openTransferredSeed(params: OpenSeedParams): Uint8Array {
  const receiverPubB64 = bytesToBase64(params.receiverEphemeralPublic)
  const canonical = canonicalSenderSignable({
    sessionId: params.sessionId,
    receiverEphemeralPub: receiverPubB64,
    senderEphemeralPub: params.payload.senderEphemeralPub,
  })
  const sigValid = ed.verify(
    base64ToBytes(params.payload.senderSignature),
    new TextEncoder().encode(canonical),
    params.senderIdentityPublicKey,
  )
  if (!sigValid) {
    throw new Error('Sender signature invalid — aborting transfer')
  }

  const shared = x25519.getSharedSecret(
    params.receiverEphemeralPrivate,
    base64ToBytes(params.payload.senderEphemeralPub),
  )
  const aesKey = hkdf(
    sha256,
    shared,
    undefined,
    new TextEncoder().encode(TRANSFER_KEY_CONTEXT),
    32,
  )
  const seedBase64 = decryptEnvelopeString({
    envelope: params.payload.sealedSeed,
    key: aesKey,
    aad: transferAAD({
      receiverPub: receiverPubB64,
      senderPub: params.payload.senderEphemeralPub,
      sessionId: params.sessionId,
    }),
  })
  const seed = base64ToBytes(seedBase64)
  if (seed.length !== 32) {
    throw new Error(`Unsealed seed has wrong length: ${seed.length}`)
  }
  return seed
}
