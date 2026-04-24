/**
 * Integration-style tests for the identity-service enrollment + unlock
 * flows. Exercises the real crypto end-to-end (passkey-prf slot build /
 * unwrap, wrapping AAD binding) and mocks only:
 *   - the HTTP client (`@/lib/api`) — each test stages the responses it
 *     expects the server would give.
 *   - the local seed store (`@/lib/key-storage`) — in-memory fake.
 *   - the WebAuthn ceremony callbacks — fed synthetic PRF outputs.
 *
 * The assertion responses use the simplewebauthn-browser JSON shape
 * (`clientExtensionResults.prf.results.first` as base64url).
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// `vi.mock` is hoisted above everything, including top-level `const`s,
// so we need `vi.hoisted` for anything the factories close over.
const hoisted = vi.hoisted(() => {
  const state = {
    stubSeed: null as Uint8Array | null,
    getHandlers: new Map<string, (body?: unknown) => unknown>(),
    postHandlers: new Map<string, (body?: unknown) => unknown>(),
  }
  return {
    state,
    storeSeedSpy: vi.fn(async (seed: Uint8Array) => {
      state.stubSeed = seed
    }),
    getSeedSpy: vi.fn(async () => state.stubSeed),
    apiGetSpy: vi.fn(async (url: string) => {
      const handler = state.getHandlers.get(url)
      if (!handler) {
        const err = new Error(`Unexpected GET ${url}`) as Error & {
          response?: { status: number }
        }
        err.response = { status: 500 }
        throw err
      }
      return handler()
    }),
    apiPostSpy: vi.fn(async (url: string, body?: unknown) => {
      const handler = state.postHandlers.get(url)
      if (!handler) {
        const err = new Error(`Unexpected POST ${url}`) as Error & {
          response?: { status: number }
        }
        err.response = { status: 500 }
        throw err
      }
      return handler(body)
    }),
  }
})

vi.mock('@/lib/key-storage', () => ({
  storeSeed: (seed: Uint8Array) => hoisted.storeSeedSpy(seed),
  getSeed: () => hoisted.getSeedSpy(),
  hasIdentity: async () => hoisted.state.stubSeed !== null,
  clearIdentity: async () => {
    hoisted.state.stubSeed = null
  },
}))

vi.mock('@/lib/api', () => ({
  api: {
    get: hoisted.apiGetSpy,
    post: hoisted.apiPostSpy,
    put: vi.fn(),
    delete: vi.fn(),
  },
  isTauri: false,
  getIsTauri: async () => false,
}))

import {
  generateSeed,
  deriveAllKeys,
  bytesToBase64,
  exportPublicKey,
  base64ToBytes,
} from '@/lib/federation-crypto'
import {
  buildWrappedKmSlot,
  deriveWrapKey,
} from '@/lib/passkey-prf'
import {
  enrollPasskeySlot,
  enrollExistingPasskeyAsSlot,
  unlockSeedWithPasskey,
  fetchWrappedKeySlots,
  hasAnyWrappedKeySlot,
} from './identity.service'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fakeAssertionWithPrf(credentialId: string, prfOutput: Uint8Array) {
  return {
    id: credentialId,
    clientExtensionResults: {
      prf: { results: { first: toBase64Url(prfOutput) } },
    },
  }
}

const getHandlers = hoisted.state.getHandlers
const postHandlers = hoisted.state.postHandlers
const { apiGetSpy, apiPostSpy, storeSeedSpy, getSeedSpy } = hoisted

beforeEach(() => {
  getHandlers.clear()
  postHandlers.clear()
  apiGetSpy.mockClear()
  apiPostSpy.mockClear()
  storeSeedSpy.mockClear()
  getSeedSpy.mockClear()
  hoisted.state.stubSeed = null
})

afterEach(() => {
  // Don't restoreAllMocks — that would blow away the hoisted spies that
  // the vi.mock factories depend on for the rest of the suite.
})

// ---------------------------------------------------------------------------
// enrollPasskeySlot
// ---------------------------------------------------------------------------

describe('enrollPasskeySlot', () => {
  const userId = 'user-abc'
  const credentialId = 'cred-xyz'

  test('fast path — PRF output returned in-band at registration, single tap', async () => {
    const seed = generateSeed()
    const keys = deriveAllKeys(seed)
    const prfOutput = new Uint8Array(32).fill(0x33)

    postHandlers.set('/users/me/wrapped-keys', () => ({
      data: { success: true },
    }))

    // Registration response carries PRF output (Chrome 132+/macOS,
    // Chrome 147+/Windows, iCloud Keychain). No second tap needed.
    const registerPasskey = vi.fn(async (_name: string) => ({
      passkey: { id: credentialId },
      attestationResponse: {
        clientExtensionResults: {
          prf: { enabled: true, results: { first: prfOutput.buffer } },
        },
      },
    }))
    const assertExistingPasskeyForPrf = vi.fn()
    const onSecondTapNeeded = vi.fn()

    const result = await enrollPasskeySlot({
      passkeyName: 'Test',
      seed,
      keys,
      userId,
      registerPasskey,
      assertExistingPasskeyForPrf,
      onSecondTapNeeded,
    })

    expect(result).toMatchObject({
      slotCreated: true,
      passkeyId: credentialId,
      secondTapUsed: false,
    })
    expect(assertExistingPasskeyForPrf).not.toHaveBeenCalled()
    expect(onSecondTapNeeded).not.toHaveBeenCalled()
    expect(apiPostSpy).toHaveBeenCalledWith(
      '/users/me/wrapped-keys',
      expect.objectContaining({ credentialId }),
    )
  })

  test('slow path — prf.enabled true but no in-band output, falls back to assertion', async () => {
    const seed = generateSeed()
    const keys = deriveAllKeys(seed)
    const prfOutput = new Uint8Array(32).fill(0x99)

    postHandlers.set('/users/me/wrapped-keys', () => ({
      data: { success: true },
    }))

    const registerPasskey = vi.fn(async (_name: string) => ({
      passkey: { id: credentialId },
      attestationResponse: {
        // Capable authenticator, but didn't eval in-band — older
        // FIDO2 keys, some cross-device flows.
        clientExtensionResults: { prf: { enabled: true } },
      },
    }))
    const assertExistingPasskeyForPrf = vi.fn(async (id: string) => {
      expect(id).toBe(credentialId)
      return fakeAssertionWithPrf(credentialId, prfOutput)
    })
    const onSecondTapNeeded = vi.fn()

    const result = await enrollPasskeySlot({
      passkeyName: 'Test',
      seed,
      keys,
      userId,
      registerPasskey,
      assertExistingPasskeyForPrf,
      onSecondTapNeeded,
    })

    expect(result).toMatchObject({
      slotCreated: true,
      passkeyId: credentialId,
      secondTapUsed: true,
    })
    expect(assertExistingPasskeyForPrf).toHaveBeenCalledOnce()
    expect(onSecondTapNeeded).toHaveBeenCalledOnce()
  })

  test("no slow-path attempt when prf.enabled is not true (authenticator can't do PRF at all)", async () => {
    const seed = generateSeed()
    const keys = deriveAllKeys(seed)

    const registerPasskey = vi.fn(async (_name: string) => ({
      passkey: { id: credentialId },
      attestationResponse: {
        // Authenticator didn't process the PRF extension at all.
        clientExtensionResults: {},
      },
    }))
    const assertExistingPasskeyForPrf = vi.fn()
    const onSecondTapNeeded = vi.fn()

    const result = await enrollPasskeySlot({
      passkeyName: 'Test',
      seed,
      keys,
      userId,
      registerPasskey,
      assertExistingPasskeyForPrf,
      onSecondTapNeeded,
    })

    expect(result).toMatchObject({
      slotCreated: false,
      passkeyId: credentialId,
      reason: 'prf-unavailable',
      secondTapUsed: false,
    })
    // Critical: we must NOT waste a second tap on an authenticator
    // that can't service PRF. prf.enabled is the signal.
    expect(assertExistingPasskeyForPrf).not.toHaveBeenCalled()
    expect(onSecondTapNeeded).not.toHaveBeenCalled()
  })

  test("slow path cancellation — user aborts second tap, still reports 'prf-unavailable'", async () => {
    const seed = generateSeed()
    const keys = deriveAllKeys(seed)

    const registerPasskey = vi.fn(async () => ({
      passkey: { id: credentialId },
      // prf.enabled is true, so we DO attempt the second ceremony…
      attestationResponse: { clientExtensionResults: { prf: { enabled: true } } },
    }))
    // …but the user cancels the second tap.
    const assertExistingPasskeyForPrf = vi.fn(async () => {
      const err = new Error('The operation either timed out or was not allowed')
      err.name = 'NotAllowedError'
      throw err
    })

    const result = await enrollPasskeySlot({
      passkeyName: 'Test',
      seed,
      keys,
      userId,
      registerPasskey,
      assertExistingPasskeyForPrf,
    })

    expect(result).toMatchObject({
      slotCreated: false,
      passkeyId: credentialId,
      reason: 'prf-unavailable',
      secondTapUsed: true,
    })
  })

  test("reports 'enroll-failed' when POST to /users/me/wrapped-keys fails (fast path)", async () => {
    const seed = generateSeed()
    const keys = deriveAllKeys(seed)
    const prfOutput = new Uint8Array(32).fill(0xab)

    // No POST handler → spy will throw 500.
    const registerPasskey = vi.fn(async () => ({
      passkey: { id: credentialId },
      // Fast path: registration emitted the PRF output.
      attestationResponse: {
        clientExtensionResults: {
          prf: { enabled: true, results: { first: prfOutput.buffer } },
        },
      },
    }))
    const assertExistingPasskeyForPrf = vi.fn()

    const result = await enrollPasskeySlot({
      passkeyName: 'Test',
      seed,
      keys,
      userId,
      registerPasskey,
      assertExistingPasskeyForPrf,
    })

    expect(result).toMatchObject({
      slotCreated: false,
      passkeyId: credentialId,
      reason: 'enroll-failed',
    })
    expect(assertExistingPasskeyForPrf).not.toHaveBeenCalled()
  })

  test('propagates registerPasskey errors (caller surfaces them)', async () => {
    const seed = generateSeed()
    const keys = deriveAllKeys(seed)

    const registerPasskey = vi.fn(async () => {
      const err = new Error('User cancelled')
      err.name = 'NotAllowedError'
      throw err
    })
    const assertExistingPasskeyForPrf = vi.fn()

    await expect(
      enrollPasskeySlot({
        passkeyName: 'Test',
        seed,
        keys,
        userId,
        registerPasskey,
        assertExistingPasskeyForPrf,
      }),
    ).rejects.toThrow('User cancelled')
    expect(assertExistingPasskeyForPrf).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// enrollExistingPasskeyAsSlot
// ---------------------------------------------------------------------------

describe('enrollExistingPasskeyAsSlot', () => {
  const userId = 'user-1'
  const credentialId = 'existing-cred'

  test('writes a slot when PRF is returned', async () => {
    const seed = generateSeed()
    const keys = deriveAllKeys(seed)
    const prfOutput = new Uint8Array(32).fill(0x09)
    postHandlers.set('/users/me/wrapped-keys', () => ({
      data: { success: true },
    }))

    const assertExistingPasskeyForPrf = vi.fn(async (id: string) => {
      expect(id).toBe(credentialId)
      return fakeAssertionWithPrf(credentialId, prfOutput)
    })

    const result = await enrollExistingPasskeyAsSlot({
      credentialId,
      seed,
      keys,
      userId,
      assertExistingPasskeyForPrf,
    })

    expect(result).toEqual({ slotCreated: true })
  })

  test("reports 'assertion-failed' when user cancels", async () => {
    const seed = generateSeed()
    const keys = deriveAllKeys(seed)
    const assertExistingPasskeyForPrf = vi.fn(async () => {
      throw new Error('cancelled')
    })

    const result = await enrollExistingPasskeyAsSlot({
      credentialId,
      seed,
      keys,
      userId,
      assertExistingPasskeyForPrf,
    })

    expect(result).toEqual({
      slotCreated: false,
      reason: 'assertion-failed',
    })
  })

  test("reports 'prf-unavailable' when assertion has no PRF output", async () => {
    const seed = generateSeed()
    const keys = deriveAllKeys(seed)
    const assertExistingPasskeyForPrf = vi.fn(async () => ({
      id: credentialId,
      clientExtensionResults: {}, // no prf at all
    }))

    const result = await enrollExistingPasskeyAsSlot({
      credentialId,
      seed,
      keys,
      userId,
      assertExistingPasskeyForPrf,
    })

    expect(result).toEqual({
      slotCreated: false,
      reason: 'prf-unavailable',
    })
  })
})

// ---------------------------------------------------------------------------
// unlockSeedWithPasskey
// ---------------------------------------------------------------------------

describe('unlockSeedWithPasskey', () => {
  const userId = 'user-unlock'
  const credentialId = 'cred-unlock'

  test('verifies signature, unwraps, and stores the seed', async () => {
    const seed = generateSeed()
    const keys = deriveAllKeys(seed)
    const signingPubB64 = exportPublicKey(keys.signing.publicKey)
    const prfOutput = new Uint8Array(32).fill(0x7e)

    // Build a real slot the same way the enrollment code would.
    const slot = await buildWrappedKmSlot({
      seed,
      prfOutput,
      userId,
      credentialId,
      identitySigningPrivateKey: keys.signing.privateKey,
    })

    getHandlers.set('/users/me/identity', () => ({
      data: {
        handle: 'alice@parchment',
        signingKey: signingPubB64,
        encryptionKey: exportPublicKey(keys.encryption.publicKey),
        domain: 'parchment',
      },
    }))
    getHandlers.set('/users/me/wrapped-keys', () => ({
      data: { slots: [slot] },
    }))
    getHandlers.set('auth/sessions/current', () => ({
      data: { user: { id: userId } },
    }))
    postHandlers.set(
      `/users/me/wrapped-keys/${credentialId}/used`,
      () => ({ data: { success: true } }),
    )

    const assertPasskeyForPrf = vi.fn(async () =>
      fakeAssertionWithPrf(credentialId, prfOutput),
    )

    const returned = await unlockSeedWithPasskey({ assertPasskeyForPrf })
    expect(returned).toBeInstanceOf(Uint8Array)
    expect(Array.from(returned)).toEqual(Array.from(seed))

    // storeSeed was called with the recovered bytes.
    expect(storeSeedSpy).toHaveBeenCalledTimes(1)
    const stored = storeSeedSpy.mock.calls[0][0]
    expect(Array.from(stored as Uint8Array)).toEqual(Array.from(seed))
  })

  test('throws when server has no federation identity', async () => {
    getHandlers.set('/users/me/identity', () => ({
      data: {
        handle: null,
        signingKey: null,
        encryptionKey: null,
        domain: 'parchment',
      },
    }))

    await expect(
      unlockSeedWithPasskey({ assertPasskeyForPrf: vi.fn() }),
    ).rejects.toThrow(/No federation identity/)
  })

  test('throws when no slots exist for the user', async () => {
    getHandlers.set('/users/me/identity', () => ({
      data: { signingKey: 'somekey', domain: 'parchment' },
    }))
    getHandlers.set('/users/me/wrapped-keys', () => ({
      data: { slots: [] },
    }))

    await expect(
      unlockSeedWithPasskey({ assertPasskeyForPrf: vi.fn() }),
    ).rejects.toThrow(/No passkey recovery slots/)
  })

  test('throws when user taps a passkey with no matching slot', async () => {
    const seed = generateSeed()
    const keys = deriveAllKeys(seed)
    const signingPubB64 = exportPublicKey(keys.signing.publicKey)
    const slot = await buildWrappedKmSlot({
      seed,
      prfOutput: new Uint8Array(32).fill(1),
      userId,
      credentialId: 'some-other-cred',
      identitySigningPrivateKey: keys.signing.privateKey,
    })

    getHandlers.set('/users/me/identity', () => ({
      data: { signingKey: signingPubB64, domain: 'parchment' },
    }))
    getHandlers.set('/users/me/wrapped-keys', () => ({
      data: { slots: [slot] },
    }))

    const assertPasskeyForPrf = vi.fn(async () =>
      fakeAssertionWithPrf('unknown-cred', new Uint8Array(32).fill(1)),
    )

    await expect(
      unlockSeedWithPasskey({ assertPasskeyForPrf }),
    ).rejects.toThrow(/no recovery slot/)
  })

  test('throws if the unwrapped seed does not match the server identity', async () => {
    // Mismatched identity: server advertises keys derived from a
    // DIFFERENT seed than the one wrapped in the slot. We detect that
    // and refuse to store.
    const slotSeed = generateSeed()
    const slotKeys = deriveAllKeys(slotSeed)
    const imposterSeed = generateSeed()
    const imposterKeys = deriveAllKeys(imposterSeed)

    const slot = await buildWrappedKmSlot({
      seed: slotSeed,
      prfOutput: new Uint8Array(32).fill(2),
      userId,
      credentialId,
      identitySigningPrivateKey: slotKeys.signing.privateKey,
    })

    // Server claims a DIFFERENT signing public key. That key is what
    // `verifyWrappedKmSlot` uses to check the slot signature — so the
    // signature check will fail before unwrap. This test confirms that
    // path.
    getHandlers.set('/users/me/identity', () => ({
      data: {
        signingKey: exportPublicKey(imposterKeys.signing.publicKey),
        domain: 'parchment',
      },
    }))
    getHandlers.set('/users/me/wrapped-keys', () => ({
      data: { slots: [slot] },
    }))
    getHandlers.set('auth/sessions/current', () => ({
      data: { user: { id: userId } },
    }))

    const assertPasskeyForPrf = vi.fn(async () =>
      fakeAssertionWithPrf(credentialId, new Uint8Array(32).fill(2)),
    )

    await expect(
      unlockSeedWithPasskey({ assertPasskeyForPrf }),
    ).rejects.toThrow(/signature verification/)

    // storeSeed must NOT be called.
    expect(storeSeedSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// slot listing helpers
// ---------------------------------------------------------------------------

describe('fetchWrappedKeySlots + hasAnyWrappedKeySlot', () => {
  test('returns [] when the server errors (no slots)', async () => {
    // No handler → api throws → service catches → returns []
    const slots = await fetchWrappedKeySlots()
    expect(slots).toEqual([])
    expect(await hasAnyWrappedKeySlot()).toBe(false)
  })

  test('returns the slots array when present', async () => {
    const seed = generateSeed()
    const keys = deriveAllKeys(seed)
    const slot = await buildWrappedKmSlot({
      seed,
      prfOutput: new Uint8Array(32).fill(1),
      userId: 'u',
      credentialId: 'c',
      identitySigningPrivateKey: keys.signing.privateKey,
    })
    getHandlers.set('/users/me/wrapped-keys', () => ({
      data: { slots: [slot] },
    }))

    const slots = await fetchWrappedKeySlots()
    expect(slots).toHaveLength(1)
    expect(slots[0].credentialId).toBe('c')
    expect(await hasAnyWrappedKeySlot()).toBe(true)
  })
})
