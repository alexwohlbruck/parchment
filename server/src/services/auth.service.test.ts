import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { hasPermission } from './auth.service'
import { PermissionId } from '../types/auth.types'

// hasPermission is a pure function — no DB needed, test directly.

describe('hasPermission', () => {
  const userPerms: string[] = [
    PermissionId.LIBRARY_READ,
    PermissionId.LIBRARY_WRITE,
    PermissionId.PREMIUM_DATA_PROVIDERS,
  ]

  test('string rule — returns true when user has the permission', () => {
    expect(hasPermission(userPerms, PermissionId.LIBRARY_READ)).toBe(true)
  })

  test('string rule — returns false when user lacks the permission', () => {
    expect(hasPermission(userPerms, PermissionId.ROLES_WRITE)).toBe(false)
  })

  test('{ all } rule — true when user has every listed permission', () => {
    expect(
      hasPermission(userPerms, {
        all: [PermissionId.LIBRARY_READ, PermissionId.LIBRARY_WRITE],
      }),
    ).toBe(true)
  })

  test('{ all } rule — false when user is missing one', () => {
    expect(
      hasPermission(userPerms, {
        all: [PermissionId.LIBRARY_READ, PermissionId.ROLES_WRITE],
      }),
    ).toBe(false)
  })

  test('{ any } rule — true when user has at least one', () => {
    expect(
      hasPermission(userPerms, {
        any: [PermissionId.ROLES_WRITE, PermissionId.LIBRARY_READ],
      }),
    ).toBe(true)
  })

  test('{ any } rule — false when user has none', () => {
    expect(
      hasPermission(userPerms, {
        any: [PermissionId.ROLES_WRITE, PermissionId.SYSTEM_READ],
      }),
    ).toBe(false)
  })

  test('empty permissions array always returns false', () => {
    expect(hasPermission([], PermissionId.LIBRARY_READ)).toBe(false)
    expect(hasPermission([], { any: [PermissionId.LIBRARY_READ] })).toBe(false)
  })
})

// getPermissions with isSelfHosted override tested via DB integration tests.
// We verify the override path separately because it reads from DB.

describe('getPermissions (self-hosted override)', () => {
  test('returns all permissions when isSelfHosted is true', async () => {
    const allPermIds = [
      'places:read',
      'places:write',
      'premium:data_providers',
      'premium:layers',
      'admin:settings',
    ]

    mock.module('../config', () => ({
      appName: 'Parchment',
      origins: { clientHostname: 'localhost', clientOrigin: 'http://localhost:5173', serverOrigin: 'http://localhost:5000' },
      isSelfHosted: true,
      billing: { enabled: false },
      registrationMode: 'invite',
    }))

    mock.module('../db', () => ({
      db: {
        select: () => ({
          from: () => allPermIds.map((id) => ({ id })),
        }),
      },
    }))

    // Force re-import to pick up mocked config
    const auth = await import('./auth.service')
    const result = await auth.getPermissions('any-user-id')
    expect(result).toEqual(allPermIds)
  })
})
