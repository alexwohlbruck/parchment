import { describe, expect, test } from 'vitest'
import { isThreadExpired, savedThread } from './ask-threads'
import type { AskExchange } from '@/types/ask.types'
import type { Place } from '@/types/place.types'

const place = {
  id: 'osm/node/1',
  name: { value: 'Bagel Belly', sourceId: 'osm' },
  placeType: { value: 'Cafe', sourceId: 'osm' },
  geometry: { value: { type: 'point', center: { lat: 40.73, lng: -73.99 } }, sourceId: 'osm' },
  reviews: [{ value: { id: 'r', text: 'Great bagels' }, sourceId: 'google' }],
  photos: [{ value: { url: 'https://example.com/a.jpg' }, sourceId: 'google' }],
  contactInfo: { phone: { value: '+1', sourceId: 'osm' }, email: null, website: null, socials: {} },
} as unknown as Place

function exchange(overrides: Partial<AskExchange> = {}): AskExchange {
  return {
    question: 'bagels with wifi',
    steps: [],
    text: 'Try Bagel Belly.',
    places: [{ place, reason: 'Has wifi' }],
    startedAt: 1,
    finishedAt: 2,
    status: 'done',
    ...overrides,
  }
}

describe('savedThread', () => {
  test('keeps answered exchanges, titled by the first question', () => {
    const thread = savedThread(
      { id: 't1', createdAt: 1, exchanges: [exchange(), exchange({ question: 'and later?', status: 'error' })] },
      50,
    )
    expect(thread).toMatchObject({ id: 't1', title: 'bagels with wifi', createdAt: 1, at: 50 })
    expect(thread?.exchanges).toHaveLength(1)
  })

  test('nothing to keep before an answer', () => {
    expect(savedThread({ id: 't1', createdAt: 1, exchanges: [exchange({ status: 'running' })] }, 2)).toBeNull()
  })

  test('drops what makes a place heavy but keeps what its card shows', () => {
    const [cited] = savedThread({ id: 't1', createdAt: 1, exchanges: [exchange()] }, 2)!.exchanges[0].places
    expect(cited.reason).toBe('Has wifi')
    expect(cited.place.reviews).toBeUndefined()
    expect(cited.place.photos).toEqual([])
    expect(cited.place.contactInfo.phone?.value).toBe('+1')
    expect(cited.place.name.value).toBe('Bagel Belly')
  })

  test('keeps where a trip went but not its stale plan', () => {
    const trip = {
      from: { lat: 1, lng: 2, here: true as const },
      to: { lat: 3, lng: 4, name: 'Work' },
      kind: 'transit' as const,
      plan: { trips: [] } as never,
      tripIndex: 0,
    }
    const saved = savedThread(
      { id: 't1', createdAt: 1, exchanges: [exchange({ trip, plan: { trips: {} as never, tripId: 'x' } })] },
      2,
    )!.exchanges[0]
    expect(saved.trip).toEqual({ from: trip.from, to: trip.to, kind: 'transit', stops: undefined, time: undefined, lines: undefined })
    expect(saved.plan).toBeNull()
  })
})

describe('isThreadExpired', () => {
  const day = 86_400_000

  test('expires a thread unused for longer than the history length', () => {
    expect(isThreadExpired({ at: 0 }, 7, 8 * day)).toBe(true)
    expect(isThreadExpired({ at: 0 }, 7, 6 * day)).toBe(false)
  })

  test('never expires with no limit', () => {
    expect(isThreadExpired({ at: 0 }, 0, 1000 * day)).toBe(false)
  })
})
