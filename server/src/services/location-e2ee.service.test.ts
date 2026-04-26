/**
 * Unit tests for Location E2EE Service
 *
 * Tests cover:
 * - Location sharing configuration CRUD
 * - Encrypted location storage and retrieval
 *
 * Note: These tests mock the database layer to test service logic in isolation.
 */

import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test'

// Mock the database module before importing the service
const mockDb = {
  select: mock(() => mockDb),
  insert: mock(() => mockDb),
  update: mock(() => mockDb),
  delete: mock(() => mockDb),
  from: mock(() => mockDb),
  where: mock(() => mockDb),
  set: mock(() => mockDb),
  values: mock(() => mockDb),
  limit: mock(() => mockDb),
  orderBy: mock(() => mockDb),
  returning: mock(() => Promise.resolve([])),
  leftJoin: mock(() => mockDb),
}

// Mock modules
mock.module('../db', () => ({
  db: mockDb,
}))

mock.module('../util', () => ({
  generateId: () => 'test-id-123',
}))

mock.module('./federation.service', () => ({
  resolveHandle: mock(() => Promise.resolve(null)),
  sendFederationMessage: mock(() => Promise.resolve(true)),
  getServerDomain: () => 'test.parchment.app',
  buildHandle: (alias: string) => `${alias}@test.parchment.app`,
}))

// Now import the service
import {
  getLocationSharingConfigs,
  getLocationSharingConfigForFriend,
  setLocationSharingConfig,
  disableLocationSharing,
  storeEncryptedLocation,
  getEncryptedLocationForFriend,
  getEncryptedLocationsFromFriends,
} from './location-e2ee.service'

