/**
 * Identity-seed storage.
 *
 * Routes to the best available backend at runtime:
 *
 *   1. Desktop Tauri → OS keychain (Apple Keychain, Windows Credential
 *      Manager, libsecret/Secret Service). Hardware-backed on Macs with
 *      Secure Enclave. First call on macOS pops the standard "allow
 *      keychain access" prompt; Always Allow silences further prompts.
 *
 *   2. Everywhere else (browser, mobile Tauri webview) → localStorage,
 *      BUT the seed bytes are never written in the clear. The seed is
 *      wrapped as a v2 envelope under a key derived (HKDF
 *      `parchment-seed-wrap-v1`) from a server-held per-device secret
 *      that rotates when the user signs out of all devices. Cold-open
 *      cost: one small authenticated GET + one AES-GCM decrypt.
 *
 * Callers see the same async API regardless of backend — getSeed,
 * storeSeed, hasIdentity, clearIdentity, verifySeedMatchesRecoveryKey
 * all behave identically. The backend is detected once and cached; a
 * misconfigured Tauri build (e.g. commands missing) fails loud rather
 * than silently downgrading to localStorage.
 */

import { useStorage } from '@vueuse/core'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { api } from './api'
import {
  encryptEnvelopeBytes,
  decryptEnvelopeBytes,
  type AAD,
} from './crypto-envelope'
import { base64ToBytes, bytesToBase64 } from './federation-crypto'
import { getOrCreateDeviceId } from './device-id'

const SEED_KEY = 'parchment-identity-seed'
const WRAP_KEY_CONTEXT = 'parchment-seed-wrap-v1'

// ---------------------------------------------------------------------------
// Backend interface
// ---------------------------------------------------------------------------

type BackendName = 'localStorage-wrapped' | 'localStorage-plain' | 'tauri-keychain'

interface StorageBackend {
  name: BackendName
  set(key: string, value: string): Promise<void>
  get(key: string): Promise<string | null>
  delete(key: string): Promise<void>
}

// ---------------------------------------------------------------------------
// localStorage backend (via VueUse so existing reactive consumers keep
// working in the browser path). Wrapping happens at the public API layer
// above this, so the backend itself still just handles opaque strings.
// ---------------------------------------------------------------------------

let seedStorage: ReturnType<typeof useStorage<string | null>> | null = null
function getSeedStorage() {
  if (!seedStorage) seedStorage = useStorage<string | null>(SEED_KEY, null)
  return seedStorage
}

const localStorageBackend: StorageBackend = {
  name: 'localStorage-wrapped',
  async set(key, value) {
    if (key === SEED_KEY) getSeedStorage().value = value
    else localStorage.setItem(key, value)
  },
  async get(key) {
    if (key === SEED_KEY) return getSeedStorage().value
    return localStorage.getItem(key)
  },
  async delete(key) {
    if (key === SEED_KEY) getSeedStorage().value = null
    else localStorage.removeItem(key)
  },
}

// ---------------------------------------------------------------------------
// Tauri keychain backend — invokes the Rust commands defined in
// src-tauri/src/keychain.rs. Only available on desktop builds.
// ---------------------------------------------------------------------------

interface WindowWithTauri extends Window {
  __TAURI_INTERNALS__?: unknown
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in (window as WindowWithTauri)
}

async function buildTauriBackend(): Promise<StorageBackend | null> {
  if (!isTauriRuntime()) return null

  let invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
  try {
    const core = await import('@tauri-apps/api/core')
    invoke = core.invoke
  } catch {
    // @tauri-apps/api not available — unusual but fall through.
    return null
  }

  // Probe for the keychain command's existence. Mobile Tauri builds don't
  // register these; a missing command throws a known error.
  try {
    await invoke('keychain_get', { key: '__parchment_keychain_probe__' })
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err)
    // Tauri returns a "command not registered" style error when the handler
    // isn't compiled in (e.g. mobile builds that skip the cfg-gated module).
    if (/not (allowed|found|registered)/i.test(msg) || /unknown command/i.test(msg)) {
      return null
    }
    // Any OTHER error means the command exists but failed — that's a real
    // bug in the Rust side, not a fallback condition. Let it surface at
    // actual call time rather than silently downgrading now.
  }

  return {
    name: 'tauri-keychain',
    async set(key, value) {
      await invoke<void>('keychain_set', { key, value })
    },
    async get(key) {
      const v = await invoke<string | null>('keychain_get', { key })
      return v ?? null
    },
    async delete(key) {
      await invoke<void>('keychain_delete', { key })
    },
  }
}

// ---------------------------------------------------------------------------
// Backend selector. Resolved once per app session; unit tests reset via
// `_internals.resetBackendCache()`.
// ---------------------------------------------------------------------------

let cachedBackend: Promise<StorageBackend> | null = null

function getBackend(): Promise<StorageBackend> {
  if (!cachedBackend) {
    cachedBackend = (async () => {
      const tauri = await buildTauriBackend()
      return tauri ?? localStorageBackend
    })()
  }
  return cachedBackend
}

// ---------------------------------------------------------------------------
// Wrap-secret fetch + HKDF derive. Only used on the localStorage backend.
// ---------------------------------------------------------------------------

class WrapSecretUnavailableError extends Error {
  readonly reason: unknown
  constructor(reason: unknown) {
    super('device wrap secret unavailable')
    this.name = 'WrapSecretUnavailableError'
    this.reason = reason
  }
}

class WrapSecretRotatedError extends Error {
  constructor() {
    super('device wrap secret has been rotated; cached envelope unreadable')
    this.name = 'WrapSecretRotatedError'
  }
}

