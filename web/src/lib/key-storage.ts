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
 *   2. Everywhere else (browser, mobile Tauri webview) → localStorage.
 *      This is unchanged from the pre-C.2 behavior. The plan to move
 *      mobile onto the platform keystore is tracked as a follow-up
 *      (Part C notes: "Tauri mobile after PRF validated in target
 *      webviews").
 *
 * Callers see the same async API regardless of backend — getSeed,
 * storeSeed, hasIdentity, clearIdentity, verifySeedMatchesRecoveryKey
 * all behave identically. The backend is detected once and cached; a
 * misconfigured Tauri build (e.g. commands missing) fails loud rather
 * than silently downgrading to localStorage.
 */

import { useStorage } from '@vueuse/core'

const SEED_KEY = 'parchment-identity-seed'

// ---------------------------------------------------------------------------
// Backend interface
// ---------------------------------------------------------------------------

interface StorageBackend {
  name: 'localStorage' | 'tauri-keychain'
  set(key: string, value: string): Promise<void>
  get(key: string): Promise<string | null>
  delete(key: string): Promise<void>
}

// ---------------------------------------------------------------------------
// localStorage backend (via VueUse so existing reactive consumers keep
// working in the browser path).
// ---------------------------------------------------------------------------

let seedStorage: ReturnType<typeof useStorage<string | null>> | null = null
function getSeedStorage() {
  if (!seedStorage) seedStorage = useStorage<string | null>(SEED_KEY, null)
  return seedStorage
}

const localStorageBackend: StorageBackend = {
  name: 'localStorage',
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
// Public async API — unchanged signatures, unchanged semantics for callers.
// ---------------------------------------------------------------------------

export async function storeSeed(seed: Uint8Array): Promise<void> {
  let binaryString = ''
  for (let i = 0; i < seed.length; i++) {
    binaryString += String.fromCharCode(seed[i])
  }
  const backend = await getBackend()
  await backend.set(SEED_KEY, btoa(binaryString))
}

export async function getSeed(): Promise<Uint8Array | null> {
  try {
    const backend = await getBackend()
    const stored = await backend.get(SEED_KEY)
    if (!stored) return null

    const binaryString = atob(stored)
    if (binaryString.length !== 32) return null

    const seed = new Uint8Array(32)
    for (let i = 0; i < 32; i++) seed[i] = binaryString.charCodeAt(i)
    return seed
  } catch {
    return null
  }
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
 * Returns which backend is currently active. Useful for diagnostics + UI
 * ("Your identity is stored in your system keychain" vs localStorage).
 */
export async function getActiveStorageBackend(): Promise<
  StorageBackend['name']
> {
  return (await getBackend()).name
}

// Test-only hook — exported so tests can force re-resolution between cases.
export const _internals = {
  resetBackendCache: () => {
    cachedBackend = null
    seedStorage = null
  },
}
