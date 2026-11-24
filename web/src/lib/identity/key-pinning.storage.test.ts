import { describe, test, expect, vi, beforeEach } from 'vitest'

let currentSeed: Uint8Array | null = null
vi.mock('./key-storage', () => ({ getSeed: async () => currentSeed }))

const { checkAndPinFriend, getPin, keepPinsAcrossSeedChange } = await import(
  './key-pinning'
)

const seed = (byte: number) => new Uint8Array(32).fill(byte)
const bob = { handle: 'bob@peer.test', signingKey: 'sig-b', encryptionKey: 'enc-b' }

beforeEach(() => {
  localStorage.clear()
  currentSeed = seed(1)
})

describe('keepPinsAcrossSeedChange', () => {
  test('pins stay readable under the new seed', async () => {
    await checkAndPinFriend(bob)
    await keepPinsAcrossSeedChange(async () => {
      currentSeed = seed(2)
    })
    expect((await getPin(bob.handle))?.signingKey).toBe('sig-b')
  })

  test('without it, a new seed loses every pin', async () => {
    await checkAndPinFriend(bob)
    currentSeed = seed(2)
    expect(await getPin(bob.handle)).toBeNull()
  })
})
