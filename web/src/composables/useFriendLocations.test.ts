/**
 * Unit tests for useFriendLocations composable
 *
 * Tests cover:
 * - Fetching encrypted locations from API
 * - Decrypting locations with friend's public key
 * - Polling mechanism
 * - State management
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import {
  generateSeed,
  deriveAllKeys,
  encryptLocationForFriendV2,
  exportPublicKey,
  type FriendShareBinding,
  type LocationData,
} from '@/lib/federation-crypto'

// Mock the stores and services
const mockFriends = ref<any[]>([])
const mockEncryptionPrivateKey = ref<Uint8Array | null>(null)
const mockIsSetupComplete = ref(false)
const mockHandle = ref<string | null>('alice@home.server')

vi.mock('@/stores/friends.store', () => ({
  useFriendsStore: () => ({
    friends: mockFriends,
  }),
}))

vi.mock('@/stores/identity.store', () => ({
  useIdentityStore: () => ({
    encryptionPrivateKey: mockEncryptionPrivateKey,
    isSetupComplete: mockIsSetupComplete,
    handle: mockHandle,
  }),
}))

/**
 * Build a v2 wire-shape encrypted location fixture from a sender's
 * perspective. Mirrors what the server would return to the receiver.
 */
async function v2LocationFixture(params: {
  senderKeys: ReturnType<typeof deriveAllKeys>
  senderHandle: string
  recipientKeys: ReturnType<typeof deriveAllKeys>
  recipientHandle: string
  location: LocationData
  idSuffix?: string
}): Promise<{
  id: string
  fromUserId: string
  senderHandle: string
  encryptedLocation: string
  nonce: string
  updatedAt: string
}> {
  const sentAt = new Date().toISOString()
  const [first, second] =
    params.senderHandle < params.recipientHandle
      ? [params.senderHandle, params.recipientHandle]
      : [params.recipientHandle, params.senderHandle]
  const binding: FriendShareBinding = {
    senderId: params.senderHandle,
    recipientId: params.recipientHandle,
    relationshipId: `${first}::${second}`,
    timestamp: sentAt,
  }
  const blob = await encryptLocationForFriendV2({
    location: params.location,
    mySigningPrivateKey: params.senderKeys.signing.privateKey,
    friendEncryptionPublicKey: params.recipientKeys.encryption.publicKey,
    binding,
  })
  return {
    id: `loc-${params.idSuffix ?? '1'}`,
    fromUserId: `${params.senderHandle}-id`,
    senderHandle: params.senderHandle,
    encryptedLocation: blob,
    nonce: sentAt,
    updatedAt: new Date().toISOString(),
  }
}

const mockGetFriendLocations = vi.fn()

vi.mock('@/services/location.service', () => ({
  useLocationService: () => ({
    getFriendLocations: mockGetFriendLocations,
  }),
}))

// Mock @vueuse/core createSharedComposable
vi.mock('@vueuse/core', () => ({
  createSharedComposable: (fn: () => any) => fn,
}))

// Import after mocks are set up
import { useFriendLocations } from './useFriendLocations'

