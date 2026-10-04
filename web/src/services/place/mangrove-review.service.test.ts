import { describe, test, expect, vi, beforeEach } from 'vitest'

const blobs = vi.hoisted(() => new Map<string, unknown>())
const mangrove = vi.hoisted(() => ({
  generateKeypair: vi.fn(async () => ({ publicKey: 'pub', privateKey: 'priv' })),
  keypairToJwk: vi.fn(async () => ({ kty: 'EC' })),
  jwkToKeypair: vi.fn(async () => ({ publicKey: 'pub', privateKey: 'priv' })),
  publicToPem: vi.fn(async () => 'PEM'),
  getReviews: vi.fn(),
  signAndSubmitReview: vi.fn(async () => true),
  editReview: vi.fn(async () => true),
}))

vi.mock('@/lib/identity/personal-blob', () => ({
  loadBlob: vi.fn(async (type: string, userId: string) =>
    blobs.get(`${userId}:${type}`) ?? null,
  ),
  saveBlob: vi.fn(async (type: string, userId: string, value: unknown) => {
    blobs.set(`${userId}:${type}`, value)
  }),
}))
vi.mock('mangrove-reviews', () => mangrove)

const SUB = 'geo:1,2?q=Cafe&u=50'
let service: typeof import('./mangrove-review.service')
let user = 0

beforeEach(async () => {
  vi.clearAllMocks()
  user += 1
  service = await import('./mangrove-review.service')
})

const input = { rating: 80, opinion: ' Lovely ', nickname: ' ana ', osmId: 'node/1' }

describe('saveReview', () => {
  test('creates a key on first review and reuses it after', async () => {
    const userId = `u${user}`
    await service.saveReview(userId, SUB, input, null)
    await service.saveReview(userId, SUB, input, null)

    expect(mangrove.generateKeypair).toHaveBeenCalledTimes(1)
    expect(blobs.get(`${userId}:mangrove-reviewer`)).toEqual({
      jwk: { kty: 'EC' },
      nickname: 'ana',
    })
  })

  test('submits a new review with trimmed text and Parchment as the client', async () => {
    await service.saveReview(`u${user}`, SUB, input, null)

    expect(mangrove.signAndSubmitReview).toHaveBeenCalledWith(expect.anything(), {
      sub: SUB,
      rating: 80,
      opinion: 'Lovely',
      metadata: {
        client_id: 'https://parchment.app',
        nickname: 'ana',
        osm_id: 'node/1',
      },
    })
  })

  test('edits the original review when one exists', async () => {
    const existing = { signature: 'orig', rating: 40, opinion: 'Meh' }
    await service.saveReview(`u${user}`, SUB, input, existing)

    expect(mangrove.editReview).toHaveBeenCalledWith(
      expect.anything(),
      'orig',
      expect.objectContaining({ rating: 80, opinion: 'Lovely' }),
    )
    expect(mangrove.signAndSubmitReview).not.toHaveBeenCalled()
  })
})

describe('deleteOwnReview', () => {
  test('deletes the original review without exposing the page URL', async () => {
    const userId = `u${user}`
    await service.saveReview(userId, SUB, input, null)
    await service.deleteOwnReview(userId, 'orig')

    expect(mangrove.signAndSubmitReview).toHaveBeenLastCalledWith(expect.anything(), {
      sub: 'urn:maresi:orig',
      action: 'delete',
      metadata: { client_id: 'https://parchment.app' },
    })
  })
})

describe('fetchOwnReview', () => {
  test('is null before the user has ever reviewed', async () => {
    expect(await service.fetchOwnReview(`u${user}`, SUB)).toBeNull()
    expect(mangrove.getReviews).not.toHaveBeenCalled()
  })

  test('returns the latest edit, keyed by the review it edits', async () => {
    const userId = `u${user}`
    await service.saveReview(userId, SUB, input, null)
    mangrove.getReviews.mockResolvedValue({
      reviews: [
        {
          signature: 'edit-sig',
          payload: {
            sub: 'urn:maresi:orig-sig',
            action: 'edit',
            rating: 60,
            opinion: 'Better now',
            metadata: { nickname: 'ana' },
          },
        },
      ],
    })

    expect(await service.fetchOwnReview(userId, SUB)).toEqual({
      signature: 'orig-sig',
      rating: 60,
      opinion: 'Better now',
      nickname: 'ana',
    })
    expect(mangrove.getReviews).toHaveBeenCalledWith({ sub: SUB, kid: 'PEM' })
  })
})
