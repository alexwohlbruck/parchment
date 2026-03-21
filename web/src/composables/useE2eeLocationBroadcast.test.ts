/**
 * Unit tests for useE2eeLocationBroadcast composable
 *
 * Tests cover:
 * - Starting and stopping broadcasts
 * - Encrypting location for multiple friends
 * - Geolocation handling
 * - Error handling
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import {
  generateSeed,
  deriveAllKeys,
  exportPublicKey,
  decryptLocationFromFriend,
  importPublicKey,
} from '@/lib/federation-crypto'

// Mock the stores and services
const mockFriends = ref<any[]>([])
const mockEncryptionPrivateKey = ref<Uint8Array | null>(null)
const mockIsSetupComplete = ref(false)

vi.mock('@/stores/identity.store', () => ({
  useIdentityStore: () => ({
    encryptionPrivateKey: mockEncryptionPrivateKey,
    isSetupComplete: mockIsSetupComplete,
  }),
}))

vi.mock('@/stores/friends.store', () => ({
  useFriendsStore: () => ({
    friends: mockFriends,
  }),
}))

const mockGetE2eeConfigs = vi.fn()
const mockBroadcastLocation = vi.fn()
const mockStoreE2eeHistory = vi.fn()

vi.mock('@/services/location.service', () => ({
  useLocationService: () => ({
    getE2eeConfigs: mockGetE2eeConfigs,
    broadcastLocation: mockBroadcastLocation,
    storeE2eeHistory: mockStoreE2eeHistory,
  }),
}))

vi.mock('@/lib/key-storage', () => ({
  getSeed: vi.fn(() => Promise.resolve(null)),
}))

// Mock the geolocation service to avoid VueUse internals touching navigator.geolocation
const mockGeoIsSupported = ref(true)
const mockGeoCoords = ref({
  latitude: Infinity,
  longitude: Infinity,
  accuracy: 0,
  altitude: null,
  altitudeAccuracy: null,
  heading: null,
  speed: null,
})
const mockGeoError = ref<GeolocationPositionError | null>(null)
const mockGeoResume = vi.fn()
const mockGeoPause = vi.fn()

vi.mock('@/services/geolocation.service', () => ({
  useGeolocationService: () => ({
    isSupported: mockGeoIsSupported,
    coords: mockGeoCoords,
    error: mockGeoError,
    resume: mockGeoResume,
    pause: mockGeoPause,
  }),
}))

// Import after mocks
import { useE2eeLocationBroadcast } from './useE2eeLocationBroadcast'

describe('useE2eeLocationBroadcast', () => {
  let aliceKeys: ReturnType<typeof deriveAllKeys>
  let bobKeys: ReturnType<typeof deriveAllKeys>
  let charlieKeys: ReturnType<typeof deriveAllKeys>

  beforeEach(() => {
    // Generate test keys
    aliceKeys = deriveAllKeys(generateSeed())
    bobKeys = deriveAllKeys(generateSeed())
    charlieKeys = deriveAllKeys(generateSeed())

    // Reset mocks
    vi.clearAllMocks()
    mockFriends.value = []
    mockEncryptionPrivateKey.value = null
    mockIsSetupComplete.value = false

    mockGetE2eeConfigs.mockResolvedValue([])
    mockBroadcastLocation.mockResolvedValue({ success: true })
    mockStoreE2eeHistory.mockResolvedValue('history-id')

    // Reset geolocation service mocks
    mockGeoIsSupported.value = true
    mockGeoCoords.value = {
      latitude: Infinity,
      longitude: Infinity,
      accuracy: 0,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    }
    mockGeoError.value = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Initial State', () => {
    test('starts disabled', () => {
      const { isEnabled, isBroadcasting } = useE2eeLocationBroadcast()

      expect(isEnabled.value).toBe(false)
      expect(isBroadcasting.value).toBe(false)
    })

    test('has no initial error', () => {
      const { broadcastError } = useE2eeLocationBroadcast()

      expect(broadcastError.value).toBeNull()
    })
  })

  describe('start', () => {
    test('fails when identity not set up', async () => {
      mockIsSetupComplete.value = false

      const { start, broadcastError, isEnabled } = useE2eeLocationBroadcast()
      await start()

      expect(broadcastError.value).toBe('Identity not set up')
      expect(isEnabled.value).toBe(false)
    })

    test('loads friends with sharing enabled', async () => {
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      mockGetE2eeConfigs.mockResolvedValue([
        { friendHandle: 'bob@server', enabled: true },
        { friendHandle: 'charlie@server', enabled: false }, // Not enabled
      ])

      mockFriends.value = [
        {
          friendHandle: 'bob@server',
          friendEncryptionKey: exportPublicKey(bobKeys.encryption.publicKey),
        },
        {
          friendHandle: 'charlie@server',
          friendEncryptionKey: exportPublicKey(charlieKeys.encryption.publicKey),
        },
      ]

      const { start, friendsWithSharing } = useE2eeLocationBroadcast()
      await start()

      // Only Bob should be in the sharing list
      expect(friendsWithSharing.value).toHaveLength(1)
      expect(friendsWithSharing.value[0].friendHandle).toBe('bob@server')
    })

    test('starts geolocation watching', async () => {
      vi.useFakeTimers()
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey
      mockGetE2eeConfigs.mockResolvedValue([])

      const { start, isEnabled } = useE2eeLocationBroadcast()
      await start()

      expect(mockGeoResume).toHaveBeenCalled()
      expect(isEnabled.value).toBe(true)

      vi.useRealTimers()
    })

    test('uses custom interval', async () => {
      vi.useFakeTimers()
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      const { start, intervalMs } = useE2eeLocationBroadcast()
      await start({ intervalMs: 5000 })

      expect(intervalMs.value).toBe(5000)

      vi.useRealTimers()
    })
  })

  describe('stop', () => {
    test('stops geolocation watching', async () => {
      vi.useFakeTimers()
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      const { start, stop, isEnabled } = useE2eeLocationBroadcast()
      await start()
      expect(isEnabled.value).toBe(true)
      expect(mockGeoResume).toHaveBeenCalled()

      stop()
      expect(isEnabled.value).toBe(false)

      vi.useRealTimers()
    })
  })

  describe('loadFriendsWithSharing', () => {
    test('filters out friends without encryption key', async () => {
      mockGetE2eeConfigs.mockResolvedValue([
        { friendHandle: 'bob@server', enabled: true },
        { friendHandle: 'nokey@server', enabled: true },
      ])

      mockFriends.value = [
        {
          friendHandle: 'bob@server',
          friendEncryptionKey: exportPublicKey(bobKeys.encryption.publicKey),
        },
        {
          friendHandle: 'nokey@server',
          friendEncryptionKey: null, // No key
        },
      ]

      const { loadFriendsWithSharing, friendsWithSharing } = useE2eeLocationBroadcast()
      await loadFriendsWithSharing()

      expect(friendsWithSharing.value).toHaveLength(1)
      expect(friendsWithSharing.value[0].friendHandle).toBe('bob@server')
    })

    test('returns empty array when no friends have sharing enabled', async () => {
      mockGetE2eeConfigs.mockResolvedValue([])

      const { loadFriendsWithSharing, friendsWithSharing } = useE2eeLocationBroadcast()
      await loadFriendsWithSharing()

      expect(friendsWithSharing.value).toEqual([])
    })
  })

  describe('Encryption Integration', () => {
    test('broadcasts produce decryptable locations', async () => {
      // This test verifies the encryption format is correct
      // by checking that a broadcast location can be decrypted

      // Alice is sharing with Bob
      const alicePrivateKey = aliceKeys.encryption.privateKey
      const bobPublicKey = bobKeys.encryption.publicKey

      // Import the encryption function
      const { encryptLocationForFriend } = await import('@/lib/federation-crypto')

      // Simulate what broadcast does
      const locationData = {
        lat: 37.7749,
        lng: -122.4194,
        accuracy: 10,
        timestamp: Date.now(),
      }

      const encrypted = encryptLocationForFriend(
        locationData,
        alicePrivateKey,
        bobPublicKey,
      )

      // Bob should be able to decrypt
      const decrypted = decryptLocationFromFriend(
        encrypted.ciphertext,
        encrypted.nonce,
        bobKeys.encryption.privateKey,
        aliceKeys.encryption.publicKey,
      )

      expect(decrypted.lat).toBeCloseTo(locationData.lat, 4)
      expect(decrypted.lng).toBeCloseTo(locationData.lng, 4)
      expect(decrypted.accuracy).toBe(10)
    })

    test('encrypted data cannot be decrypted by third party', async () => {
      const { encryptLocationForFriend } = await import('@/lib/federation-crypto')

      const locationData = {
        lat: 37.7749,
        lng: -122.4194,
        timestamp: Date.now(),
      }

      // Alice encrypts for Bob
      const encrypted = encryptLocationForFriend(
        locationData,
        aliceKeys.encryption.privateKey,
        bobKeys.encryption.publicKey,
      )

      // Charlie cannot decrypt
      expect(() =>
        decryptLocationFromFriend(
          encrypted.ciphertext,
          encrypted.nonce,
          charlieKeys.encryption.privateKey,
          aliceKeys.encryption.publicKey,
        ),
      ).toThrow()
    })
  })

  describe('Geolocation Errors', () => {
    test('handles geolocation not supported', async () => {
      mockGeoIsSupported.value = false
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      const { start, broadcastError } = useE2eeLocationBroadcast()
      await start()

      expect(broadcastError.value).toBe('Geolocation not supported')
    })

    test('handles geolocation permission denied', async () => {
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      const { start, broadcastError } = useE2eeLocationBroadcast()
      await start()

      // Simulate a permission-denied error from the geolocation service
      mockGeoError.value = { code: 1, message: 'Permission denied' } as GeolocationPositionError

      // Wait for the watcher to propagate
      await nextTick()
      await nextTick()

      expect(broadcastError.value).toContain('Location error')
    })
  })

  describe('updateInterval', () => {
    test('updates the broadcast interval', async () => {
      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      vi.useFakeTimers()

      const { start, updateInterval, intervalMs } = useE2eeLocationBroadcast()
      await start({ intervalMs: 60000 })
      expect(intervalMs.value).toBe(60000)

      updateInterval(30000)
      expect(intervalMs.value).toBe(30000)

      vi.useRealTimers()
    })
  })
})

describe('Location Data Format', () => {
  test('LocationData includes all optional fields', async () => {
    const fullLocation = {
      lat: 37.7749,
      lng: -122.4194,
      accuracy: 10,
      altitude: 15,
      speed: 5.5,
      heading: 180,
      timestamp: Date.now(),
    }

    // Verify all fields can be encrypted/decrypted
    const aliceKeys = deriveAllKeys(generateSeed())
    const bobKeys = deriveAllKeys(generateSeed())

    const { encryptLocationForFriend } = await import('@/lib/federation-crypto')

    const encrypted = encryptLocationForFriend(
      fullLocation,
      aliceKeys.encryption.privateKey,
      bobKeys.encryption.publicKey,
    )

    const decrypted = decryptLocationFromFriend(
      encrypted.ciphertext,
      encrypted.nonce,
      bobKeys.encryption.privateKey,
      aliceKeys.encryption.publicKey,
    )

    expect(decrypted.lat).toBe(fullLocation.lat)
    expect(decrypted.lng).toBe(fullLocation.lng)
    expect(decrypted.accuracy).toBe(fullLocation.accuracy)
    expect(decrypted.altitude).toBe(fullLocation.altitude)
    expect(decrypted.speed).toBe(fullLocation.speed)
    expect(decrypted.heading).toBe(fullLocation.heading)
    expect(decrypted.timestamp).toBe(fullLocation.timestamp)
  })

  test('LocationData works with minimal fields', async () => {
    const minimalLocation = {
      lat: 0,
      lng: 0,
      timestamp: 0,
    }

    const aliceKeys = deriveAllKeys(generateSeed())
    const bobKeys = deriveAllKeys(generateSeed())

    const { encryptLocationForFriend } = await import('@/lib/federation-crypto')

    const encrypted = encryptLocationForFriend(
      minimalLocation,
      aliceKeys.encryption.privateKey,
      bobKeys.encryption.publicKey,
    )

    const decrypted = decryptLocationFromFriend(
      encrypted.ciphertext,
      encrypted.nonce,
      bobKeys.encryption.privateKey,
      aliceKeys.encryption.publicKey,
    )

    expect(decrypted.lat).toBe(0)
    expect(decrypted.lng).toBe(0)
    expect(decrypted.accuracy).toBeUndefined()
    expect(decrypted.altitude).toBeUndefined()
  })
})