let cachedWrapKey: { deviceId: string; key: Uint8Array } | null = null

async function fetchWrapSecret(deviceId: string): Promise<Uint8Array> {
  try {
    const response = await api.get<{ secret: string }>(
      `users/me/devices/${deviceId}/wrap-secret`,
    )
    return base64ToBytes(response.data.secret)
  } catch (err) {
    throw new WrapSecretUnavailableError(err)
  }
}

async function deriveWrapKey(): Promise<Uint8Array> {
  const deviceId = getOrCreateDeviceId()
  if (cachedWrapKey && cachedWrapKey.deviceId === deviceId) {
    return cachedWrapKey.key
  }
  const secret = await fetchWrapSecret(deviceId)
  const key = hkdf(
    sha256,
    secret,
    undefined,
    new TextEncoder().encode(WRAP_KEY_CONTEXT),
    32,
  )
  cachedWrapKey = { deviceId, key }
  return key
}

function buildWrapAad(): AAD {
  return {
    userId: getOrCreateDeviceId(),
    recordType: 'seed-wrap',
    recordId: 'local',
    keyContext: WRAP_KEY_CONTEXT,
  }
}

async function wrapSeed(seed: Uint8Array): Promise<Uint8Array> {
  const key = await deriveWrapKey()
  return encryptEnvelopeBytes({ plaintext: seed, key, aad: buildWrapAad() })
}

async function unwrapSeed(envelopeBytes: Uint8Array): Promise<Uint8Array> {
  const key = await deriveWrapKey()
  try {
    return decryptEnvelopeBytes({
      envelope: envelopeBytes,
      key,
      aad: buildWrapAad(),
    })
  } catch {
    // AEAD fail — secret was rotated (or envelope is corrupt). Drop the
    // cached key so the next call refetches cleanly.
    cachedWrapKey = null
    throw new WrapSecretRotatedError()
  }
}

// ---------------------------------------------------------------------------
// Public async API — unchanged signatures, unchanged semantics for callers.
// ---------------------------------------------------------------------------

export async function storeSeed(seed: Uint8Array): Promise<void> {
  const backend = await getBackend()
  if (backend.name === 'tauri-keychain') {
    await backend.set(SEED_KEY, bytesToBase64(seed))
    return
  }
  // localStorage-wrapped: encrypt under device wrap key before persisting.
  const envelope = await wrapSeed(seed)
  await backend.set(SEED_KEY, bytesToBase64(envelope))
}

export async function getSeed(): Promise<Uint8Array | null> {
  const backend = await getBackend()
  const stored = await backend.get(SEED_KEY)
  if (!stored) return null

  try {
    if (backend.name === 'tauri-keychain') {
      return decodeRawSeed(stored)
    }

    // localStorage-wrapped path: everything we've ever written from
    // `storeSeed` since wrap-secret shipped is a v2 envelope. No
    // legacy plain-seed fallback — that widened the attack surface
    // (a 32-byte blob planted by XSS would have been accepted as
    // the seed) and is obsolete now that every new install wraps.
    const bytes = base64ToBytes(stored)

    try {
      const unwrapped = await unwrapSeed(bytes)
      if (unwrapped.length !== 32) return null
      return unwrapped
    } catch (err) {
      if (err instanceof WrapSecretRotatedError) {
        // Stored envelope is permanently unreadable — clear it so the app
        // falls through to setup/sign-in cleanly.
        await backend.delete(SEED_KEY)
      }
      // Either rotated (envelope cleared) or temporarily unavailable
      // (network / 401). Either way return null; don't wipe the envelope
      // in the unavailable case so a future call can still unwrap.
      return null
    }
  } catch (err) {
    // Unexpected failure (base64 decode error, backend read error,
    // etc.) — distinct from the well-known WrapSecretRotated /
    // WrapSecretUnavailable paths above. Surface in the console so
    // future debugging isn't chasing silent nulls.
    console.warn('[key-storage] getSeed failed unexpectedly', err)
    return null
  }
}

function decodeRawSeed(stored: string): Uint8Array | null {
  const binaryString = atob(stored)
  if (binaryString.length !== 32) return null
  const seed = new Uint8Array(32)
  for (let i = 0; i < 32; i++) seed[i] = binaryString.charCodeAt(i)
  return seed
}

export async function hasIdentity(): Promise<boolean> {
  const seed = await getSeed()
  return seed !== null
}

export async function clearIdentity(): Promise<void> {
  const backend = await getBackend()
  await backend.delete(SEED_KEY)
}

export async function verifySeedMatchesRecoveryKey(
  recoveryKey: string,
): Promise<boolean> {
  try {
    const storedSeed = await getSeed()
    if (!storedSeed) return false

    const binaryString = atob(recoveryKey.trim())
    const importedSeed = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      importedSeed[i] = binaryString.charCodeAt(i)
    }

    if (importedSeed.length !== 32) return false

    for (let i = 0; i < 32; i++) {
      if (storedSeed[i] !== importedSeed[i]) return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * Returns which backend is currently active. Useful for diagnostics + UI.
 * Possible values:
 *   - `tauri-keychain` — desktop OS keychain
 *   - `localStorage-wrapped` — browser / mobile webview; seed is v2-envelope
 *     wrapped under a server-held device secret
 *   - `localStorage-plain` — reserved for legacy detection; not currently
 *     returned by any live backend
 */
export async function getActiveStorageBackend(): Promise<BackendName> {
  return (await getBackend()).name
}

// Test-only hook — exported so tests can force re-resolution between cases.
export const _internals = {
  resetBackendCache: () => {
    cachedBackend = null
    seedStorage = null
    cachedWrapKey = null
  },
}
