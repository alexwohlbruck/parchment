import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  deleteOwnReview,
  fetchOwnReview,
  saveReview,
  signIn,
  SignInCancelledError,
  type MangroveSession,
} from './mangrove-review.service'

const signer = vi.hoisted(() => ({
  loginUrl: vi.fn(() => 'https://signer.example/auth/login'),
  getAccount: vi.fn(async () => ({
    public_key: 'PEM',
    did: 'did:plc:abc',
    account_name: 'Ana',
  })),
  signAndSubmitReview: vi.fn(async () => ({})),
  editReview: vi.fn(async () => ({})),
  deleteReview: vi.fn(async () => ({})),
}))
const reviewer = vi.hoisted(() => ({ getReviews: vi.fn() }))

vi.mock('mangrove-reviews/signer', () => signer)
vi.mock('mangrove-reviews', () => reviewer)

const SUB = 'geo:1,2?q=Cafe&u=50'
const session: MangroveSession = {
  token: 'tok',
  reviewerId: 'r1',
  publicKey: 'PEM',
  expiresAt: Date.now() + 60_000,
}
const input = { rating: 80, opinion: ' Lovely ', nickname: ' ana ', osmId: 'node/1' }

beforeEach(() => vi.clearAllMocks())

describe('saveReview', () => {
  test('signs a new review through the signer with Parchment as the client', async () => {
    await saveReview(session, SUB, input, null)

    expect(signer.signAndSubmitReview).toHaveBeenCalledWith('tok', {
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
    await saveReview(session, SUB, input, { signature: 'orig', rating: 40, opinion: '' })

    expect(signer.editReview).toHaveBeenCalledWith(
      'tok',
      'orig',
      expect.objectContaining({ rating: 80, opinion: 'Lovely' }),
    )
    expect(signer.signAndSubmitReview).not.toHaveBeenCalled()
  })
})

test('deleteOwnReview deletes by the original signature', async () => {
  await deleteOwnReview(session, 'orig')
  expect(signer.deleteReview).toHaveBeenCalledWith('tok', 'orig')
})

describe('fetchOwnReview', () => {
  const edit = {
    signature: 'edit-sig',
    payload: {
      sub: 'urn:maresi:orig-sig',
      action: 'edit',
      rating: 60,
      opinion: 'Better now',
      metadata: { nickname: 'ana' },
    },
  }

  test('returns the latest edit, keyed by the review it edits', async () => {
    reviewer.getReviews.mockResolvedValue({ reviews: [edit] })

    expect(await fetchOwnReview(session, SUB)).toEqual({
      signature: 'orig-sig',
      rating: 60,
      opinion: 'Better now',
      nickname: 'ana',
    })
  })

  test('looks up every key of the identity when there is one', async () => {
    reviewer.getReviews.mockResolvedValue({ reviews: [] })

    await fetchOwnReview({ publicKey: 'PEM', did: 'did:plc:abc' }, SUB)
    expect(reviewer.getReviews).toHaveBeenLastCalledWith({ sub: SUB, did: 'did:plc:abc' })

    await fetchOwnReview({ publicKey: 'PEM' }, SUB)
    expect(reviewer.getReviews).toHaveBeenLastCalledWith({ sub: SUB, kid: 'PEM' })
  })
})

describe('signIn', () => {
  let popup: { location: { href: string }; close: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    popup = { location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
  })
  afterEach(() => vi.restoreAllMocks())

  function callback(state: string | null, extra: Record<string, unknown> = {}) {
    const channel = new BroadcastChannel('mangrove-signer')
    channel.postMessage({
      type: 'mangrove-signer-callback',
      state,
      sessionToken: 'tok',
      reviewerId: 'r1',
      did: null,
      ...extra,
    })
    channel.close()
  }

  const stateOf = () =>
    (signer.loginUrl.mock.calls.at(-1) as unknown as unknown[])[4] as string

  test('opens the popup synchronously, then resolves with the account', async () => {
    const pending = signIn('client', 'osm')
    expect(window.open).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(signer.loginUrl).toHaveBeenCalled())

    callback(stateOf())
    const result = await pending

    expect(popup.location.href).toBe('https://signer.example/auth/login')
    expect(result).toMatchObject({
      token: 'tok',
      reviewerId: 'r1',
      did: 'did:plc:abc',
      publicKey: 'PEM',
      accountName: 'Ana',
    })
  })

  test('ignores a callback carrying another state', async () => {
    const abort = new AbortController()
    const pending = signIn('client', 'osm', abort.signal)
    await vi.waitFor(() => expect(signer.loginUrl).toHaveBeenCalled())

    callback('someone-else')
    await new Promise((resolve) => setTimeout(resolve, 20))
    abort.abort()

    await expect(pending).rejects.toBeInstanceOf(SignInCancelledError)
    expect(signer.getAccount).not.toHaveBeenCalled()
  })

  test('rejects with the signer error', async () => {
    const pending = signIn('client', 'osm')
    await vi.waitFor(() => expect(signer.loginUrl).toHaveBeenCalled())

    callback(stateOf(), { sessionToken: null, error: 'access_denied' })
    await expect(pending).rejects.toThrow('access_denied')
  })
})
