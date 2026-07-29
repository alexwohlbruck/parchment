/**
 * Unit tests for the realtime emit helpers.
 *
 * Each helper pairs one event with one recipient resolver, and the pairing is
 * the whole point: emitting a collection event through the bookmark resolver
 * would deliver it to the wrong set of users — a privacy failure, not just a
 * missed update. Every helper is asserted against the resolver it must use and
 * the argument it must pass through.
 *
 * `bookmarkAcrossCollections` exists because delete paths run after the row is
 * gone, so recipients have to be resolved from the collection ids the caller
 * already holds rather than re-read from the bookmark.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'

const publish = mock((event: string, payload: unknown, recipients: unknown) => ({
  id: 'evt-1',
  event,
  payload,
  recipients,
  timestamp: '2026-01-01T00:00:00.000Z',
}))

/** Every resolver, each returning a recipient set tagged with its own name. */
const resolvers = {
  resolveCollectionRecipients: mock(async (id: string) => ({
    localUserIds: [`collection:${id}`],
    remoteHandles: [],
  })),
  resolveBookmarkRecipients: mock(async (id: string) => ({
    localUserIds: [`bookmark:${id}`],
    remoteHandles: [],
  })),
  resolveRecipientsForCollections: mock(async (ids: string[]) => ({
    localUserIds: [`collections:${ids.join(',')}`],
    remoteHandles: [],
  })),
  resolveFriendshipRecipients: mock(async (userId: string, partner: any) => ({
    localUserIds: [userId, partner.userId ?? partner.handle],
    remoteHandles: [],
  })),
  resolveUserProfileRecipients: mock(async (id: string) => ({
    localUserIds: [`profile:${id}`],
    remoteHandles: [],
  })),
  resolvePublicLinkRecipients: mock(async (id: string) => ({
    localUserIds: [`link:${id}`],
    remoteHandles: [],
  })),
  resolveHandleRecipient: mock(async (handle: string) => ({
    localUserIds: [],
    remoteHandles: [handle],
  })),
}

mock.module('./event-bus.service', () => ({ publish }))
mock.module('./recipients.service', () => resolvers)

const { emit } = await import('./emit')

beforeEach(() => {
  publish.mockClear()
  for (const resolver of Object.values(resolvers)) resolver.mockClear()
})

/** The (event, payload, recipients) triple of the single publish call. */
const published = () => publish.mock.calls[0]

describe('collection', () => {
  test('resolves recipients from the collection', async () => {
    await emit.collection('collection:updated', { id: 'c-1' }, 'c-1')

    expect(resolvers.resolveCollectionRecipients).toHaveBeenCalledWith('c-1')
    expect(published()).toEqual([
      'collection:updated',
      { id: 'c-1' },
      { localUserIds: ['collection:c-1'], remoteHandles: [] },
    ])
  })

  test('returns the published event', async () => {
    const event = await emit.collection('collection:updated', {}, 'c-1')

    expect(event).toMatchObject({ id: 'evt-1', event: 'collection:updated' })
  })
})

describe('bookmark', () => {
  test('resolves recipients from the bookmark', async () => {
    await emit.bookmark('bookmark:updated', { id: 'b-1' }, 'b-1')

    expect(resolvers.resolveBookmarkRecipients).toHaveBeenCalledWith('b-1')
    expect(published()[2]).toEqual({
      localUserIds: ['bookmark:b-1'],
      remoteHandles: [],
    })
  })

  test('does not consult the collection resolver', async () => {
    await emit.bookmark('bookmark:updated', {}, 'b-1')

    expect(resolvers.resolveCollectionRecipients).not.toHaveBeenCalled()
  })
})

describe('bookmarkAcrossCollections', () => {
  test('resolves from the collection ids the caller already holds', async () => {
    // Delete paths run after the bookmark row is gone.
    await emit.bookmarkAcrossCollections('bookmark:deleted', { id: 'b-1' }, [
      'c-1',
      'c-2',
    ])

    expect(resolvers.resolveRecipientsForCollections).toHaveBeenCalledWith([
      'c-1',
      'c-2',
    ])
    expect(resolvers.resolveBookmarkRecipients).not.toHaveBeenCalled()
  })

  test('still publishes for an empty collection list', async () => {
    await emit.bookmarkAcrossCollections('bookmark:deleted', {}, [])

    expect(publish).toHaveBeenCalledTimes(1)
  })
})

describe('friendship', () => {
  test('passes both sides of the relationship to the resolver', async () => {
    await emit.friendship('friend:accepted', {}, 'u-1', { userId: 'u-2' })

    expect(resolvers.resolveFriendshipRecipients).toHaveBeenCalledWith('u-1', {
      userId: 'u-2',
    })
    expect(published()[2].localUserIds).toEqual(['u-1', 'u-2'])
  })

  test('supports a remote partner identified by handle', async () => {
    await emit.friendship('friend:accepted', {}, 'u-1', {
      handle: 'someone@peer.test',
    })

    expect(published()[2].localUserIds).toEqual(['u-1', 'someone@peer.test'])
  })
})

describe('userProfile', () => {
  test('resolves the user and their friends', async () => {
    await emit.userProfile('user:updated', { alias: 'alex' }, 'u-1')

    expect(resolvers.resolveUserProfileRecipients).toHaveBeenCalledWith('u-1')
    expect(published()[0]).toBe('user:updated')
  })
})

describe('publicLink', () => {
  test('resolves the owner only', async () => {
    await emit.publicLink('link:created', {}, 'c-1')

    expect(resolvers.resolvePublicLinkRecipients).toHaveBeenCalledWith('c-1')
    expect(resolvers.resolveCollectionRecipients).not.toHaveBeenCalled()
  })
})

describe('encryptedLocation', () => {
  test('resolves the handle the location was stored for', async () => {
    await emit.encryptedLocation('location:new', {}, 'friend@peer.test')

    expect(resolvers.resolveHandleRecipient).toHaveBeenCalledWith(
      'friend@peer.test',
    )
    expect(published()[2]).toEqual({
      localUserIds: [],
      remoteHandles: ['friend@peer.test'],
    })
  })
})

describe('the helper set', () => {
  test('covers every resolver exactly once', () => {
    // A new resolver without a matching emitter would force call sites back to
    // raw publish() and the wrong recipient set.
    expect(Object.keys(emit).sort()).toEqual([
      'bookmark',
      'bookmarkAcrossCollections',
      'collection',
      'encryptedLocation',
      'friendship',
      'publicLink',
      'userProfile',
    ])
  })
})