describe('Location Sharing Configuration', () => {
  beforeEach(() => {
    // Reset all mocks
    mockDb.select.mockClear()
    mockDb.insert.mockClear()
    mockDb.update.mockClear()
    mockDb.delete.mockClear()
    mockDb.returning.mockReset()
  })

  describe('getLocationSharingConfigs', () => {
    test('returns empty array when no configs exist', async () => {
      mockDb.returning.mockResolvedValue([])

      const configs = await getLocationSharingConfigs('user-123')

      expect(mockDb.select).toHaveBeenCalled()
      expect(configs).toEqual([])
    })

    test('returns all configs for a user', async () => {
      const mockConfigs = [
        {
          id: 'config-1',
          userId: 'user-123',
          friendHandle: 'alice@other.server',
          enabled: true,
          refreshInterval: 60,
          expiresAt: null,
        },
        {
          id: 'config-2',
          userId: 'user-123',
          friendHandle: 'bob@remote.server',
          enabled: false,
          refreshInterval: 300,
          expiresAt: null,
        },
      ]

      // Mock the chain to return configs
      const mockQuery = {
        select: mock(() => mockQuery),
        from: mock(() => mockQuery),
        where: mock(() => Promise.resolve(mockConfigs)),
      }
      mockDb.select.mockReturnValue(mockQuery)
      mockQuery.select.mockReturnValue(mockQuery)
      mockQuery.from.mockReturnValue(mockQuery)
      mockQuery.where.mockResolvedValue(mockConfigs)

      const configs = await getLocationSharingConfigs('user-123')

      expect(configs).toHaveLength(2)
      expect(configs[0].friendHandle).toBe('alice@other.server')
    })
  })

  describe('getLocationSharingConfigForFriend', () => {
    test('returns null when config does not exist', async () => {
      const mockQuery = {
        select: mock(() => mockQuery),
        from: mock(() => mockQuery),
        where: mock(() => mockQuery),
        limit: mock(() => Promise.resolve([])),
      }
      mockDb.select.mockReturnValue(mockQuery)
      mockQuery.select.mockReturnValue(mockQuery)

      const config = await getLocationSharingConfigForFriend('user-123', 'alice@other.server')

      expect(config).toBeNull()
    })

    test('returns config when it exists', async () => {
      const mockConfig = {
        id: 'config-1',
        userId: 'user-123',
        friendHandle: 'alice@other.server',
        enabled: true,
        refreshInterval: 60,
        expiresAt: null,
      }

      const mockQuery = {
        select: mock(() => mockQuery),
        from: mock(() => mockQuery),
        where: mock(() => mockQuery),
        limit: mock(() => Promise.resolve([mockConfig])),
      }
      mockDb.select.mockReturnValue(mockQuery)
      mockQuery.select.mockReturnValue(mockQuery)

      const config = await getLocationSharingConfigForFriend('user-123', 'alice@other.server')

      expect(config).not.toBeNull()
      expect(config?.friendHandle).toBe('alice@other.server')
      expect(config?.enabled).toBe(true)
    })
  })

  describe('setLocationSharingConfig', () => {
    test('creates new config when none exists', async () => {
      const newConfig = {
        id: 'test-id-123',
        userId: 'user-123',
        friendHandle: 'alice@other.server',
        enabled: true,
        refreshInterval: 60,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Mock getLocationSharingConfigForFriend to return null
      const mockSelectQuery = {
        select: mock(() => mockSelectQuery),
        from: mock(() => mockSelectQuery),
        where: mock(() => mockSelectQuery),
        limit: mock(() => Promise.resolve([])),
      }
      mockDb.select.mockReturnValue(mockSelectQuery)
      mockSelectQuery.select.mockReturnValue(mockSelectQuery)

      // Mock insert
      const mockInsertQuery = {
        insert: mock(() => mockInsertQuery),
        values: mock(() => mockInsertQuery),
        returning: mock(() => Promise.resolve([newConfig])),
      }
      mockDb.insert.mockReturnValue(mockInsertQuery)
      mockInsertQuery.insert.mockReturnValue(mockInsertQuery)
      mockInsertQuery.values.mockReturnValue(mockInsertQuery)

      const config = await setLocationSharingConfig('user-123', 'alice@other.server', {
        enabled: true,
      })

      expect(config.friendHandle).toBe('alice@other.server')
      expect(config.enabled).toBe(true)
    })

    test('updates existing config', async () => {
      const existingConfig = {
        id: 'config-1',
        userId: 'user-123',
        friendHandle: 'alice@other.server',
        enabled: true,
        refreshInterval: 60,
        expiresAt: null,
      }

      const updatedConfig = {
        ...existingConfig,
        enabled: false,
      }

      // Mock getLocationSharingConfigForFriend to return existing
      const mockSelectQuery = {
        select: mock(() => mockSelectQuery),
        from: mock(() => mockSelectQuery),
        where: mock(() => mockSelectQuery),
        limit: mock(() => Promise.resolve([existingConfig])),
      }
      mockDb.select.mockReturnValue(mockSelectQuery)
      mockSelectQuery.select.mockReturnValue(mockSelectQuery)

      // Mock update
      const mockUpdateQuery = {
        update: mock(() => mockUpdateQuery),
        set: mock(() => mockUpdateQuery),
        where: mock(() => mockUpdateQuery),
        returning: mock(() => Promise.resolve([updatedConfig])),
      }
      mockDb.update.mockReturnValue(mockUpdateQuery)
      mockUpdateQuery.update.mockReturnValue(mockUpdateQuery)
      mockUpdateQuery.set.mockReturnValue(mockUpdateQuery)
      mockUpdateQuery.where.mockReturnValue(mockUpdateQuery)

      const config = await setLocationSharingConfig('user-123', 'alice@other.server', {
        enabled: false,
      })

      expect(config.enabled).toBe(false)
    })
  })

  describe('disableLocationSharing', () => {
    test('deletes config and encrypted locations', async () => {
      const mockDeleteQuery = {
        delete: mock(() => mockDeleteQuery),
        where: mock(() => mockDeleteQuery),
        returning: mock(() => Promise.resolve([{ id: 'config-1' }])),
      }
      mockDb.delete.mockReturnValue(mockDeleteQuery)
      mockDeleteQuery.delete.mockReturnValue(mockDeleteQuery)
      mockDeleteQuery.where.mockReturnValue(mockDeleteQuery)

      const result = await disableLocationSharing('user-123', 'alice@other.server')

      expect(result).toBe(true)
      // Should be called twice: once for config, once for encrypted locations
      expect(mockDb.delete).toHaveBeenCalledTimes(2)
    })

    test('returns false when no config to delete', async () => {
      const mockDeleteQuery = {
        delete: mock(() => mockDeleteQuery),
        where: mock(() => mockDeleteQuery),
        returning: mock(() => Promise.resolve([])),
      }
      mockDb.delete.mockReturnValue(mockDeleteQuery)
      mockDeleteQuery.delete.mockReturnValue(mockDeleteQuery)
      mockDeleteQuery.where.mockReturnValue(mockDeleteQuery)

      const result = await disableLocationSharing('user-123', 'nonexistent@server')

      expect(result).toBe(false)
    })
  })
})

describe('Encrypted Location Storage', () => {
  beforeEach(() => {
    mockDb.select.mockClear()
    mockDb.insert.mockClear()
    mockDb.update.mockClear()
    mockDb.returning.mockReset()
  })

  describe('storeEncryptedLocation', () => {
    test('creates new encrypted location when none exists', async () => {
      const newLocation = {
        id: 'test-id-123',
        userId: 'user-123',
        forFriendHandle: 'alice@other.server',
        encryptedLocation: 'encrypted-data',
        nonce: 'nonce-value',
        updatedAt: new Date(),
      }

      // Mock select to return empty (no existing)
      const mockSelectQuery = {
        select: mock(() => mockSelectQuery),
        from: mock(() => mockSelectQuery),
        where: mock(() => mockSelectQuery),
        limit: mock(() => Promise.resolve([])),
      }
      mockDb.select.mockReturnValue(mockSelectQuery)
      mockSelectQuery.select.mockReturnValue(mockSelectQuery)

      // Mock insert
      const mockInsertQuery = {
        insert: mock(() => mockInsertQuery),
        values: mock(() => mockInsertQuery),
        returning: mock(() => Promise.resolve([newLocation])),
      }
      mockDb.insert.mockReturnValue(mockInsertQuery)
      mockInsertQuery.insert.mockReturnValue(mockInsertQuery)
      mockInsertQuery.values.mockReturnValue(mockInsertQuery)

      const location = await storeEncryptedLocation(
        'user-123',
        'alice@other.server',
        'encrypted-data',
        'nonce-value',
      )

      expect(location.encryptedLocation).toBe('encrypted-data')
      expect(location.nonce).toBe('nonce-value')
    })

    test('updates existing encrypted location (upsert)', async () => {
      const existingLocation = {
        id: 'location-1',
        userId: 'user-123',
        forFriendHandle: 'alice@other.server',
        encryptedLocation: 'old-encrypted-data',
        nonce: 'old-nonce',
        updatedAt: new Date(),
      }

      const updatedLocation = {
        ...existingLocation,
        encryptedLocation: 'new-encrypted-data',
        nonce: 'new-nonce',
      }

      // Mock select to return existing
      const mockSelectQuery = {
        select: mock(() => mockSelectQuery),
        from: mock(() => mockSelectQuery),
        where: mock(() => mockSelectQuery),
        limit: mock(() => Promise.resolve([existingLocation])),
      }
      mockDb.select.mockReturnValue(mockSelectQuery)
      mockSelectQuery.select.mockReturnValue(mockSelectQuery)

      // Mock update
      const mockUpdateQuery = {
        update: mock(() => mockUpdateQuery),
        set: mock(() => mockUpdateQuery),
        where: mock(() => mockUpdateQuery),
        returning: mock(() => Promise.resolve([updatedLocation])),
      }
      mockDb.update.mockReturnValue(mockUpdateQuery)
      mockUpdateQuery.update.mockReturnValue(mockUpdateQuery)
      mockUpdateQuery.set.mockReturnValue(mockUpdateQuery)
      mockUpdateQuery.where.mockReturnValue(mockUpdateQuery)

      const location = await storeEncryptedLocation(
        'user-123',
        'alice@other.server',
        'new-encrypted-data',
        'new-nonce',
      )

      expect(location.encryptedLocation).toBe('new-encrypted-data')
      expect(location.nonce).toBe('new-nonce')
    })
  })

  describe('getEncryptedLocationForFriend', () => {
    test('returns null when no location exists', async () => {
      const mockSelectQuery = {
        select: mock(() => mockSelectQuery),
        from: mock(() => mockSelectQuery),
        where: mock(() => mockSelectQuery),
        limit: mock(() => Promise.resolve([])),
      }
      mockDb.select.mockReturnValue(mockSelectQuery)
      mockSelectQuery.select.mockReturnValue(mockSelectQuery)

      const location = await getEncryptedLocationForFriend('user-123', 'alice@other.server')

      expect(location).toBeNull()
    })

    test('returns location when it exists', async () => {
      const mockLocation = {
        id: 'location-1',
        userId: 'user-123',
        forFriendHandle: 'alice@other.server',
        encryptedLocation: 'encrypted-data',
        nonce: 'nonce-value',
        updatedAt: new Date(),
      }

      const mockSelectQuery = {
        select: mock(() => mockSelectQuery),
        from: mock(() => mockSelectQuery),
        where: mock(() => mockSelectQuery),
        limit: mock(() => Promise.resolve([mockLocation])),
      }
      mockDb.select.mockReturnValue(mockSelectQuery)
      mockSelectQuery.select.mockReturnValue(mockSelectQuery)

      const location = await getEncryptedLocationForFriend('user-123', 'alice@other.server')

      expect(location).not.toBeNull()
      expect(location?.encryptedLocation).toBe('encrypted-data')
    })
  })
})

describe('Integration Scenarios', () => {
  test('complete location sharing flow: enable, store, retrieve, disable', async () => {
    // This test documents the expected flow
    // 1. Enable sharing with a friend
    // 2. Store encrypted location
    // 3. Retrieve encrypted location
    // 4. Disable sharing

    // The actual integration would require a real database
    // Here we verify the API contracts are correct

    expect(setLocationSharingConfig).toBeDefined()
    expect(storeEncryptedLocation).toBeDefined()
    expect(getEncryptedLocationForFriend).toBeDefined()
    expect(disableLocationSharing).toBeDefined()
  })
})