describe('useFriendLocations', () => {
  // Test key pairs for Alice (me) and Bob (friend)
  let aliceKeys: ReturnType<typeof deriveAllKeys>
  let bobKeys: ReturnType<typeof deriveAllKeys>

  beforeEach(() => {
    // Generate test keys
    const aliceSeed = generateSeed()
    const bobSeed = generateSeed()
    aliceKeys = deriveAllKeys(aliceSeed)
    bobKeys = deriveAllKeys(bobSeed)

    // Reset mocks
    vi.clearAllMocks()
    mockFriends.value = []
    mockEncryptionPrivateKey.value = null
    mockIsSetupComplete.value = false
    mockGetFriendLocations.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Initial State', () => {
    test('starts with empty locations', () => {
      const { locations, hasLocations, isLoading, error } = useFriendLocations()

      expect(locations.value).toEqual([])
      expect(hasLocations.value).toBe(false)
      expect(isLoading.value).toBe(false)
      expect(error.value).toBeNull()
    })

  })

  describe('fetchLocations', () => {
    test('returns empty array when identity not set up', async () => {
      mockIsSetupComplete.value = false
      mockEncryptionPrivateKey.value = null

      const { fetchLocations } = useFriendLocations()
      const result = await fetchLocations()

      expect(result).toEqual([])
      expect(mockGetFriendLocations).not.toHaveBeenCalled()
    })

    test('returns empty array when no encryption key', async () => {
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = null

      const { fetchLocations } = useFriendLocations()
      const result = await fetchLocations()

      expect(result).toEqual([])
    })

    test('returns empty array when API returns nothing', async () => {
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey
      mockGetFriendLocations.mockResolvedValue([])

      const { fetchLocations } = useFriendLocations()
      const result = await fetchLocations()

      expect(result).toEqual([])
    })

    test('decrypts location from friend successfully', async () => {
      // Set up identity
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      // Set up friend (Bob)
      mockFriends.value = [
        {
          friendHandle: 'bob@other.server',
          friendEncryptionKey: exportPublicKey(bobKeys.encryption.publicKey),
          friendSigningKey: exportPublicKey(bobKeys.signing.publicKey),
          friendName: 'Bob',
          friendPicture: 'https://example.com/bob.jpg',
        },
      ]

      // Bob encrypts their location for Alice
      const bobLocation: LocationData = {
        lat: 37.7749,
        lng: -122.4194,
        accuracy: 10,
        timestamp: Date.now(),
      }

      mockGetFriendLocations.mockResolvedValue([
        await v2LocationFixture({
          senderKeys: bobKeys,
          senderHandle: 'bob@other.server',
          recipientKeys: aliceKeys,
          recipientHandle: 'alice@home.server',
          location: bobLocation,
        }),
      ])

      const { fetchLocations, locations } = useFriendLocations()
      const result = await fetchLocations()

      expect(result).toHaveLength(1)
      expect(result[0].friendHandle).toBe('bob@other.server')
      expect(result[0].friendAlias).toBe('bob')
      expect(result[0].friendName).toBe('Bob')
      expect(result[0].location.lat).toBeCloseTo(bobLocation.lat, 4)
      expect(result[0].location.lng).toBeCloseTo(bobLocation.lng, 4)
      expect(locations.value).toHaveLength(1)
    })

    test('handles multiple friends with locations', async () => {
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      // Create another friend (Charlie)
      const charlieSeed = generateSeed()
      const charlieKeys = deriveAllKeys(charlieSeed)

      mockFriends.value = [
        {
          friendHandle: 'bob@other.server',
          friendEncryptionKey: exportPublicKey(bobKeys.encryption.publicKey),
          friendSigningKey: exportPublicKey(bobKeys.signing.publicKey),
        },
        {
          friendHandle: 'charlie@third.server',
          friendEncryptionKey: exportPublicKey(charlieKeys.encryption.publicKey),
          friendSigningKey: exportPublicKey(charlieKeys.signing.publicKey),
        },
      ]

      const bobLocation: LocationData = { lat: 37.7749, lng: -122.4194, timestamp: Date.now() }
      const charlieLocation: LocationData = { lat: 40.7128, lng: -74.006, timestamp: Date.now() }

      mockGetFriendLocations.mockResolvedValue([
        await v2LocationFixture({
          senderKeys: bobKeys,
          senderHandle: 'bob@other.server',
          recipientKeys: aliceKeys,
          recipientHandle: 'alice@home.server',
          location: bobLocation,
          idSuffix: '1',
        }),
        await v2LocationFixture({
          senderKeys: charlieKeys,
          senderHandle: 'charlie@third.server',
          recipientKeys: aliceKeys,
          recipientHandle: 'alice@home.server',
          location: charlieLocation,
          idSuffix: '2',
        }),
      ])

      const { fetchLocations, locations, hasLocations } = useFriendLocations()
      const result = await fetchLocations()

      expect(result).toHaveLength(2)
      expect(hasLocations.value).toBe(true)

      const bobResult = result.find((l) => l.friendHandle === 'bob@other.server')
      const charlieResult = result.find((l) => l.friendHandle === 'charlie@third.server')

      expect(bobResult?.location.lat).toBeCloseTo(bobLocation.lat, 4)
      expect(charlieResult?.location.lat).toBeCloseTo(charlieLocation.lat, 4)
    })

    test('skips friends without encryption key', async () => {
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      mockFriends.value = [
        {
          friendHandle: 'bob@other.server',
          friendEncryptionKey: null, // No key!
        },
      ]

      // Short-circuits before decryption (no encryption key), so we can
      // use any placeholder payload here.
      mockGetFriendLocations.mockResolvedValue([
        {
          id: 'loc-1',
          fromUserId: 'bob-id',
          senderHandle: 'bob@other.server',
          encryptedLocation: 'placeholder-not-decrypted',
          nonce: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])

      const { fetchLocations } = useFriendLocations()
      const result = await fetchLocations()

      expect(result).toEqual([])
    })

    test('skips unknown senders', async () => {
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      mockFriends.value = [
        {
          friendHandle: 'bob@other.server',
          friendEncryptionKey: exportPublicKey(bobKeys.encryption.publicKey),
        },
      ]

      // Location from unknown user
      mockGetFriendLocations.mockResolvedValue([
        {
          id: 'loc-1',
          fromUserId: 'unknown-id',
          senderHandle: 'unknown@server',
          encryptedLocation: 'encrypted',
          nonce: 'nonce',
          updatedAt: new Date().toISOString(),
        },
      ])

      const { fetchLocations } = useFriendLocations()
      const result = await fetchLocations()

      expect(result).toEqual([])
    })

    test('handles decryption errors gracefully', async () => {
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      mockFriends.value = [
        {
          friendHandle: 'bob@other.server',
          friendEncryptionKey: exportPublicKey(bobKeys.encryption.publicKey),
        },
      ]

      // Invalid encrypted data
      mockGetFriendLocations.mockResolvedValue([
        {
          id: 'loc-1',
          fromUserId: 'bob-id',
          senderHandle: 'bob@other.server',
          encryptedLocation: 'invalid-ciphertext',
          nonce: 'invalid-nonce',
          updatedAt: new Date().toISOString(),
        },
      ])

      const { fetchLocations, error } = useFriendLocations()
      const result = await fetchLocations()

      // Should skip the failed decryption but not throw
      expect(result).toEqual([])
      expect(error.value).toBeNull() // Individual decryption errors don't set global error
    })

    test('sets error on API failure', async () => {
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      mockGetFriendLocations.mockRejectedValue(new Error('Network error'))

      const { fetchLocations, error } = useFriendLocations()
      const result = await fetchLocations()

      expect(result).toEqual([])
      expect(error.value).toBe('Network error')
    })
  })

  describe('applyEncryptedLocation (realtime push)', () => {
    test('upserts a single decrypted location into reactive state', async () => {
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      mockFriends.value = [
        {
          friendHandle: 'bob@other.server',
          friendEncryptionKey: exportPublicKey(bobKeys.encryption.publicKey),
          friendSigningKey: exportPublicKey(bobKeys.signing.publicKey),
          friendName: 'Bob',
        },
      ]

      const bobLocation: LocationData = {
        lat: 37.7749,
        lng: -122.4194,
        timestamp: Date.now(),
      }
      const payload = await v2LocationFixture({
        senderKeys: bobKeys,
        senderHandle: 'bob@other.server',
        recipientKeys: aliceKeys,
        recipientHandle: 'alice@home.server',
        location: bobLocation,
      })

      const { applyEncryptedLocation, locations } = useFriendLocations()
      const applied = applyEncryptedLocation(payload)

      expect(applied).not.toBeNull()
      expect(applied?.friendHandle).toBe('bob@other.server')
      expect(locations.value).toHaveLength(1)
      expect(locations.value[0].location.lat).toBeCloseTo(bobLocation.lat, 4)
    })

    test('returns null when sender handle is unknown', async () => {
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey
      mockFriends.value = []

      const payload = await v2LocationFixture({
        senderKeys: bobKeys,
        senderHandle: 'bob@other.server',
        recipientKeys: aliceKeys,
        recipientHandle: 'alice@home.server',
        location: { lat: 0, lng: 0, timestamp: Date.now() },
      })

      const { applyEncryptedLocation, locations } = useFriendLocations()
      expect(applyEncryptedLocation(payload)).toBeNull()
      expect(locations.value).toHaveLength(0)
    })

    test('returns null when identity is not set up', async () => {
      mockIsSetupComplete.value = false
      mockEncryptionPrivateKey.value = null

      const payload = await v2LocationFixture({
        senderKeys: bobKeys,
        senderHandle: 'bob@other.server',
        recipientKeys: aliceKeys,
        recipientHandle: 'alice@home.server',
        location: { lat: 0, lng: 0, timestamp: Date.now() },
      })

      const { applyEncryptedLocation } = useFriendLocations()
      expect(applyEncryptedLocation(payload)).toBeNull()
    })
  })

  describe('Utility Methods', () => {
    test('getLocationForFriend returns specific location', async () => {
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      mockFriends.value = [
        {
          friendHandle: 'bob@other.server',
          friendEncryptionKey: exportPublicKey(bobKeys.encryption.publicKey),
          friendSigningKey: exportPublicKey(bobKeys.signing.publicKey),
        },
      ]

      const bobLocation: LocationData = { lat: 37.7749, lng: -122.4194, timestamp: Date.now() }

      mockGetFriendLocations.mockResolvedValue([
        await v2LocationFixture({
          senderKeys: bobKeys,
          senderHandle: 'bob@other.server',
          recipientKeys: aliceKeys,
          recipientHandle: 'alice@home.server',
          location: bobLocation,
        }),
      ])

      const { fetchLocations, getLocationForFriend } = useFriendLocations()
      await fetchLocations()

      const bobLoc = getLocationForFriend('bob@other.server')
      expect(bobLoc).toBeDefined()
      expect(bobLoc?.friendHandle).toBe('bob@other.server')
    })

    test('getLocationForFriend returns undefined for unknown friend', async () => {
      const { getLocationForFriend } = useFriendLocations()

      const loc = getLocationForFriend('unknown@server')
      expect(loc).toBeUndefined()
    })

    test('clearLocations removes all cached locations', async () => {
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      mockFriends.value = [
        {
          friendHandle: 'bob@other.server',
          friendEncryptionKey: exportPublicKey(bobKeys.encryption.publicKey),
          friendSigningKey: exportPublicKey(bobKeys.signing.publicKey),
        },
      ]

      const bobLocation: LocationData = { lat: 37.7749, lng: -122.4194, timestamp: Date.now() }

      mockGetFriendLocations.mockResolvedValue([
        await v2LocationFixture({
          senderKeys: bobKeys,
          senderHandle: 'bob@other.server',
          recipientKeys: aliceKeys,
          recipientHandle: 'alice@home.server',
          location: bobLocation,
        }),
      ])

      const { fetchLocations, clearLocations, locations, hasLocations } = useFriendLocations()
      await fetchLocations()
      expect(hasLocations.value).toBe(true)

      clearLocations()
      expect(locations.value).toEqual([])
      expect(hasLocations.value).toBe(false)
    })

    test('cleanup clears cached locations', async () => {
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      mockFriends.value = [
        {
          friendHandle: 'bob@other.server',
          friendEncryptionKey: exportPublicKey(bobKeys.encryption.publicKey),
          friendSigningKey: exportPublicKey(bobKeys.signing.publicKey),
        },
      ]

      mockGetFriendLocations.mockResolvedValue([
        await v2LocationFixture({
          senderKeys: bobKeys,
          senderHandle: 'bob@other.server',
          recipientKeys: aliceKeys,
          recipientHandle: 'alice@home.server',
          location: { lat: 1, lng: 1, timestamp: Date.now() },
        }),
      ])

      const { fetchLocations, cleanup, locations } = useFriendLocations()
      await fetchLocations()
      expect(locations.value).toHaveLength(1)

      cleanup()
      expect(locations.value).toEqual([])
    })
  })
})

