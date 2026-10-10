import { originalSignature } from '@server/lib/mangrove'

export interface MangroveSession {
  token: string
  reviewerId: string
  did?: string
  /** PEM public key the signer signs with; identifies the reviewer's reviews. */
  publicKey: string
  /** Display name at the login provider, offered as the review's nickname. */
  accountName?: string
  expiresAt: number
}

export type MangroveProvider = 'osm' | 'bluesky' | 'google' | 'github' | 'passkey'

export interface OwnReview {
  /** Signature of the original review, which edits and deletes must target. */
  signature: string
  /** 0–100, as Mangrove stores it. */
  rating: number
  opinion: string
  nickname?: string
}

export interface ReviewInput {
  rating: number
  opinion: string
  nickname?: string
  osmId?: string
}

/** Who wrote a review: the signer's key, plus every key bound to their identity. */
export type Reviewer = Pick<MangroveSession, 'publicKey' | 'did'>

const CLIENT_ID = 'https://parchment.app'
const CALLBACK_PATH = '/oauth/mangrove.html'
const CHANNEL = 'mangrove-signer'
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000
const POPUP_TIMEOUT_MS = 5 * 60 * 1000

// The library bundles its own polyfills, so it loads only once someone reviews.
const reviewer = () => import('mangrove-reviews')
const signer = () => import('mangrove-reviews/signer')

export class SignInCancelledError extends Error {
  constructor() {
    super('Mangrove sign-in was cancelled')
  }
}

/** A request the signer refused because the session is unknown or expired. */
export function isExpiredSession(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 401
}

/**
 * Log in through Mangrove's signer in a popup. The popup returns to a static
 * page on this origin, which hands the session back over a BroadcastChannel.
 */
export async function signIn(
  clientId: string,
  provider: MangroveProvider,
  signal?: AbortSignal,
): Promise<MangroveSession> {
  // Opened before any await so the click still counts as the user's gesture.
  const popup = window.open('', 'mangrove-signer', 'width=520,height=720,popup=yes')
  const { loginUrl, getAccount } = await signer()
  const state = crypto.randomUUID()
  const redirectUri = `${location.origin}${CALLBACK_PATH}`
  const url = loginUrl(clientId, redirectUri, provider, undefined, state)
  if (popup) popup.location.href = url
  else window.open(url, '_blank')

  const callback = await new Promise<{
    sessionToken: string
    reviewerId: string
    did: string | null
  }>((resolve, reject) => {
    const channel = new BroadcastChannel(CHANNEL)
    const finish = () => {
      channel.close()
      clearTimeout(timeout)
      signal?.removeEventListener('abort', cancel)
    }
    const cancel = () => {
      finish()
      popup?.close()
      reject(new SignInCancelledError())
    }
    // Provider pages sever the popup's opener, so `popup.closed` can't be
    // trusted; the caller cancels instead, or the wait times out.
    const timeout = setTimeout(cancel, POPUP_TIMEOUT_MS)
    signal?.addEventListener('abort', cancel)

    channel.onmessage = ({ data }) => {
      if (data?.type !== 'mangrove-signer-callback' || data.state !== state) return
      finish()
      if (data.sessionToken && data.reviewerId) resolve(data)
      else reject(new Error(data.error || 'Mangrove sign-in failed'))
    }
  })

  const account = await getAccount(callback.sessionToken)
  return {
    token: callback.sessionToken,
    reviewerId: callback.reviewerId,
    did: account.did ?? callback.did ?? undefined,
    publicKey: account.public_key,
    accountName: account.account_name ?? undefined,
    expiresAt: Date.now() + SESSION_LIFETIME_MS,
  }
}

export async function signOut(session: MangroveSession): Promise<void> {
  const { revokeSession } = await signer()
  await revokeSession(session.token).catch(() => {})
}

export async function fetchOwnReview(
  author: Reviewer,
  sub: string,
): Promise<OwnReview | null> {
  const { getReviews } = await reviewer()
  const query: Parameters<typeof getReviews>[0] & { did?: string } = author.did
    ? { sub, did: author.did }
    : { sub, kid: author.publicKey }
  const { reviews } = await getReviews(query)
  const latest = reviews[0]
  if (!latest) return null

  return {
    signature: originalSignature(latest),
    rating: latest.payload.rating ?? 0,
    opinion: latest.payload.opinion ?? '',
    nickname: latest.payload.metadata?.nickname,
  }
}

export async function saveReview(
  session: MangroveSession,
  sub: string,
  input: ReviewInput,
  existing: OwnReview | null,
): Promise<void> {
  const { signAndSubmitReview, editReview } = await signer()
  const content = {
    rating: input.rating,
    opinion: input.opinion.trim() || undefined,
    metadata: {
      client_id: CLIENT_ID,
      nickname: input.nickname?.trim() || undefined,
      osm_id: input.osmId,
    },
  }

  if (existing) await editReview(session.token, existing.signature, content)
  else await signAndSubmitReview(session.token, { sub, ...content })
}

export async function deleteOwnReview(
  session: MangroveSession,
  signature: string,
): Promise<void> {
  const { deleteReview } = await signer()
  await deleteReview(session.token, signature)
}
