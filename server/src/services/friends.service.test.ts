/**
 * Unit tests for the friends service.
 *
 * The guards on `sendFriendInvitation` are ordered deliberately and each one
 * short-circuits before the next: no alias → no self-invite → not already
 * friends → no duplicate pending invite → recipient must resolve. Getting the
 * order wrong would leak the existence of a handle to someone who hasn't even
 * set an alias, or let duplicate invitations pile up.
 *
 * `getFriends` re-reads local friends' names and pictures from the users table
 * on every call rather than trusting the denormalized copy on the friendship
 * row, so a profile edit shows up for friends immediately.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../test/db-mock'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))
mock.module('../util', () => ({ generateId: () => 'generated-id' }))

let userHandle: string | null = 'alice@parchment.test'
const getUserHandle = mock(async (_userId: string) => userHandle)
const getUserIdentity = mock(async (_userId: string) => ({
  handle: 'alice@parchment.test',
  signingKey: 'alice-signing',
  encryptionKey: 'alice-encryption',
}))
mock.module('./user.service', () => ({ getUserHandle, getUserIdentity }))

let resolved: any = {
  handle: 'bob@peer.test',
  signingKey: 'bob-signing',
  encryptionKey: 'bob-encryption',
  name: 'Bob',
  picture: 'https://pic.test/b.png',
  inbox: 'https://peer.test/federation/inbox',
}
const resolveHandle = mock(async (_handle: string) => resolved)
const sendFederationMessage = mock(async (..._args: unknown[]) => true)

mock.module('./federation.service', () => ({
  resolveHandle,
  sendFederationMessage,
  getServerDomain: () => 'parchment.test',
  isLocalHandle: (handle: string) => handle.endsWith('@parchment.test'),
  buildHandle: (alias: string) => `${alias}@parchment.test`,
}))

mock.module('../lib/crypto', () => ({
  parseHandle: (handle: string) => {
    const match = /^([^@]+)@(.+)$/.exec(handle)
    return match ? { alias: match[1], domain: match[2] } : null
  },
}))

mock.module('./location-e2ee.service', () => ({
  disableLocationSharing: mock(async () => true),
  purgeLocationStateForPeer: mock(async () => undefined),
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

mock.module('./realtime/emit', () => ({
  emit: {
    friend: mock(async () => undefined),
    friendship: mock(async () => undefined),
    userProfile: mock(async () => undefined),
  },
}))

const {
  sendFriendInvitation,
  getFriends,
  getInvitations,
  updateFriendKeys,
  isFriend,
} = await import('./friends.service')

beforeEach(() => {
  dbMock.reset()
  userHandle = 'alice@parchment.test'
  resolved = {
    handle: 'bob@peer.test',
    signingKey: 'bob-signing',
    encryptionKey: 'bob-encryption',
    name: 'Bob',
    picture: 'https://pic.test/b.png',
    inbox: 'https://peer.test/federation/inbox',
  }
  getUserHandle.mockClear()
  resolveHandle.mockClear()
  resolveHandle.mockImplementation(async () => resolved)
  sendFederationMessage.mockClear()
})

describe('sendFriendInvitation — guards', () => {
  test('requires the sender to have an alias first', async () => {
    userHandle = null

    const result = await sendFriendInvitation('user-1', 'bob@peer.test', 'sig')

    expect(result.success).toBe(false)
    expect(result.error).toContain('must set an alias')
    // Nothing is looked up before the alias check.
    expect(dbMock.selectCount).toBe(0)
  })

  test('refuses a self-invitation', async () => {
    const result = await sendFriendInvitation(
      'user-1',
      'alice@parchment.test',
      'sig',
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('to yourself')
    expect(dbMock.selectCount).toBe(0)
  })

  test('refuses when a friendship already exists', async () => {
    dbMock.queueSelect([{ id: 'f-1' }])

    const result = await sendFriendInvitation('user-1', 'bob@peer.test', 'sig')

    expect(result.error).toBe('You are already friends with this user')
    expect(dbMock.insertCount).toBe(0)
  })

  test('refuses a duplicate pending invitation', async () => {
    dbMock.queueSelect([]) // no friendship
    dbMock.queueSelect([{ id: 'inv-1' }]) // pending invite exists

    const result = await sendFriendInvitation('user-1', 'bob@peer.test', 'sig')

    expect(result.error).toBe('Invitation already sent')
    expect(dbMock.insertCount).toBe(0)
  })

  test('refuses when the recipient cannot be resolved', async () => {
    dbMock.queueSelect([])
    dbMock.queueSelect([])
    resolved = null

    const result = await sendFriendInvitation('user-1', 'ghost@peer.test', 'sig')

    expect(result.error).toBe('Could not find user')
    expect(dbMock.insertCount).toBe(0)
  })

  test('checks the friendship before resolving the handle', async () => {
    // Otherwise an already-friended handle would still trigger a network call.
    dbMock.queueSelect([{ id: 'f-1' }])

    await sendFriendInvitation('user-1', 'bob@peer.test', 'sig')

    expect(resolveHandle).not.toHaveBeenCalled()
  })
})

describe('sendFriendInvitation — local recipient', () => {
  test('records an outgoing invitation for the sender', async () => {
    resolved = { handle: 'carol@parchment.test', signingKey: 'k' }
    dbMock.queueSelect([]) // friendship
    dbMock.queueSelect([]) // pending invite
    dbMock.queueSelect([{ id: 'carol-user-id' }]) // local recipient
    dbMock.setReturningRows([{ id: 'generated-id' }])

    const result = await sendFriendInvitation(
      'user-1',
      'carol@parchment.test',
      'sig',
    )

    expect(result.success).toBe(true)
    expect(dbMock.inserted[0]).toMatchObject({
      fromHandle: 'alice@parchment.test',
      toHandle: 'carol@parchment.test',
      localUserId: 'user-1',
      direction: 'outgoing',
      status: 'pending',
    })
  })

  test('fails when the local recipient row is missing', async () => {
    resolved = { handle: 'carol@parchment.test', signingKey: 'k' }
    dbMock.queueSelect([])
    dbMock.queueSelect([])
    dbMock.queueSelect([]) // no such local user

    const result = await sendFriendInvitation(
      'user-1',
      'carol@parchment.test',
      'sig',
    )

    expect(result.error).toBe('User not found')
    expect(dbMock.insertCount).toBe(0)
  })

  test('does not federate a local invitation', async () => {
    resolved = { handle: 'carol@parchment.test', signingKey: 'k' }
    dbMock.queueSelect([])
    dbMock.queueSelect([])
    dbMock.queueSelect([{ id: 'carol-user-id' }])
    dbMock.setReturningRows([{ id: 'generated-id' }])

    await sendFriendInvitation('user-1', 'carol@parchment.test', 'sig')

    expect(sendFederationMessage).not.toHaveBeenCalled()
  })
})

describe('getFriends', () => {
  test('returns accepted friendships', async () => {
    dbMock.queueSelect([
      { userId: 'user-1', friendHandle: 'bob@peer.test', status: 'accepted' },
    ])

    expect(await getFriends('user-1')).toHaveLength(1)
  })

  test('refreshes a local friend’s name from the users table', async () => {
    // The denormalized copy on the friendship row can be stale after a rename.
    dbMock.queueSelect([
      { userId: 'user-1', friendHandle: 'carol@parchment.test', friendName: 'Old Name' },
    ])
    dbMock.queueSelect([
      { firstName: 'Carol', lastName: 'Jones', picture: 'https://pic.test/c.png' },
    ])

    const [friend] = await getFriends('user-1')

    expect(friend.friendName).toBe('Carol Jones')
    expect(friend.friendPicture).toBe('https://pic.test/c.png')
  })

  test('falls back to the first name alone', async () => {
    dbMock.queueSelect([
      { userId: 'user-1', friendHandle: 'carol@parchment.test' },
    ])
    dbMock.queueSelect([{ firstName: 'Carol', lastName: null, picture: null }])

    expect((await getFriends('user-1'))[0].friendName).toBe('Carol')
  })

  test('falls back to the alias when the local user has no name', async () => {
    dbMock.queueSelect([
      { userId: 'user-1', friendHandle: 'carol@parchment.test' },
    ])
    dbMock.queueSelect([{ firstName: null, lastName: null, picture: null }])

    expect((await getFriends('user-1'))[0].friendName).toBe('carol')
  })

  test('leaves a remote friend’s stored profile untouched', async () => {
    dbMock.queueSelect([
      { userId: 'user-1', friendHandle: 'bob@peer.test', friendName: 'Bob' },
    ])

    const [friend] = await getFriends('user-1')

    expect(friend.friendName).toBe('Bob')
    // No second lookup for a remote handle.
    expect(dbMock.selectCount).toBe(1)
  })

  test('keeps the row when the local user row has vanished', async () => {
    dbMock.queueSelect([
      { userId: 'user-1', friendHandle: 'carol@parchment.test', friendName: 'Carol' },
    ])
    dbMock.queueSelect([])

    expect(await getFriends('user-1')).toHaveLength(1)
  })
})

describe('getInvitations', () => {
  test('returns pending invitations in both directions by default', async () => {
    dbMock.queueSelect([{ id: 'inv-1' }, { id: 'inv-2' }])

    expect(await getInvitations('user-1')).toHaveLength(2)
  })

  test('accepts a direction filter', async () => {
    dbMock.queueSelect([{ id: 'inv-1', direction: 'incoming' }])

    expect(await getInvitations('user-1', 'incoming' as any)).toHaveLength(1)
  })
})

describe('updateFriendKeys', () => {
  test('writes keys and profile onto the friendship row', async () => {
    dbMock.setReturningRows([{ id: 'f-1' }])

    const updated = await updateFriendKeys('user-1', 'bob@peer.test', {
      signingKey: 'new-signing',
      encryptionKey: 'new-encryption',
      name: 'Bob B',
      picture: 'https://pic.test/new.png',
    })

    expect(updated).toBe(true)
    expect(dbMock.updated[0]).toMatchObject({
      friendSigningKey: 'new-signing',
      friendEncryptionKey: 'new-encryption',
      friendName: 'Bob B',
      friendPicture: 'https://pic.test/new.png',
    })
  })

  test('reports false when no friendship matched', async () => {
    dbMock.setReturningRows([])

    expect(
      await updateFriendKeys('user-1', 'stranger@peer.test', {}),
    ).toBe(false)
  })
})

describe('isFriend', () => {
  test('is true for an accepted friendship', async () => {
    dbMock.queueSelect([{ id: 'f-1', status: 'accepted' }])

    expect(await isFriend('user-1', 'bob@peer.test')).toBe(true)
  })

  test('is false when no accepted row exists', async () => {
    // The query filters on status, so a pending invite never counts.
    dbMock.queueSelect([])

    expect(await isFriend('user-1', 'bob@peer.test')).toBe(false)
  })
})
