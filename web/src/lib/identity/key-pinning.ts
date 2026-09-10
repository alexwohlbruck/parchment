/**
 * Client-side key pinning and safety-number derivation.
 *
 * Trust model: the home server is honest-but-curious; peer servers are
 * potentially hostile. So we pin every friend's resolved pubkeys the first
 * time we see them (TOFU), and refuse to accept any silent rotation. If a
 * pubkey changes, the user must explicitly re-verify — typically by comparing
 * safety numbers out of band.
 *
 * Pins are stored in localStorage encrypted under the user's personal AES key
 * (derived from their seed). The server never sees cleartext pin data.
 */

import { useStorage } from '@vueuse/core'
import {
  encrypt,
  decrypt,
  derivePersonalKey,
  importPublicKey,
  bytesToBase64,
  base64ToBytes,
  compareBytes,
} from './federation-crypto'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { getSeed } from './key-storage'

const PINS_STORAGE_KEY = 'parchment-friend-pins'

export interface FriendPin {
  handle: string
  signingKey: string // base64 Ed25519 public key
  encryptionKey: string // base64 X25519 public key
  firstSeenAt: number // epoch ms
  verified: boolean // user has verified safety number out of band
}

interface PinEnvelope {
  ciphertext: string
  nonce: string
  version: number
}

let storage: ReturnType<typeof useStorage<PinEnvelope | null>> | null = null
function getStorage() {
  if (!storage) storage = useStorage<PinEnvelope | null>(PINS_STORAGE_KEY, null)
  return storage
}

async function getKey(): Promise<Uint8Array | null> {
  const seed = await getSeed()
  if (!seed) return null
  return derivePersonalKey(seed)
}

async function loadPins(): Promise<Record<string, FriendPin>> {
  const env = getStorage().value
  if (!env) return {}
  const key = await getKey()
  if (!key) return {}
  try {
    const plain = decrypt(env.ciphertext, env.nonce, key)
    return JSON.parse(plain) as Record<string, FriendPin>
  } catch {
    return {}
  }
}

async function savePins(pins: Record<string, FriendPin>): Promise<void> {
  const key = await getKey()
  if (!key) throw new Error('Cannot save pins: no seed loaded')
  const { ciphertext, nonce } = encrypt(JSON.stringify(pins), key)
  getStorage().value = { ciphertext, nonce, version: 1 }
}

export async function getPin(handle: string): Promise<FriendPin | null> {
  const pins = await loadPins()
  return pins[handle] ?? null
}

/**
 * Compare resolved pubkeys against the local pin for a friend.
 * - No existing pin  → TOFU-pin them now, return { action: 'pinned' }
 * - Pin matches      → return { action: 'match' }
 * - Pin mismatches   → return { action: 'mismatch', pin } and DO NOT update.
 *   The caller MUST block further encrypted exchanges with this friend until
 *   the user re-verifies.
 */
export async function checkAndPinFriend(params: {
  handle: string
  signingKey: string
  encryptionKey: string
}): Promise<
  | { action: 'pinned'; pin: FriendPin }
  | { action: 'match'; pin: FriendPin }
  | { action: 'mismatch'; pin: FriendPin }
> {
  const pins = await loadPins()
  const existing = pins[params.handle]

  if (!existing) {
    const pin: FriendPin = {
      handle: params.handle,
      signingKey: params.signingKey,
      encryptionKey: params.encryptionKey,
      firstSeenAt: Date.now(),
      verified: false,
    }
    pins[params.handle] = pin
    await savePins(pins)
    return { action: 'pinned', pin }
  }

  if (
    existing.signingKey !== params.signingKey ||
    existing.encryptionKey !== params.encryptionKey
  ) {
    return { action: 'mismatch', pin: existing }
  }

  return { action: 'match', pin: existing }
}

/**
 * Explicitly mark a friend's pin as verified after the user has confirmed
 * the safety number out of band.
 */
export async function markPinVerified(handle: string): Promise<void> {
  const pins = await loadPins()
  const pin = pins[handle]
  if (!pin) return
  pin.verified = true
  pins[handle] = pin
  await savePins(pins)
}

/**
 * Force-accept a new pin after a mismatch, typically used from a "I've
 * re-verified" UI. This rotates the stored pin to the new keys AND resets
 * verified=false, so the user must re-verify the safety number.
 */
export async function rotatePin(params: {
  handle: string
  signingKey: string
  encryptionKey: string
}): Promise<FriendPin> {
  const pins = await loadPins()
  const pin: FriendPin = {
    handle: params.handle,
    signingKey: params.signingKey,
    encryptionKey: params.encryptionKey,
    firstSeenAt: Date.now(),
    verified: false,
  }
  pins[params.handle] = pin
  await savePins(pins)
  return pin
}

export async function dropPin(handle: string): Promise<void> {
  const pins = await loadPins()
  delete pins[handle]
  await savePins(pins)
}

export async function listPins(): Promise<FriendPin[]> {
  const pins = await loadPins()
  return Object.values(pins)
}

/**
 * Derive a 12-digit safety number from two users' Ed25519 signing keys.
 *
 * Properties:
 * - Commutative: sort keys lexicographically so both users see the same number.
 * - Domain-separated via the 'parchment-safety-v1' HKDF context.
 * - 60 bits of entropy (12 decimal digits) — enough to make guessing infeasible
 *   while staying human-readable.
 */
export function deriveSafetyNumber(
  aliceSigningKeyBase64: string,
  bobSigningKeyBase64: string,
): string {
  const aliceBytes = importPublicKey(aliceSigningKeyBase64)
  const bobBytes = importPublicKey(bobSigningKeyBase64)

  const [firstKey, secondKey] =
    compareBytes(aliceBytes, bobBytes) <= 0
      ? [aliceBytes, bobBytes]
      : [bobBytes, aliceBytes]

  const ikm = new Uint8Array(firstKey.length + secondKey.length)
  ikm.set(firstKey, 0)
  ikm.set(secondKey, firstKey.length)

  const digest = hkdf(
    sha256,
    ikm,
    undefined,
    new TextEncoder().encode('parchment-safety-v1'),
    8, // 64 bits
  )

  // Collapse to 60 bits → 12 decimal digits (zero-padded, grouped in 3s).
  let n = 0n
  for (const byte of digest) {
    n = (n << 8n) | BigInt(byte)
  }
  const mod = 10n ** 12n
  const num = (n % mod).toString().padStart(12, '0')
  return `${num.slice(0, 3)} ${num.slice(3, 6)} ${num.slice(6, 9)} ${num.slice(9, 12)}`
}

// Re-exported for internal convenience — keeps module boundaries clear.
export { bytesToBase64, base64ToBytes }
