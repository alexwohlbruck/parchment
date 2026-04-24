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
import { ref, computed, nextTick } from 'vue'
import {
  generateSeed,
  deriveAllKeys,
  exportPublicKey,
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
const mockUpdateLocation = vi.fn()

vi.mock('@/services/location.service', () => ({
  useLocationService: () => ({
    getE2eeConfigs: mockGetE2eeConfigs,
    updateLocation: mockUpdateLocation,
  }),
}))

// Mock geolocation service
const mockCoords = ref({
  latitude: Infinity,
  longitude: Infinity,
  accuracy: 0,
  altitude: null as number | null,
  altitudeAccuracy: null as number | null,
  heading: null as number | null,
  speed: null as number | null,
})
const mockGeoError = ref<GeolocationPositionError | null>(null)
const mockIsSupported = ref(true)
const mockResume = vi.fn()
const mockPause = vi.fn()

vi.mock('@/services/geolocation.service', () => ({
  useGeolocationService: () => ({
    coords: mockCoords,
    error: mockGeoError,
    isSupported: mockIsSupported,
    resume: mockResume,
    pause: mockPause,
    permissionState: ref('granted'),
    hasLocation: computed(() => mockCoords.value.latitude !== Infinity),
    lngLat: computed(() =>
      mockCoords.value.latitude !== Infinity
        ? { lng: mockCoords.value.longitude, lat: mockCoords.value.latitude }
        : null,
    ),
    accuracy: computed(() =>
      mockCoords.value.latitude !== Infinity ? mockCoords.value.accuracy : null,
    ),
    heading: computed(() => mockCoords.value.heading),
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
    mockUpdateLocation.mockResolvedValue({ success: true })

    // Reset geolocation mock state
    mockIsSupported.value = true
    mockGeoError.value = null
    mockCoords.value = {
      latitude: Infinity,
      longitude: Infinity,
      accuracy: 0,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    }
    // When resume is called, simulate getting a position
    mockResume.mockImplementation(() => {
      mockCoords.value = {
        latitude: 37.7749,
        longitude: -122.4194,
        accuracy: 10,
        altitude: 15,
        altitudeAccuracy: null,
        heading: 180,
        speed: 5,
      }
    })
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

      expect(mockResume).toHaveBeenCalled()
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

  // Encryption integration tests for broadcast live in
  // federation-crypto-ecies.test.ts, which covers the v2 ECIES path that
  // actually ships.

  describe('Geolocation Errors', () => {
    test('handles geolocation not supported', async () => {
      mockIsSupported.value = false

      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      const { start, broadcastError } = useE2eeLocationBroadcast()
      await start()

      expect(broadcastError.value).toBe('Geolocation not supported')

      // Restore
      mockIsSupported.value = true
    })

    test('handles geolocation permission denied', async () => {
      mockResume.mockImplementation(() => {
        mockGeoError.value = { code: 1, message: 'Permission denied' } as GeolocationPositionError
      })

      mockIsSetupComplete.value = true
      mockEncryptionPrivateKey.value = aliceKeys.encryption.privateKey

      const { start, broadcastError } = useE2eeLocationBroadcast()
      await start()

      // Wait for error to propagate
      await nextTick()
      await nextTick()

      // Composable starts but coords remain at Infinity so no broadcast occurs
      // broadcastError is not set for geolocation errors (only for 'not supported' or broadcast failures)
      expect(mockResume).toHaveBeenCalled()
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

// Location data format is a pure shape type now (no v1 encrypt/decrypt
// behavior to exercise). Keeping a single round-trip assertion would
// duplicate the v2 ECIES tests in federation-crypto-ecies.test.ts, so
// this describe block was removed rather than ported.

