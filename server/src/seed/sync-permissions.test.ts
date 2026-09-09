import { describe, test, expect } from 'bun:test'
import { permissions } from './permissions'
import { roles } from './roles'
import { PermissionId } from '../types/auth.types'

/**
 * Seed data integrity tests.
 *
 * These validate the permission and role definitions that
 * syncPermissionsAndRoles() writes to the DB on startup.
 * No database required — we test the source data directly.
 */

describe('permission seed definitions', () => {
  test('every permission has a unique ID', () => {
    const ids = permissions.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every permission has a non-empty name', () => {
    for (const perm of permissions) {
      expect(perm.name.length).toBeGreaterThan(0)
    }
  })

  test('every permission ID matches a PermissionId enum value', () => {
    const enumValues = new Set(Object.values(PermissionId))
    for (const perm of permissions) {
      expect(enumValues.has(perm.id)).toBe(true)
    }
  })

  test('every PermissionId enum value has a seed definition', () => {
    const seedIds = new Set(permissions.map(p => p.id))
    for (const enumVal of Object.values(PermissionId)) {
      expect(seedIds.has(enumVal)).toBe(true)
    }
  })
})

describe('role seed definitions', () => {
  test('every role has a unique ID', () => {
    const ids = roles.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('admin role uses wildcard permissions', () => {
    const admin = roles.find(r => r.id === 'admin')
    expect(admin).toBeDefined()
    expect(admin!.permissions).toBe('*')
  })

  test('non-admin roles reference only valid permission IDs', () => {
    const validIds = new Set(permissions.map(p => p.id))
    for (const role of roles) {
      if (role.permissions === '*') continue
      for (const permId of role.permissions) {
        expect(validIds.has(permId)).toBe(true)
      }
    }
  })

  test('required default roles exist', () => {
    const ids = new Set(roles.map(r => r.id))
    expect(ids.has('user')).toBe(true)
    expect(ids.has('basic')).toBe(true)
    expect(ids.has('premium')).toBe(true)
    expect(ids.has('admin')).toBe(true)
  })

  test('premium role includes all basic role permissions', () => {
    const basic = roles.find(r => r.id === 'basic')!
    const premium = roles.find(r => r.id === 'premium')!
    const premiumPerms = new Set(premium.permissions as string[])
    for (const perm of basic.permissions as string[]) {
      expect(premiumPerms.has(perm)).toBe(true)
    }
  })
})
