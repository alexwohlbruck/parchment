/**
 * Tests for the runtime-aware key-storage wrapper.
 *
 * Covers the browser path (localStorage-backed, wrapped under a
 * server-held device secret) in full, and the Tauri path via a mocked
 * @tauri-apps/api/core module. We can't actually exercise the Rust
 * keychain from vitest — that's a manual end-to-end test on a desktop
 * build — but we verify the frontend routes correctly, probes for
 * command availability, and handles the "command not registered" mobile
 * fallback.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @tauri-apps/api/core. The mock is swap-able per-test via `mockInvoke`.
// ---------------------------------------------------------------------------

type InvokeImpl = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>

let mockInvoke: InvokeImpl = async () => {
  throw new Error('invoke mock not configured for this test')
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    mockInvoke(cmd, args),
}))

// ---------------------------------------------------------------------------
// Mock the axios `api` client used to fetch wrap secrets. Each test
// configures what the server "returns" via `apiGetImpl`.
// ---------------------------------------------------------------------------

type ApiGetImpl = (url: string) => Promise<{ data: unknown }>
let apiGetImpl: ApiGetImpl = async () => {
  throw new Error('api.get mock not configured')
}
const apiGetSpy = vi.fn((url: string) => apiGetImpl(url))

vi.mock('./api', () => ({
  api: { get: apiGetSpy },
  isTauri: false,
  getIsTauri: async () => false,
}))

// Fixed per-test wrap secret so we can sanity-check envelope structure.
function makeSecretResponse(b64: string) {
  return { data: { secret: b64 } }
}

function randomSecretB64(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

// ---------------------------------------------------------------------------
// Helpers: toggle Tauri runtime detection.
// ---------------------------------------------------------------------------

function enableTauriRuntime() {
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
}

function disableTauriRuntime() {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
}

// ---------------------------------------------------------------------------
// Common fixture seed.
// ---------------------------------------------------------------------------

function makeSeed(byte = 0x42): Uint8Array {
  const s = new Uint8Array(32)
  s.fill(byte)
  return s
}

// ---------------------------------------------------------------------------
// Fresh module import per test so the backend cache + wrap-key cache are clean.
// ---------------------------------------------------------------------------

async function freshKeyStorage() {
  vi.resetModules()
  return await import('./key-storage')
}

beforeEach(() => {
  window.localStorage.clear()
  disableTauriRuntime()
  mockInvoke = async () => {
    throw new Error('invoke mock not configured')
  }
  apiGetImpl = async () => {
    throw new Error('api.get mock not configured')
  }
  apiGetSpy.mockClear()
})

afterEach(() => {
  disableTauriRuntime()
})

describe('browser path (no Tauri runtime) — wrapped localStorage', () => {
  test('getActiveStorageBackend returns localStorage-wrapped', async () => {
    const ks = await freshKeyStorage()
    expect(await ks.getActiveStorageBackend()).toBe('localStorage-wrapped')
  })

  test('storeSeed + getSeed round-trips via device wrap secret', async () => {
    const secret = randomSecretB64()
    apiGetImpl = async () => makeSecretResponse(secret)

    const ks = await freshKeyStorage()
    const seed = makeSeed(0x11)
    await ks.storeSeed(seed)
    const out = await ks.getSeed()

    expect(out).not.toBeNull()
    expect(Array.from(out!)).toEqual(Array.from(seed))
    expect(apiGetSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^users\/me\/devices\/[^/]+\/wrap-secret$/),
    )
  })

  test('stored value is a v2 envelope (first byte after base64 decode is 0x02)', async () => {
    apiGetImpl = async () => makeSecretResponse(randomSecretB64())

    const ks = await freshKeyStorage()
    await ks.storeSeed(makeSeed(0x22))

    const stored = window.localStorage.getItem('parchment-identity-seed')
    expect(stored).not.toBeNull()
    const raw = atob(stored!)
    // Envelope is substantially longer than a plain 32-byte seed; definitely
    // not the legacy shape.
    expect(raw.length).toBeGreaterThan(32)
    expect(raw.charCodeAt(0)).toBe(0x02)
  })

  test('wrap secret is fetched once per session (cached)', async () => {
    let calls = 0
    const secret = randomSecretB64()
    apiGetImpl = async () => {
      calls += 1
      return makeSecretResponse(secret)
    }

    const ks = await freshKeyStorage()
    await ks.storeSeed(makeSeed(0x33))
    await ks.getSeed()
    await ks.getSeed()

    expect(calls).toBe(1)
  })

  test('hasIdentity reflects wrapped storage', async () => {
    apiGetImpl = async () => makeSecretResponse(randomSecretB64())
    const ks = await freshKeyStorage()
    expect(await ks.hasIdentity()).toBe(false)
    await ks.storeSeed(makeSeed())
    expect(await ks.hasIdentity()).toBe(true)
    await ks.clearIdentity()
    expect(await ks.hasIdentity()).toBe(false)
  })

  test('rotation: when the server rotates the secret, getSeed returns null and clears the stale envelope', async () => {
    const originalSecret = randomSecretB64()
    apiGetImpl = async () => makeSecretResponse(originalSecret)

    const ks = await freshKeyStorage()
    await ks.storeSeed(makeSeed(0x55))
    expect(await ks.getSeed()).not.toBeNull()
    expect(
      window.localStorage.getItem('parchment-identity-seed'),
    ).not.toBeNull()

    // Simulate rotation — new module instance, server returns a different
    // secret. The cached envelope in localStorage was wrapped under the
    // old secret, so decrypt must fail, the envelope must get cleared,
    // and getSeed must return null.
    const ks2 = await freshKeyStorage()
    apiGetImpl = async () => makeSecretResponse(randomSecretB64())
    expect(await ks2.getSeed()).toBeNull()
    expect(window.localStorage.getItem('parchment-identity-seed')).toBeNull()
  })

  test('401 on wrap-secret fetch: getSeed returns null WITHOUT clearing the envelope', async () => {
    // First, write a real envelope under a valid secret.
    const secret = randomSecretB64()
    apiGetImpl = async () => makeSecretResponse(secret)

    const ks = await freshKeyStorage()
    await ks.storeSeed(makeSeed(0x77))
    const storedBefore = window.localStorage.getItem('parchment-identity-seed')
    expect(storedBefore).not.toBeNull()

    // Fresh module (wrap-key cache dropped). Server rejects auth.
    const ks2 = await freshKeyStorage()
    apiGetImpl = async () => {
      const err = new Error('Unauthorized') as Error & {
        response?: { status: number }
      }
      err.response = { status: 401 }
      throw err
    }

    expect(await ks2.getSeed()).toBeNull()
    // Envelope preserved — user signs in again, secret becomes fetchable,
    // seed recovers without a setup round-trip.
    expect(window.localStorage.getItem('parchment-identity-seed')).toBe(
      storedBefore,
    )
  })

  test('legacy plain 32-byte seed is NOT accepted — the backdoor was closed', async () => {
    // Pre-wrap deployments wrote 32 raw bytes here. Accepting that
    // shape was a soft migration ramp but also meant any 32-byte
    // blob planted by XSS would round-trip as the user's seed. We
    // closed it once wrap-secret shipped; this test guards that the
    // plain-bytes path stays dead.
    const legacy = makeSeed(0x88)
    let binary = ''
    for (let i = 0; i < legacy.length; i++)
      binary += String.fromCharCode(legacy[i])
    window.localStorage.setItem('parchment-identity-seed', btoa(binary))

    // unwrapSeed will try to fetch the wrap secret; have it succeed so
    // we observe the decryption path rather than the network-error
    // path. It should still fail to decrypt a raw 32-byte blob as a
    // v2 envelope → WrapSecretRotatedError → envelope cleared.
    apiGetImpl = async () => makeSecretResponse(randomSecretB64())

    const ks = await freshKeyStorage()
    const out = await ks.getSeed()
    expect(out).toBeNull()
    // The stored blob must have been cleared so the app falls through
    // to setup instead of looping on an unreadable value.
    expect(window.localStorage.getItem('parchment-identity-seed')).toBeNull()
  })

  test('verifySeedMatchesRecoveryKey still matches through the wrap', async () => {
    apiGetImpl = async () => makeSecretResponse(randomSecretB64())

    const ks = await freshKeyStorage()
    const seed = makeSeed(0x33)
    await ks.storeSeed(seed)

    let recoveryKey = ''
    for (let i = 0; i < seed.length; i++)
      recoveryKey += String.fromCharCode(seed[i])
    recoveryKey = btoa(recoveryKey)

    expect(await ks.verifySeedMatchesRecoveryKey(recoveryKey)).toBe(true)
  })

  test('verifySeedMatchesRecoveryKey rejects a different seed', async () => {
    apiGetImpl = async () => makeSecretResponse(randomSecretB64())

    const ks = await freshKeyStorage()
    await ks.storeSeed(makeSeed(0x44))

    const other = makeSeed(0x55)
    let recoveryKey = ''
    for (let i = 0; i < other.length; i++)
      recoveryKey += String.fromCharCode(other[i])
    recoveryKey = btoa(recoveryKey)

    expect(await ks.verifySeedMatchesRecoveryKey(recoveryKey)).toBe(false)
  })
})

describe('tauri-keychain path (unchanged by wrap feature)', () => {
  test('getActiveStorageBackend returns tauri-keychain when invoke works', async () => {
    enableTauriRuntime()
    mockInvoke = async () => null // probe call returns null cleanly
    const ks = await freshKeyStorage()
    expect(await ks.getActiveStorageBackend()).toBe('tauri-keychain')
  })

  test('storeSeed + getSeed go through invoke, no wrap-secret fetch', async () => {
    enableTauriRuntime()

    const store = new Map<string, string>()
    mockInvoke = async (cmd, args) => {
      const key = (args as { key: string }).key
      if (cmd === 'keychain_set') {
        store.set(key, (args as { value: string }).value)
        return undefined
      }
      if (cmd === 'keychain_get') return store.get(key) ?? null
      if (cmd === 'keychain_delete') {
        store.delete(key)
        return undefined
      }
      throw new Error(`unexpected command ${cmd}`)
    }

    const ks = await freshKeyStorage()
    const seed = makeSeed(0x22)
    await ks.storeSeed(seed)

    const out = await ks.getSeed()
    expect(out).not.toBeNull()
    expect(Array.from(out!)).toEqual(Array.from(seed))

    // And the seed actually went through the mock, not localStorage.
    expect(store.size).toBeGreaterThan(0)
    expect(window.localStorage.getItem('parchment-identity-seed')).toBeNull()
    // Desktop Tauri must NEVER hit the wrap-secret endpoint.
    expect(apiGetSpy).not.toHaveBeenCalled()
  })

  test('clearIdentity invokes keychain_delete', async () => {
    enableTauriRuntime()
    const deleted: string[] = []
    mockInvoke = async (cmd, args) => {
      if (cmd === 'keychain_get') return null
      if (cmd === 'keychain_delete') {
        deleted.push((args as { key: string }).key)
        return undefined
      }
      return undefined
    }

    const ks = await freshKeyStorage()
    await ks.clearIdentity()
    expect(deleted).toContain('parchment-identity-seed')
  })

  test('falls back to localStorage when commands are not registered (mobile)', async () => {
    enableTauriRuntime()
    mockInvoke = async () => {
      throw new Error('command keychain_get not registered')
    }

    const ks = await freshKeyStorage()
    expect(await ks.getActiveStorageBackend()).toBe('localStorage-wrapped')
  })

  test('does NOT fall back when command exists but throws a real error', async () => {
    // If keychain_get exists but fails with a real error (e.g. user denied
    // keychain access), we should surface the failure rather than silently
    // demoting to localStorage. Probe returns cleanly — actual call fails.
    enableTauriRuntime()
    let probeDone = false
    mockInvoke = async (cmd) => {
      if (!probeDone && cmd === 'keychain_get') {
        probeDone = true
        return null
      }
      throw new Error('User denied keychain access')
    }

    const ks = await freshKeyStorage()
    expect(await ks.getActiveStorageBackend()).toBe('tauri-keychain')
    await expect(ks.storeSeed(makeSeed())).rejects.toThrow(/denied/)
  })
})
