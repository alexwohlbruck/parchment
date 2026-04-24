/**
 * Tests for the client sharing service — pure helpers (buildPublicLinkUrl)
 * and mocked-axios HTTP contract tests (createShare/revoke/updateShareRole)
 * so regressions in URL shape or request body are caught before the server
 * sees the bad request.
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest'
import { buildPublicLinkUrl } from './sharing.service'

describe('buildPublicLinkUrl', () => {
  test('joins server URL + token at /public/collections/', () => {
    const url = buildPublicLinkUrl(
      'https://parchment.app',
      'abc123_token',
    )
    expect(url).toBe('https://parchment.app/public/collections/abc123_token')
  })

  test('strips trailing slash on the server URL', () => {
    // Important: concatenation would produce a double slash otherwise,
    // which some CDNs + browsers normalize inconsistently.
    const url = buildPublicLinkUrl(
      'https://parchment.app/',
      'tok',
    )
    expect(url).toBe('https://parchment.app/public/collections/tok')
  })

  test('works for localhost dev URLs', () => {
    const url = buildPublicLinkUrl('http://localhost:5000', 'dev_tok')
    expect(url).toBe('http://localhost:5000/public/collections/dev_tok')
  })
})

// ===========================================================================
// HTTP contract tests: verify method + URL + body shape without hitting a
// real server. Catches breakage where we rename a path or drop a field.
// ===========================================================================

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
  },
}))

import { api } from '@/lib/api'
import {
  listSharesForResource,
  createShare,
  revokeShare,
  deleteShare,
  updateShareRole,
  createPublicLink,
  revokePublicLink,
} from './sharing.service'

describe('sharing.service HTTP contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Provide a default no-op reply so each helper resolves.
    ;(api.get as any).mockResolvedValue({ data: { shares: [] } })
    ;(api.post as any).mockResolvedValue({
      data: { id: 'srv-id', publicToken: 'tok', publicRole: 'viewer' },
    })
    ;(api.patch as any).mockResolvedValue({ data: { id: 'srv-id' } })
    ;(api.delete as any).mockResolvedValue({ data: undefined })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('listSharesForResource GETs the right URL', async () => {
    await listSharesForResource('collection', 'coll-123')
    expect(api.get).toHaveBeenCalledWith(
      '/sharing/outgoing/collection/coll-123',
    )
  })

  test('createShare POSTs the full payload including federation envelope', async () => {
    await createShare({
      recipientHandle: 'bob@peer.test',
      resourceType: 'collection',
      resourceId: 'coll-1',
      role: 'editor',
      encryptedData: 'ct==',
      nonce: 'n==',
      federationSignature: 'sig==',
      federationNonce: 'fn==',
      federationTimestamp: '2026-04-24T00:00:00.000Z',
    })
    expect(api.post).toHaveBeenCalledWith(
      '/sharing',
      expect.objectContaining({
        recipientHandle: 'bob@peer.test',
        role: 'editor',
        federationSignature: 'sig==',
        federationNonce: 'fn==',
        federationTimestamp: '2026-04-24T00:00:00.000Z',
      }),
    )
  })

  test('revokeShare POSTs to /revoke (not DELETE)', async () => {
    // Preserves idempotent-revoke semantics vs hard-delete.
    await revokeShare('share-42')
    expect(api.post).toHaveBeenCalledWith('/sharing/share-42/revoke')
    expect(api.delete).not.toHaveBeenCalled()
  })

  test('deleteShare DELETEs the share resource', async () => {
    await deleteShare('share-42')
    expect(api.delete).toHaveBeenCalledWith('/sharing/share-42')
  })

  test('updateShareRole PATCHes with the new role', async () => {
    await updateShareRole('share-42', 'editor')
    expect(api.patch).toHaveBeenCalledWith('/sharing/share-42', {
      role: 'editor',
    })
  })

  test('createPublicLink POSTs to collection public-link endpoint', async () => {
    await createPublicLink('coll-1')
    expect(api.post).toHaveBeenCalledWith(
      '/library/collections/coll-1/public-link',
    )
  })

  test('revokePublicLink DELETEs to collection public-link endpoint', async () => {
    await revokePublicLink('coll-1')
    expect(api.delete).toHaveBeenCalledWith(
      '/library/collections/coll-1/public-link',
    )
  })
})
