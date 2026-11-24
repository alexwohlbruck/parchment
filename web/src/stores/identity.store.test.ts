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
})
