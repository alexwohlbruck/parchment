/**
 * Unit tests for the user service.
 *
 * The bootstrap rule is the one worth guarding: the very first account on an
 * instance becomes admin, everyone after gets 'user'. Getting that backwards
 * either locks the operator out or hands admin to every signup.
 *
 * Alias uniqueness has a deliberate carve-out — a user re-submitting their own
 * alias must not be told it's taken — and the display-profile update uses
 * `in` rather than a truthiness check so `null` clears a field instead of
 * being ignored.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../test/db-mock'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))
mock.module('../util', () => ({ generateId: () => 'new-user-id' }))
mock.module('./federation.service', () => ({
  buildHandle: (alias: string) => `${alias}@parchment.test`,
}))

const emitUserProfile = mock(async (..._args: unknown[]) => undefined)
mock.module('./realtime/emit', () => ({
  emit: { userProfile: emitUserProfile },
}))

const {
  fetchUser,
  fetchUserByEmail,
  getUserHandle,
  updateUserAlias,
  updateUserKeys,
  updateUserDisplayProfile,
  getUserIdentity,
  getLocalUserIdByAlias,
  hasUsers,
  createOpenRegistrationUser,
} = await import('./user.service')

beforeEach(() => {
  dbMock.reset()
  emitUserProfile.mockClear()
})

describe('lookup', () => {
  test('fetchUser returns the row', async () => {
    dbMock.queueSelect([{ id: 'user-1', email: 'a@b.test' }])

    expect((await fetchUser('user-1')).id).toBe('user-1')
  })

  test('fetchUser returns undefined when missing', async () => {
    dbMock.queueSelect([])

    expect(await fetchUser('ghost')).toBeUndefined()
  })

  test('fetchUserByEmail returns the row', async () => {
    dbMock.queueSelect([{ id: 'user-1', email: 'a@b.test' }])

    expect((await fetchUserByEmail('A@B.test')).id).toBe('user-1')
  })

  test('getLocalUserIdByAlias returns the id', async () => {
    dbMock.queueSelect([{ id: 'user-1' }])

    expect(await getLocalUserIdByAlias('alice')).toBe('user-1')
  })

  test('getLocalUserIdByAlias returns null for an unknown alias', async () => {
    dbMock.queueSelect([])

    expect(await getLocalUserIdByAlias('nobody')).toBeNull()
  })
})

describe('getUserHandle', () => {
  test('builds the federation handle from the alias', async () => {
    dbMock.queueSelect([{ alias: 'alice' }])

    expect(await getUserHandle('user-1')).toBe('alice@parchment.test')
  })

  test('returns null when the user has no alias yet', async () => {
    dbMock.queueSelect([{ alias: null }])

    expect(await getUserHandle('user-1')).toBeNull()
  })

  test('returns null when the user does not exist', async () => {
    dbMock.queueSelect([])

    expect(await getUserHandle('ghost')).toBeNull()
  })
})

describe('updateUserAlias', () => {
  test('accepts a free alias and writes it', async () => {
    dbMock.queueSelect([])

    expect(await updateUserAlias('user-1', 'alice')).toEqual({ success: true })
    expect(dbMock.updated[0]).toMatchObject({ alias: 'alice' })
  })

  test('rejects an alias held by someone else', async () => {
    dbMock.queueSelect([{ id: 'other-user' }])

    expect(await updateUserAlias('user-1', 'alice')).toEqual({
      success: false,
      error: 'Alias is already taken',
    })
    expect(dbMock.updateCount).toBe(0)
  })

  test('allows re-submitting the caller’s own alias', async () => {
    dbMock.queueSelect([{ id: 'user-1' }])

    expect(await updateUserAlias('user-1', 'alice')).toEqual({ success: true })
  })

  test('broadcasts the profile change', async () => {
    dbMock.queueSelect([])

    await updateUserAlias('user-1', 'alice')

    expect(emitUserProfile).toHaveBeenCalledWith(
      'user:profile-updated',
      { id: 'user-1', alias: 'alice' },
      'user-1',
    )
  })

  test('does not broadcast when the alias was rejected', async () => {
    dbMock.queueSelect([{ id: 'other-user' }])

    await updateUserAlias('user-1', 'alice')

    expect(emitUserProfile).not.toHaveBeenCalled()
  })
})

describe('updateUserKeys', () => {
  test('stores both keys with a timestamp', async () => {
    await updateUserKeys('user-1', 'sig', 'enc')

    expect(dbMock.updated[0]).toMatchObject({
      signingKey: 'sig',
      encryptionKey: 'enc',
    })
    expect((dbMock.updated[0] as any).updatedAt).toBeInstanceOf(Date)
  })
})

describe('updateUserDisplayProfile', () => {
  test('writes only the fields that were passed', async () => {
    await updateUserDisplayProfile('user-1', { firstName: 'Ada' })

    const written = dbMock.updated[0] as any
    expect(written.firstName).toBe('Ada')
    expect('lastName' in written).toBe(false)
    expect('picture' in written).toBe(false)
  })

  test('an explicit null clears the field', async () => {
    // Uses `in` rather than truthiness, so null is a value not an omission.
    await updateUserDisplayProfile('user-1', { picture: null })

    expect('picture' in (dbMock.updated[0] as any)).toBe(true)
    expect((dbMock.updated[0] as any).picture).toBeNull()
  })

  test('broadcasts the changed fields', async () => {
    await updateUserDisplayProfile('user-1', { firstName: 'Ada' })

    expect(emitUserProfile).toHaveBeenCalledWith(
      'user:profile-updated',
      { id: 'user-1', firstName: 'Ada' },
      'user-1',
    )
  })

  test('an empty patch still stamps updatedAt', async () => {
    await updateUserDisplayProfile('user-1', {})

    expect((dbMock.updated[0] as any).updatedAt).toBeInstanceOf(Date)
  })
})

describe('getUserIdentity', () => {
  test('returns the handle and public keys', async () => {
    dbMock.queueSelect([
      { alias: 'alice', signingKey: 'sig', encryptionKey: 'enc' },
    ])

    expect(await getUserIdentity('user-1')).toEqual({
      handle: 'alice@parchment.test',
      signingKey: 'sig',
      encryptionKey: 'enc',
    })
  })

  test('reports a null handle before an alias is set', async () => {
    dbMock.queueSelect([{ alias: null, signingKey: null, encryptionKey: null }])

    expect((await getUserIdentity('user-1'))!.handle).toBeNull()
  })

  test('returns null when the user does not exist', async () => {
    dbMock.queueSelect([])

    expect(await getUserIdentity('ghost')).toBeNull()
  })
})

describe('hasUsers', () => {
  test('is false on an empty instance', async () => {
    dbMock.queueSelect([{ total: 0 }])

    expect(await hasUsers()).toBe(false)
  })

  test('is true once any user exists', async () => {
    dbMock.queueSelect([{ total: 5 }])

    expect(await hasUsers()).toBe(true)
  })
})

describe('createOpenRegistrationUser', () => {
  test('makes the very first account an admin', async () => {
    dbMock.queueSelect([{ total: 0 }])
    dbMock.setReturningRows([{ id: 'new-user-id', email: 'founder@test' }])

    await createOpenRegistrationUser('founder@test')

    expect(dbMock.inserted[1]).toEqual({
      userId: 'new-user-id',
      roleId: 'admin',
    })
  })

  test('gives every later account the plain user role', async () => {
    dbMock.queueSelect([{ total: 3 }])
    dbMock.setReturningRows([{ id: 'new-user-id', email: 'newcomer@test' }])

    await createOpenRegistrationUser('newcomer@test')

    expect(dbMock.inserted[1]).toEqual({
      userId: 'new-user-id',
      roleId: 'user',
    })
  })

  test('inserts the user row with the supplied email', async () => {
    dbMock.queueSelect([{ total: 1 }])
    dbMock.setReturningRows([{ id: 'new-user-id', email: 'a@b.test' }])

    await createOpenRegistrationUser('a@b.test')

    expect(dbMock.inserted[0]).toEqual({ id: 'new-user-id', email: 'a@b.test' })
  })

  test('creates the user and role assignment in one transaction', async () => {
    // A user row with no role would be unusable and invisible to the admin UI.
    let usedTransaction = false
    const realTransaction = dbMock.db.transaction
    dbMock.db.transaction = async (fn: any) => {
      usedTransaction = true
      return realTransaction(fn)
    }
    dbMock.queueSelect([{ total: 1 }])
    dbMock.setReturningRows([{ id: 'new-user-id' }])

    try {
      await createOpenRegistrationUser('a@b.test')
    } finally {
      dbMock.db.transaction = realTransaction
    }

    expect(usedTransaction).toBe(true)
  })
})
