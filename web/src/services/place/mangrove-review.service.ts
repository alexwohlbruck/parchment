import { loadBlob, saveBlob } from '@/lib/identity/personal-blob'
import { originalSignature } from '@server/lib/mangrove'

type Keypair = { publicKey: CryptoKey; privateKey: CryptoKey }

interface StoredReviewer {
  jwk: JsonWebKey
  nickname?: string
}

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

const KEY_BLOB = 'mangrove-reviewer'
const CLIENT_ID = 'https://parchment.app'

// The library bundles its own polyfills, so it loads only once someone reviews.
const mangrove = () => import('mangrove-reviews')

const reviewers = new Map<string, Promise<StoredReviewer | null>>()

function loadReviewer(userId: string): Promise<StoredReviewer | null> {
  let reviewer = reviewers.get(userId)
  if (!reviewer) {
    reviewer = loadBlob<StoredReviewer>(KEY_BLOB, userId)
    reviewers.set(userId, reviewer)
    reviewer.catch(() => reviewers.delete(userId))
  }
  return reviewer
}

async function saveReviewer(userId: string, reviewer: StoredReviewer) {
  await saveBlob(KEY_BLOB, userId, reviewer)
  reviewers.set(userId, Promise.resolve(reviewer))
}

async function createReviewer(userId: string): Promise<StoredReviewer> {
  const { generateKeypair, keypairToJwk } = await mangrove()
  const reviewer = { jwk: await keypairToJwk(await generateKeypair()) }
  await saveReviewer(userId, reviewer)
  return reviewer
}

async function toKeypair(reviewer: StoredReviewer): Promise<Keypair> {
  const { jwkToKeypair } = await mangrove()
  return jwkToKeypair(reviewer.jwk)
}

export async function getSavedNickname(userId: string) {
  return (await loadReviewer(userId))?.nickname
}

export async function fetchOwnReview(
  userId: string,
  sub: string,
): Promise<OwnReview | null> {
  const reviewer = await loadReviewer(userId)
  if (!reviewer) return null

  const { getReviews, publicToPem } = await mangrove()
  const kid = await publicToPem((await toKeypair(reviewer)).publicKey)
  const { reviews } = await getReviews({ sub, kid })
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
  userId: string,
  sub: string,
  input: ReviewInput,
  existing: OwnReview | null,
): Promise<void> {
  const reviewer = (await loadReviewer(userId)) ?? (await createReviewer(userId))
  const keypair = await toKeypair(reviewer)
  const { signAndSubmitReview, editReview } = await mangrove()

  const nickname = input.nickname?.trim() || undefined
  const content = {
    rating: input.rating,
    opinion: input.opinion.trim(),
    metadata: { client_id: CLIENT_ID, nickname, osm_id: input.osmId },
  }

  if (existing) await editReview(keypair, existing.signature, content)
  else await signAndSubmitReview(keypair, { sub, ...content })

  if (nickname !== reviewer.nickname) {
    await saveReviewer(userId, { ...reviewer, nickname })
  }
}

export async function deleteOwnReview(
  userId: string,
  signature: string,
): Promise<void> {
  const reviewer = await loadReviewer(userId)
  if (!reviewer) return
  const { signAndSubmitReview } = await mangrove()
  await signAndSubmitReview(await toKeypair(reviewer), {
    sub: `urn:maresi:${signature}`,
    action: 'delete',
    metadata: { client_id: CLIENT_ID },
  })
}
