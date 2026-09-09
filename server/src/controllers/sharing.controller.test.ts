/**
 * Endpoint tests for the sharing controller.
 *
 * Two guards on the create path carry the weight: collection shares are gated
 * on the resharing policy (so an editor can't reshare unless the owner allows
 * it), and cross-server shares are rejected up front unless the client supplied
 * a complete signed v2 envelope — without all three parts the remote peer would
 * reject the message and we'd be left with a half-created share row.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import {
  authMockModule,
  setAuthUser,
  setHasPermission,
  resetAuth,
  TEST_USER,
} from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

const share = { id: 'share-1', role: 'viewer' }

const getOutgoingShares = mock(async (_userId: string) => [share])
const getSharesForResource = mock(
  async (_userId: string, _type: string, _id: string) => [share],
)
const createShare = mock(async (_input: any) => share)
const revokeShare = mock(async (_userId: string, _shareId: string) => true)
const updateShareEnvelope = mock(
  async (
    _userId: string,
    _handle: string,
    _type: string,
    _id: string,
    _data: string,
    _nonce: string,
  ) => share as typeof share | null,
)
const updateShareRole = mock(
  async (_userId: string, _shareId: string, _role: string) =>
    share as typeof share | null,
)
const deleteShare = mock(async (_userId: string, _shareId: string) => true)
const getIncomingShares = mock(async (_userId: string) => [share])
const getPendingIncomingShares = mock(async (_userId: string) => [share])
const acceptIncomingShare = mock(
  async (_userId: string, _shareId: string) => share as typeof share | null,
)
const rejectIncomingShare = mock(async (_userId: string, _shareId: string) => true)
const deleteIncomingShare = mock(async (_userId: string, _shareId: string) => true)

let canShare = { allowed: true }
const canShareCollection = mock(async (_userId: string, _id: string) => canShare)

let localRecipient = true
const isLocalRecipient = mock((_handle: string) => localRecipient)

mock.module('../services/sharing.service', () => ({
  getOutgoingShares,
  getSharesForResource,
  createShare,
  revokeShare,
  updateShareEnvelope,
  updateShareRole,
  deleteShare,
  getIncomingShares,
  getPendingIncomingShares,
  acceptIncomingShare,
  rejectIncomingShare,
  deleteIncomingShare,
  canShareCollection,
  isLocalRecipient,
}))

mock.module('../middleware/auth.middleware', () => authMockModule())

const sharing = (await import('./sharing.controller')).default
const app = createTestApp(sharing)

const localShare = {
  recipientHandle: 'bob@parchment.test',
  resourceType: 'collection',
  resourceId: 'col-1',
  encryptedData: 'cipher',
  nonce: 'nonce',
}

const federationEnvelope = {
  federationSignature: 'sig',
  federationNonce: 'fed-nonce',
  federationTimestamp: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  resetAuth()
  canShare = { allowed: true }
  localRecipient = true
  getOutgoingShares.mockClear()
  getSharesForResource.mockClear()
  createShare.mockClear()
  createShare.mockImplementation(async () => share)
  revokeShare.mockClear()
  revokeShare.mockImplementation(async () => true)
  updateShareEnvelope.mockClear()
  updateShareEnvelope.mockImplementation(async () => share)
  updateShareRole.mockClear()
  updateShareRole.mockImplementation(async () => share)
  deleteShare.mockClear()
  deleteShare.mockImplementation(async () => true)
  getIncomingShares.mockClear()
  getPendingIncomingShares.mockClear()
  acceptIncomingShare.mockClear()
  acceptIncomingShare.mockImplementation(async () => share)
  rejectIncomingShare.mockClear()
  rejectIncomingShare.mockImplementation(async () => true)
  deleteIncomingShare.mockClear()
  deleteIncomingShare.mockImplementation(async () => true)
  canShareCollection.mockClear()
  isLocalRecipient.mockClear()
})

describe('permission gating', () => {
  const endpoints = [
    ['get', '/sharing/outgoing'],
    ['get', '/sharing/outgoing/collection/col-1'],
    ['post', '/sharing'],
    ['post', '/sharing/share-1/revoke'],
    ['put', '/sharing/envelope'],
    ['patch', '/sharing/share-1'],
    ['delete', '/sharing/share-1'],
    ['get', '/sharing/incoming'],
    ['get', '/sharing/incoming/pending'],
    ['post', '/sharing/incoming/share-1/accept'],
    ['post', '/sharing/incoming/share-1/reject'],
    ['delete', '/sharing/incoming/share-1'],
  ] as const

  for (const [method, path] of endpoints) {
    test(`${method.toUpperCase()} ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app)[method](path, {
        body: { ...localShare, role: 'viewer' },
      })

      expect(res.status).toBe(401)
    })

    test(`${method.toUpperCase()} ${path} rejects a caller without the permission`, async () => {
      setHasPermission(false)

      const res = await req(app)[method](path, {
        body: { ...localShare, role: 'viewer' },
      })

      expect(res.status).toBe(403)
    })
  }
})

describe('GET /sharing/outgoing', () => {
  test('lists the caller’s outgoing shares', async () => {
    const res = await req(app).get('/sharing/outgoing')

    expect(res.status).toBe(200)
    expect(getOutgoingShares).toHaveBeenCalledWith(TEST_USER.id)
    expect(res.body.shares).toHaveLength(1)
  })

  test('filters by resource', async () => {
    const res = await req(app).get('/sharing/outgoing/collection/col-1')

    expect(res.status).toBe(200)
    expect(getSharesForResource).toHaveBeenCalledWith(
      TEST_USER.id,
      'collection',
      'col-1',
    )
  })
})

describe('POST /sharing — collection resharing policy', () => {
  test('creates the share when the caller may share the collection', async () => {
    const res = await req(app).post('/sharing', { body: localShare })

    expect(res.status).toBe(200)
    expect(canShareCollection).toHaveBeenCalledWith(TEST_USER.id, 'col-1')
    expect(createShare).toHaveBeenCalled()
  })

  test('403s when the resharing policy forbids it', async () => {
    canShare = { allowed: false }

    const res = await req(app).post('/sharing', { body: localShare })

    expect(res.status).toBe(403)
    expect(createShare).not.toHaveBeenCalled()
  })

  test('skips the policy check for non-collection resources', async () => {
    const res = await req(app).post('/sharing', {
      body: { ...localShare, resourceType: 'route', resourceId: 'route-1' },
    })

    expect(res.status).toBe(200)
    expect(canShareCollection).not.toHaveBeenCalled()
  })
})

describe('POST /sharing — cross-server envelope requirement', () => {
  test('same-server shares may omit the federation envelope', async () => {
    localRecipient = true

    const res = await req(app).post('/sharing', { body: localShare })

    expect(res.status).toBe(200)
  })

  test('cross-server shares succeed with a complete envelope', async () => {
    localRecipient = false

    const res = await req(app).post('/sharing', {
      body: { ...localShare, recipientHandle: 'bob@peer.test', ...federationEnvelope },
    })

    expect(res.status).toBe(200)
    expect(createShare.mock.calls[0][0]).toMatchObject(federationEnvelope)
  })

  for (const missing of [
    'federationSignature',
    'federationNonce',
    'federationTimestamp',
  ] as const) {
    test(`cross-server shares 400 when ${missing} is absent`, async () => {
      localRecipient = false
      const envelope: Record<string, string> = { ...federationEnvelope }
      delete envelope[missing]

      const res = await req(app).post('/sharing', {
        body: { ...localShare, recipientHandle: 'bob@peer.test', ...envelope },
      })

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('Cross-server shares require')
      // No half-created row.
      expect(createShare).not.toHaveBeenCalled()
    })
  }
})

describe('POST /sharing — payload handling', () => {
  test('defaults the role to viewer', async () => {
    await req(app).post('/sharing', { body: localShare })

    expect(createShare.mock.calls[0][0]).toMatchObject({ role: 'viewer' })
  })

  test('honours an explicit editor role', async () => {
    await req(app).post('/sharing', { body: { ...localShare, role: 'editor' } })

    expect(createShare.mock.calls[0][0]).toMatchObject({ role: 'editor' })
  })

  test('attributes the share to the session user', async () => {
    await req(app).post('/sharing', {
      body: { ...localShare, userId: 'someone-else' } as any,
    })

    expect(createShare.mock.calls[0][0].userId).toBe(TEST_USER.id)
  })

  test('422s on an unknown resource type', async () => {
    const res = await req(app).post('/sharing', {
      body: { ...localShare, resourceType: 'spreadsheet' },
    })

    expect(res.status).toBe(422)
    expect(createShare).not.toHaveBeenCalled()
  })

  test('422s on an unknown role', async () => {
    const res = await req(app).post('/sharing', {
      body: { ...localShare, role: 'admin' },
    })

    expect(res.status).toBe(422)
  })

  test('422s without a recipient handle', async () => {
    const { recipientHandle, ...rest } = localShare

    const res = await req(app).post('/sharing', { body: rest })

    expect(res.status).toBe(422)
  })
})

describe('outgoing share mutations', () => {
  test('revoke succeeds', async () => {
    const res = await req(app).post('/sharing/share-1/revoke')

    expect(res.status).toBe(200)
    expect(revokeShare).toHaveBeenCalledWith(TEST_USER.id, 'share-1')
  })

  test('revoke 404s for a share the caller does not own', async () => {
    revokeShare.mockResolvedValueOnce(false)

    const res = await req(app).post('/sharing/other/revoke')

    expect(res.status).toBe(404)
  })

  test('envelope replacement passes every field through', async () => {
    const res = await req(app).put('/sharing/envelope', {
      body: {
        recipientHandle: 'bob@parchment.test',
        resourceType: 'collection',
        resourceId: 'col-1',
        encryptedData: 'new-cipher',
        nonce: 'new-nonce',
      },
    })

    expect(res.status).toBe(200)
    expect(updateShareEnvelope).toHaveBeenCalledWith(
      TEST_USER.id,
      'bob@parchment.test',
      'collection',
      'col-1',
      'new-cipher',
      'new-nonce',
    )
  })

  test('envelope replacement 404s when no share matches', async () => {
    updateShareEnvelope.mockResolvedValueOnce(null)

    const res = await req(app).put('/sharing/envelope', {
      body: {
        recipientHandle: 'bob@parchment.test',
        resourceType: 'collection',
        resourceId: 'col-1',
        encryptedData: 'c',
        nonce: 'n',
      },
    })

    expect(res.status).toBe(404)
  })

  test('envelope replacement 422s without encryptedData', async () => {
    const res = await req(app).put('/sharing/envelope', {
      body: {
        recipientHandle: 'bob@parchment.test',
        resourceType: 'collection',
        resourceId: 'col-1',
        nonce: 'n',
      },
    })

    expect(res.status).toBe(422)
  })

  test('role update switches viewer to editor in place', async () => {
    const res = await req(app).patch('/sharing/share-1', { body: { role: 'editor' } })

    expect(res.status).toBe(200)
    expect(updateShareRole).toHaveBeenCalledWith(TEST_USER.id, 'share-1', 'editor')
  })

  test('role update 404s for an unknown share', async () => {
    updateShareRole.mockResolvedValueOnce(null)

    const res = await req(app).patch('/sharing/missing', { body: { role: 'viewer' } })

    expect(res.status).toBe(404)
  })

  test('role update 422s on an unknown role', async () => {
    const res = await req(app).patch('/sharing/share-1', { body: { role: 'owner' } })

    expect(res.status).toBe(422)
    expect(updateShareRole).not.toHaveBeenCalled()
  })

  test('delete removes the share', async () => {
    const res = await req(app).delete('/sharing/share-1')

    expect(res.status).toBe(200)
    expect(deleteShare).toHaveBeenCalledWith(TEST_USER.id, 'share-1')
  })

  test('delete 404s when nothing matched', async () => {
    deleteShare.mockResolvedValueOnce(false)

    const res = await req(app).delete('/sharing/missing')

    expect(res.status).toBe(404)
  })
})

describe('incoming shares', () => {
  test('lists all incoming shares', async () => {
    const res = await req(app).get('/sharing/incoming')

    expect(res.status).toBe(200)
    expect(getIncomingShares).toHaveBeenCalledWith(TEST_USER.id)
  })

  test('lists pending incoming shares', async () => {
    const res = await req(app).get('/sharing/incoming/pending')

    expect(res.status).toBe(200)
    expect(getPendingIncomingShares).toHaveBeenCalledWith(TEST_USER.id)
  })

  test('pending is not shadowed by the /incoming/:shareId routes', async () => {
    await req(app).get('/sharing/incoming/pending')

    expect(getPendingIncomingShares).toHaveBeenCalled()
    expect(acceptIncomingShare).not.toHaveBeenCalled()
  })

  test('accept returns the accepted share', async () => {
    const res = await req(app).post('/sharing/incoming/share-1/accept')

    expect(res.status).toBe(200)
    expect(acceptIncomingShare).toHaveBeenCalledWith(TEST_USER.id, 'share-1')
  })

  test('accept 404s when the share is not addressed to the caller', async () => {
    acceptIncomingShare.mockResolvedValueOnce(null)

    const res = await req(app).post('/sharing/incoming/other/accept')

    expect(res.status).toBe(404)
  })

  test('reject succeeds', async () => {
    const res = await req(app).post('/sharing/incoming/share-1/reject')

    expect(res.status).toBe(200)
    expect(rejectIncomingShare).toHaveBeenCalledWith(TEST_USER.id, 'share-1')
  })

  test('reject 404s for an unknown share', async () => {
    rejectIncomingShare.mockResolvedValueOnce(false)

    const res = await req(app).post('/sharing/incoming/missing/reject')

    expect(res.status).toBe(404)
  })

  test('delete removes the incoming share', async () => {
    const res = await req(app).delete('/sharing/incoming/share-1')

    expect(res.status).toBe(200)
    expect(deleteIncomingShare).toHaveBeenCalledWith(TEST_USER.id, 'share-1')
  })

  test('delete 404s for an unknown share', async () => {
    deleteIncomingShare.mockResolvedValueOnce(false)

    const res = await req(app).delete('/sharing/incoming/missing')

    expect(res.status).toBe(404)
  })
})
