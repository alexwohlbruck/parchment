import type {
  PlaceReviews,
  ReviewSubject,
} from '../../../types/integration.types'
import type { AttributedValue, Review } from '../../../types/place.types'
import { SOURCE } from '../../../lib/constants'

/** Metres around the place's centre that a review's location may fall within. */
const SUBJECT_UNCERTAINTY_M = 50

export interface MangroveReview {
  signature: string
  payload: {
    sub: string
    iat: number
    rating?: number | null
    opinion?: string | null
    metadata?: {
      nickname?: string
      preferred_username?: string
      given_name?: string
      family_name?: string
    } | null
  }
}

/**
 * The `geo:` URI Mangrove files place reviews under. Mangrove matches it by
 * proximity plus a case- and punctuation-insensitive name comparison.
 */
export function mangroveSubject({ name, lat, lng }: ReviewSubject): string {
  return `geo:${lat},${lng}?q=${encodeURIComponent(name)}&u=${SUBJECT_UNCERTAINTY_M}`
}

export function mangroveSubjectUrl(sub: string): string {
  return `https://mangrove.reviews/search?sub=${encodeURIComponent(sub)}`
}

function authorName(metadata: MangroveReview['payload']['metadata']) {
  if (!metadata) return undefined
  const fullName = [metadata.given_name, metadata.family_name]
    .filter(Boolean)
    .join(' ')
  return metadata.nickname || metadata.preferred_username || fullName || undefined
}

export function adaptMangroveReviews(
  results: MangroveReview[],
  sub: string,
): PlaceReviews | null {
  if (!results.length) return null

  const attr = <T>(value: T): AttributedValue<T> => ({
    value,
    sourceId: SOURCE.MANGROVE,
  })

  const reviews: AttributedValue<Review>[] = []
  const ratings: number[] = []

  for (const { signature, payload } of results) {
    const rating = payload.rating ?? undefined
    if (rating !== undefined) ratings.push(rating)

    const text = payload.opinion?.trim()
    if (!text) continue

    reviews.push(
      attr({
        id: signature,
        text,
        rating: rating === undefined ? undefined : rating / 100,
        authorName: authorName(payload.metadata),
        createdAt: new Date(payload.iat * 1000).toISOString(),
      }),
    )
  }

  reviews.sort((a, b) => b.value.createdAt!.localeCompare(a.value.createdAt!))

  const mean = ratings.reduce((sum, r) => sum + r, 0) / ratings.length

  return {
    reviews,
    ratings: ratings.length
      ? {
          rating: attr(Number((mean / 100).toFixed(2))),
          reviewCount: attr(ratings.length),
        }
      : undefined,
    source: {
      id: SOURCE.MANGROVE,
      name: 'Mangrove',
      url: mangroveSubjectUrl(sub),
      updated: new Date().toISOString(),
    },
  }
}
