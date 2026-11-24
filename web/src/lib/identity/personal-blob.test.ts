import { describe, test, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  seed: null as Uint8Array | null,
  get: vi.fn(),
  put: vi.fn(),
}))

vi.mock('./key-storage', () => ({ getSeed: async () => hoisted.seed }))
vi.mock('@/lib/api', () => ({
  api: { get: hoisted.get, put: hoisted.put, delete: vi.fn() },
}))

import {
  deriveAllKeys,
  exportPublicKey,
  generateSeed,
} from './federation-crypto'
import {
  BlobUnreadableError,
  StaleKeysError,
  loadBlob,
  resetBlobKeyVersion,
  saveBlob,
} from './personal-blob'

function serverIdentity(seed: Uint8Array, kmVersion: number) {
  return {
    data: {
      signingKey: exportPublicKey(deriveAllKeys(seed).signing.publicKey),
      kmVersion,
    },
  }
}

beforeEach(() => {
  hoisted.seed = generateSeed()
  hoisted.get.mockReset()
  hoisted.put.mockReset()
  resetBlobKeyVersion()
})

describe('saveBlob', () => {
  test('stamps the key version the server confirms for this seed', async () => {
    hoisted.get.mockResolvedValueOnce(serverIdentity(hoisted.seed!, 4))

    await saveBlob('settings', 'u1', { a: 1 })
    await saveBlob('settings', 'u1', { a: 2 })

    expect(hoisted.put.mock.calls[0][1].kmVersion).toBe(4)
    expect(hoisted.get).toHaveBeenCalledOnce()
  })

  test('refuses to write when the server holds keys from a newer seed', async () => {
    hoisted.get.mockResolvedValueOnce(serverIdentity(generateSeed(), 5))

    await expect(saveBlob('settings', 'u1', {})).rejects.toBeInstanceOf(StaleKeysError)
    expect(hoisted.put).not.toHaveBeenCalled()
  })

  test('a 409 marks the keys stale and re-checks on the next save', async () => {
    hoisted.get.mockResolvedValue(serverIdentity(hoisted.seed!, 4))
    hoisted.put.mockRejectedValueOnce({ response: { status: 409 } })

    await expect(saveBlob('settings', 'u1', {})).rejects.toBeInstanceOf(StaleKeysError)
    await saveBlob('settings', 'u1', {})

    expect(hoisted.get).toHaveBeenCalledTimes(2)
  })
})

describe('loadBlob', () => {
  test('returns null when there is no blob yet', async () => {
    hoisted.get.mockResolvedValueOnce({ status: 204, data: '' })

    expect(await loadBlob('settings', 'u1')).toBeNull()
  })

  test('throws rather than reporting an unreadable blob as empty', async () => {
    hoisted.get.mockResolvedValueOnce({
      status: 200,
      data: { encryptedBlob: 'not-an-envelope', nonce: '', kmVersion: 1 },
    })

    await expect(loadBlob('settings', 'u1')).rejects.toBeInstanceOf(BlobUnreadableError)
  })
})
