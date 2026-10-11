import { describe, test, expect } from 'bun:test'
import { adaptMangroveReviews, type MangroveReview } from './mangrove-adapter'
import { SOURCE } from '../../../lib/constants'

const SUB = 'geo:35.2271,-80.8431?q=Amelie%27s&u=50'

function review(
  payload: Partial<MangroveReview['payload']> = {},
  signature = 'sig-1',
): MangroveReview {
  return {
    signature,
    payload: { sub: SUB, iat: 1_790_000_000, ...payload },
  }
}

describe('adaptMangroveReviews', () => {
  test('returns null when the subject has no reviews', () => {
    expect(adaptMangroveReviews([], SUB)).toBeNull()
  })

  test('maps an opinion to an attributed review on the 0–1 scale', () => {
    const result = adaptMangroveReviews(
      [review({ rating: 80, opinion: ' Great coffee. ', metadata: { nickname: 'ana' } })],
      SUB,
    )!

    expect(result.reviews).toEqual([
      {
        value: {
          id: 'sig-1',
          text: 'Great coffee.',
          rating: 0.8,
          authorName: 'ana',
          createdAt: new Date(1_790_000_000_000).toISOString(),
        },
        sourceId: SOURCE.MANGROVE,
      },
    ])
  })

  test('counts rating-only reviews in the aggregate but does not list them', () => {
    const result = adaptMangroveReviews(
      [
        review({ rating: 100, opinion: 'Superb' }, 'a'),
        review({ rating: 50 }, 'b'),
        review({ opinion: 'No score given' }, 'c'),
      ],
      SUB,
    )!

    expect(result.reviews.map((r) => r.value.id)).toEqual(['a', 'c'])
    expect(result.ratings?.rating.value).toBe(0.75)
    expect(result.ratings?.reviewCount.value).toBe(2)
  })

  test('keys an edited review by the review it edits', () => {
    const edit = review(
      { sub: 'urn:maresi:orig-sig', action: 'edit', rating: 60, opinion: 'Updated' },
      'edit-sig',
    )
    expect(adaptMangroveReviews([edit], SUB)!.reviews[0].value.id).toBe('orig-sig')
  })

  test('omits the aggregate when no review is rated', () => {
    const result = adaptMangroveReviews([review({ opinion: 'Fine' })], SUB)!
    expect(result.ratings).toBeUndefined()
  })

  test('falls back from nickname to username to full name', () => {
    const names = adaptMangroveReviews(
      [
        review({ opinion: 'x', metadata: { preferred_username: 'u1' } }, 'a'),
        review({ opinion: 'x', metadata: { given_name: 'Ada', family_name: 'L' } }, 'b'),
        review({ opinion: 'x', metadata: {} }, 'c'),
      ],
      SUB,
    )!.reviews.map((r) => r.value.authorName)

    expect(names).toEqual(['u1', 'Ada L', undefined])
  })

  test('lists the newest review first', () => {
    const result = adaptMangroveReviews(
      [
        review({ opinion: 'old', iat: 1_600_000_000 }, 'old'),
        review({ opinion: 'new', iat: 1_700_000_000 }, 'new'),
      ],
      SUB,
    )!

    expect(result.reviews.map((r) => r.value.id)).toEqual(['new', 'old'])
  })

  test('links the source to the subject on mangrove.reviews', () => {
    const { source } = adaptMangroveReviews([review({ rating: 60 })], SUB)!
    expect(source.id).toBe(SOURCE.MANGROVE)
    expect(source.url).toBe(
      `https://mangrove.reviews/search?sub=${encodeURIComponent(SUB)}`,
    )
  })
})
