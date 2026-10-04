import type { PlaceReviews } from '../../../types/integration.types'
import type { AttributedValue, Review } from '../../../types/place.types'
import { SOURCE } from '../../../lib/constants'
import { mangroveSubjectUrl, originalSignature } from '../../../lib/mangrove'

export interface MangroveReview {
  signature: string
  payload: {
    sub: string
    iat: number
    action?: string | null
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

  for (const result of results) {
    const { payload } = result
    const rating = payload.rating ?? undefined
    if (rating !== undefined) ratings.push(rating)

    const text = payload.opinion?.trim()
    if (!text) continue

    reviews.push(
      attr({
        id: originalSignature(result),
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
