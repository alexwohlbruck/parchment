/**
 * Tests for the runtime-aware key-storage wrapper.
 *
 * Covers the browser path (localStorage-backed) in full, and the Tauri path
 * via a mocked @tauri-apps/api/core module. We can't actually exercise the
 * Rust keychain from vitest — that's a manual end-to-end test on a desktop
 * build — but we verify the frontend routes correctly, probes for command
 * availability, and handles the "command not registered" mobile fallback.
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
// Fresh module import per test so the backend cache is clean.
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
})

afterEach(() => {
  disableTauriRuntime()
})

describe('browser path (no Tauri runtime)', () => {
  test('getActiveStorageBackend returns localStorage', async () => {
    const ks = await freshKeyStorage()
    expect(await ks.getActiveStorageBackend()).toBe('localStorage')
  })

  test('storeSeed + getSeed round-trips a 32-byte seed', async () => {
    const ks = await freshKeyStorage()
    const seed = makeSeed(0x11)
    await ks.storeSeed(seed)
    const out = await ks.getSeed()
    expect(out).not.toBeNull()
    expect(Array.from(out!)).toEqual(Array.from(seed))
  })

  test('hasIdentity is true after store, false after clear', async () => {
    const ks = await freshKeyStorage()
    expect(await ks.hasIdentity()).toBe(false)
    await ks.storeSeed(makeSeed())
    expect(await ks.hasIdentity()).toBe(true)
    await ks.clearIdentity()
    expect(await ks.hasIdentity()).toBe(false)
  })

  test('verifySeedMatchesRecoveryKey matches stored seed', async () => {
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

describe('tauri-keychain path', () => {
  test('getActiveStorageBackend returns tauri-keychain when invoke works', async () => {
    enableTauriRuntime()
    mockInvoke = async () => null // probe call returns null cleanly
    const ks = await freshKeyStorage()
    expect(await ks.getActiveStorageBackend()).toBe('tauri-keychain')
  })

  test('storeSeed + getSeed go through invoke', async () => {
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
    expect(await ks.getActiveStorageBackend()).toBe('localStorage')
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
