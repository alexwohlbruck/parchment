import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const service = vi.hoisted(() => ({
  checkHasLocalIdentity: vi.fn(),
  fetchIdentityFromServer: vi.fn(),
}))

vi.mock('@/services/identity.service', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/identity.service')>()),
  ...service,
}))

import { useIdentityStore } from './identity.store'
import { deriveAllKeys, exportPublicKey, generateSeed } from '@/lib/identity/federation-crypto'

const OWN_KEYS = deriveAllKeys(generateSeed())
const OWN_SIGNING_KEY = exportPublicKey(OWN_KEYS.signing.publicKey)
const IDENTITY = { handle: 'alice@example.org', signingKey: 'sign-1', encryptionKey: 'enc-1', domain: 'example.org' }

beforeEach(() => {
  setActivePinia(createPinia())
  service.checkHasLocalIdentity.mockReset().mockResolvedValue(false)
  service.fetchIdentityFromServer.mockReset().mockResolvedValue(IDENTITY)
})

describe('identity store', () => {
  test('loads the account identity from the server', async () => {
    const store = useIdentityStore()
    await store.initialize()
    expect(service.fetchIdentityFromServer).toHaveBeenCalledOnce()
    expect(store.identity).toEqual(IDENTITY)
    expect(store.identityUnavailable).toBe(false)
  })

  test('marks the identity unavailable when the server cannot be reached', async () => {
    service.fetchIdentityFromServer.mockRejectedValue(new Error('offline'))
    const store = useIdentityStore()
    await store.initialize()
    expect(store.identity).toBeNull()
    expect(store.identityUnavailable).toBe(true)
  })

  test('saved words are recorded for the key this device holds, and read as unsaved once that key changes', async () => {
    const store = useIdentityStore()
    expect(store.hasSavedRecoveryWords).toBeUndefined()
    await store.initialize()
    store.recoveryWordsSavedFor = null
    expect(store.hasSavedRecoveryWords).toBe(false)

    expect(store.markRecoveryWordsSaved()).toBe(false)

    store.localKeys = OWN_KEYS
    store.identity = { ...IDENTITY, signingKey: OWN_SIGNING_KEY }
    expect(store.markRecoveryWordsSaved()).toBe(true)
    expect(store.recoveryWordsSavedFor).toBe(OWN_SIGNING_KEY)
    expect(store.hasSavedRecoveryWords).toBe(true)

    store.identity = { ...IDENTITY, signingKey: 'rotated-elsewhere' }
    expect(store.hasSavedRecoveryWords).toBe(false)
  })

  test('a device holding outdated keys cannot mark its words saved', async () => {
    const store = useIdentityStore()
    await store.initialize()
    store.recoveryWordsSavedFor = null
    store.localKeys = OWN_KEYS
    store.isStale = true
    expect(store.markRecoveryWordsSaved()).toBe(false)
    expect(store.recoveryWordsSavedFor).toBeNull()
  })
})
