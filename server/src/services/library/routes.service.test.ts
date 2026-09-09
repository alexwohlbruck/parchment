/**
 * Unit tests for the custom-routes service.
 *
 * Two rules matter most. Public links are server-key only — the server has no
 * key for a user-e2ee route, so it could not render what it was sharing — and
 * minting is idempotent, so re-clicking "share" doesn't silently rotate a link
 * a user already sent someone. Token resolution re-checks the scheme on read,
 * so a route migrated to e2ee stops resolving even if a stale token survives.
 *
 * `updateRoute` also has to spread only defined keys, or a partial update
 * would null out everything the caller omitted.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../../test/db-mock'

const dbMock = createDbMock()
mock.module('../../db', () => ({ db: dbMock.db }))
mock.module('../../util', () => ({ generateId: () => 'new-route-id' }))

const {
  getRoutes,
  getRouteById,
  createRoute,
  updateRoute,
  deleteRoute,
  createPublicLink,
  revokePublicLink,
  getPublicRouteByToken,
  PublicLinkNotAllowedOnE2eeError,
} = await import('./routes.service')

const route = (over: Partial<any> = {}) => ({
  id: 'route-1',
  userId: 'user-1',
  mode: 'cycling',
  scheme: 'server-key',
  isPublic: false,
  publicToken: null,
  publicRole: null,
  ...over,
})

beforeEach(() => {
  dbMock.reset()
})

describe('reads', () => {
  test('getRoutes returns the user’s routes', async () => {
    dbMock.queueSelect([route(), route({ id: 'route-2' })])

    expect(await getRoutes('user-1')).toHaveLength(2)
  })

  test('getRouteById returns undefined when not the caller’s', async () => {
    dbMock.queueSelect([])

    expect(await getRouteById('route-1', 'other-user')).toBeUndefined()
  })
})

describe('createRoute', () => {
  test('defaults mode to walking, scheme to server-key, private', async () => {
    dbMock.setReturningRows([route()])

    await createRoute({ userId: 'user-1' })

    expect(dbMock.inserted[0]).toEqual({
      id: 'new-route-id',
      userId: 'user-1',
      mode: 'walking',
      scheme: 'server-key',
      isPublic: false,
    })
  })

  test('honours explicit mode and scheme', async () => {
    dbMock.setReturningRows([route()])

    await createRoute({
      userId: 'user-1',
      mode: 'driving',
      scheme: 'user-e2ee',
      isPublic: true,
    })

    expect(dbMock.inserted[0]).toMatchObject({
      mode: 'driving',
      scheme: 'user-e2ee',
      isPublic: true,
    })
  })
})

describe('updateRoute', () => {
  test('writes only the keys that were supplied', async () => {
    dbMock.setReturningRows([route()])

    await updateRoute('route-1', 'user-1', { mode: 'driving' })

    const written = dbMock.updated[0] as any
    expect(written.mode).toBe('driving')
    expect('distance' in written).toBe(false)
    expect('bodyEncrypted' in written).toBe(false)
  })

  test('preserves explicit nulls — clearing is distinct from omitting', async () => {
    dbMock.setReturningRows([route()])

    await updateRoute('route-1', 'user-1', { distance: null, duration: null })

    expect(dbMock.updated[0]).toMatchObject({ distance: null, duration: null })
  })

  test('drops undefined values so a partial patch cannot null a field', async () => {
    dbMock.setReturningRows([route()])

    await updateRoute('route-1', 'user-1', {
      mode: 'walking',
      distance: undefined,
    })

    expect('distance' in (dbMock.updated[0] as any)).toBe(false)
  })

  test('always stamps updatedAt', async () => {
    dbMock.setReturningRows([route()])

    await updateRoute('route-1', 'user-1', {})

    expect((dbMock.updated[0] as any).updatedAt).toBeInstanceOf(Date)
  })

  test('returns undefined when no row matched', async () => {
    dbMock.setReturningRows([])

    expect(
      await updateRoute('route-1', 'other-user', { mode: 'walking' }),
    ).toBeUndefined()
  })
})

describe('deleteRoute', () => {
  test('reports true when a row was removed', async () => {
    dbMock.setReturningRows([{ id: 'route-1' }])

    expect(await deleteRoute('route-1', 'user-1')).toBe(true)
  })

  test('reports false when nothing matched', async () => {
    dbMock.setReturningRows([])

    expect(await deleteRoute('route-1', 'other-user')).toBe(false)
  })
})

describe('createPublicLink', () => {
  test('mints a token for a server-key route', async () => {
    dbMock.queueSelect([route()])
    dbMock.setReturningRows([route({ publicToken: 'tok' })])

    const result = await createPublicLink('route-1', 'user-1')

    expect(result!.publicRole).toBe('viewer')
    expect(result!.publicToken).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test('marks the route public and viewer-only', async () => {
    dbMock.queueSelect([route()])
    dbMock.setReturningRows([route({ publicToken: 'tok' })])

    await createPublicLink('route-1', 'user-1')

    expect(dbMock.updated[0]).toMatchObject({
      publicRole: 'viewer',
      isPublic: true,
    })
  })

  test('is idempotent — an existing token is returned unchanged', async () => {
    // Re-clicking "share" must not rotate a link the user already sent.
    dbMock.queueSelect([route({ publicToken: 'existing-token' })])

    const result = await createPublicLink('route-1', 'user-1')

    expect(result).toEqual({ publicToken: 'existing-token', publicRole: 'viewer' })
    expect(dbMock.updateCount).toBe(0)
  })

  test('refuses a user-e2ee route', async () => {
    dbMock.queueSelect([route({ scheme: 'user-e2ee' })])

    await expect(createPublicLink('route-1', 'user-1')).rejects.toBeInstanceOf(
      PublicLinkNotAllowedOnE2eeError,
    )
    expect(dbMock.updateCount).toBe(0)
  })

  test('returns null for a route the caller does not own', async () => {
    dbMock.queueSelect([])

    expect(await createPublicLink('route-1', 'other-user')).toBeNull()
  })

  test('returns null when the update matched nothing', async () => {
    dbMock.queueSelect([route()])
    dbMock.setReturningRows([])

    expect(await createPublicLink('route-1', 'user-1')).toBeNull()
  })

  test('the token carries 32 bytes of entropy', async () => {
    dbMock.queueSelect([route()])
    dbMock.setReturningRows([route({ publicToken: 'tok' })])

    const result = await createPublicLink('route-1', 'user-1')

    // The token is the only access control on a public link.
    expect(result!.publicToken).toHaveLength(43)
  })
})

describe('revokePublicLink', () => {
  test('clears the token, role and public flag', async () => {
    dbMock.setReturningRows([route()])

    expect(await revokePublicLink('route-1', 'user-1')).toBe(true)
    expect(dbMock.updated[0]).toMatchObject({
      publicToken: null,
      publicRole: null,
      isPublic: false,
    })
  })

  test('reports false when nothing matched', async () => {
    dbMock.setReturningRows([])

    expect(await revokePublicLink('route-1', 'other-user')).toBe(false)
  })
})

describe('getPublicRouteByToken', () => {
  test('resolves a server-key route', async () => {
    dbMock.queueSelect([route({ publicToken: 'tok' })])

    expect((await getPublicRouteByToken('tok'))!.id).toBe('route-1')
  })

  test('returns null for an unknown token', async () => {
    dbMock.queueSelect([])

    expect(await getPublicRouteByToken('nope')).toBeNull()
  })

  test('refuses to resolve a route that migrated to user-e2ee', async () => {
    // The scheme is re-checked on read, so a stale token can't expose a route
    // the server can no longer decrypt.
    dbMock.queueSelect([route({ publicToken: 'tok', scheme: 'user-e2ee' })])

    expect(await getPublicRouteByToken('tok')).toBeNull()
  })
})
