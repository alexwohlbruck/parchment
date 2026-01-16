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
  encryptLocationForFriend,
  exportPublicKey,
  type LocationData,
} from '@/lib/federation-crypto'

// Mock the stores and services
const mockFriends = ref<any[]>([])
const mockEncryptionPrivateKey = ref<Uint8Array | null>(null)
const mockIsSetupComplete = ref(false)

vi.mock('@/stores/friends.store', () => ({
  useFriendsStore: () => ({
    friends: mockFriends,
  }),
}))

vi.mock('@/stores/identity.store', () => ({
  useIdentityStore: () => ({
    encryptionPrivateKey: mockEncryptionPrivateKey,
    isSetupComplete: mockIsSetupComplete,
  }),
}))

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

    test('starts not polling', () => {
      const { isPolling } = useFriendLocations()

      expect(isPolling.value).toBe(false)
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
      const encrypted = encryptLocationForFriend(
        bobLocation,
        bobKeys.encryption.privateKey,
        aliceKeys.encryption.publicKey,
      )

      // Mock API response
      mockGetFriendLocations.mockResolvedValue([
        {
          id: 'loc-1',
          fromUserId: 'bob-user-id',
          senderHandle: 'bob@other.server',
          encryptedLocation: encrypted.ciphertext,
          nonce: encrypted.nonce,
          updatedAt: new Date().toISOString(),
        },
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
        },
        {
          friendHandle: 'charlie@third.server',
          friendEncryptionKey: exportPublicKey(charlieKeys.encryption.publicKey),
        },
      ]

      // Each friend encrypts their location
      const bobLocation: LocationData = { lat: 37.7749, lng: -122.4194, timestamp: Date.now() }
      const charlieLocation: LocationData = { lat: 40.7128, lng: -74.006, timestamp: Date.now() }

      const bobEncrypted = encryptLocationForFriend(
        bobLocation,
        bobKeys.encryption.privateKey,
        aliceKeys.encryption.publicKey,
      )
      const charlieEncrypted = encryptLocationForFriend(
        charlieLocation,
        charlieKeys.encryption.privateKey,
        aliceKeys.encryption.publicKey,
      )

      mockGetFriendLocations.mockResolvedValue([
        {
          id: 'loc-1',
          fromUserId: 'bob-id',
          senderHandle: 'bob@other.server',
          encryptedLocation: bobEncrypted.ciphertext,
          nonce: bobEncrypted.nonce,
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'loc-2',
          fromUserId: 'charlie-id',
          senderHandle: 'charlie@third.server',
          encryptedLocation: charlieEncrypted.ciphertext,
          nonce: charlieEncrypted.nonce,
          updatedAt: new Date().toISOString(),
        },
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

      const bobLocation: LocationData = { lat: 37.7749, lng: -122.4194, timestamp: Date.now() }
      const encrypted = encryptLocationForFriend(
        bobLocation,
        bobKeys.encryption.privateKey,
        aliceKeys.encryption.publicKey,
      )

      mockGetFriendLocations.mockResolvedValue([
        {
          id: 'loc-1',
          fromUserId: 'bob-id',
          senderHandle: 'bob@other.server',
          encryptedLocation: encrypted.ciphertext,
          nonce: encrypted.nonce,
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

  describe('Polling', () => {
    test('startPolling sets isPolling to true', () => {
      vi.useFakeTimers()
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey
      mockGetFriendLocations.mockResolvedValue([])

      const { startPolling, isPolling } = useFriendLocations()

      startPolling(30000)

      expect(isPolling.value).toBe(true)

      vi.useRealTimers()
    })

    test('stopPolling sets isPolling to false', () => {
      vi.useFakeTimers()
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey
      mockGetFriendLocations.mockResolvedValue([])

      const { startPolling, stopPolling, isPolling } = useFriendLocations()

      startPolling(30000)
      expect(isPolling.value).toBe(true)

      stopPolling()
      expect(isPolling.value).toBe(false)

      vi.useRealTimers()
    })

    test('polling fetches at intervals', async () => {
      vi.useFakeTimers()
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey
      mockGetFriendLocations.mockResolvedValue([])

      const { startPolling, stopPolling } = useFriendLocations()

      startPolling(1000) // 1 second interval

      // Initial fetch
      await vi.advanceTimersByTimeAsync(0)
      expect(mockGetFriendLocations).toHaveBeenCalledTimes(1)

      // After 1 second
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockGetFriendLocations).toHaveBeenCalledTimes(2)

      // After another second
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockGetFriendLocations).toHaveBeenCalledTimes(3)

      stopPolling()
      vi.useRealTimers()
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
        },
      ]

      const bobLocation: LocationData = { lat: 37.7749, lng: -122.4194, timestamp: Date.now() }
      const encrypted = encryptLocationForFriend(
        bobLocation,
        bobKeys.encryption.privateKey,
        aliceKeys.encryption.publicKey,
      )

      mockGetFriendLocations.mockResolvedValue([
        {
          id: 'loc-1',
          fromUserId: 'bob-id',
          senderHandle: 'bob@other.server',
          encryptedLocation: encrypted.ciphertext,
          nonce: encrypted.nonce,
          updatedAt: new Date().toISOString(),
        },
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
        },
      ]

      const bobLocation: LocationData = { lat: 37.7749, lng: -122.4194, timestamp: Date.now() }
      const encrypted = encryptLocationForFriend(
        bobLocation,
        bobKeys.encryption.privateKey,
        aliceKeys.encryption.publicKey,
      )

      mockGetFriendLocations.mockResolvedValue([
        {
          id: 'loc-1',
          fromUserId: 'bob-id',
          senderHandle: 'bob@other.server',
          encryptedLocation: encrypted.ciphertext,
          nonce: encrypted.nonce,
          updatedAt: new Date().toISOString(),
        },
      ])

      const { fetchLocations, clearLocations, locations, hasLocations } = useFriendLocations()
      await fetchLocations()
      expect(hasLocations.value).toBe(true)

      clearLocations()
      expect(locations.value).toEqual([])
      expect(hasLocations.value).toBe(false)
    })

    test('cleanup stops polling and clears locations', async () => {
      vi.useFakeTimers()
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey
      mockGetFriendLocations.mockResolvedValue([])

      const { startPolling, cleanup, isPolling, locations } = useFriendLocations()

      startPolling(1000)
      expect(isPolling.value).toBe(true)

      cleanup()
      expect(isPolling.value).toBe(false)
      expect(locations.value).toEqual([])

      vi.useRealTimers()
    })
  })
})

