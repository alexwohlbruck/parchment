import { describe, expect, test } from 'bun:test'
import { classifyQuery } from './query-intent.service'

const classify = (query: string, resultTitles?: string[]) =>
  classifyQuery(query, { language: 'en-US', resultTitles })

describe('classifyQuery', () => {
  test.each([
    'starbucks',
    'coffee',
    'central park',
    '123 main st',
    'thai food',
    'cafes near me',
    '',
  ])('looks up %p', (query) => {
    expect(classify(query).intent).toBe('lookup')
  })

  test.each([
    'quiet cafe with outdoor seating',
    'where can I get pho after 10',
    'bars open late',
    'pizza within a 10 min walk',
    'somewhere good for a date',
    'pizza or tacos',
    'coffee?',
    'starbucks open now',
    'bubble tea shop in brooklyn heights',
  ])('asks %p', (query) => {
    expect(classify(query).intent).toBe('ask')
  })

  test.each<{ query: string; category: string; tags?: Record<string, string>; openNow?: boolean }>([
    { query: 'cafes with outdoor seating open now', category: 'amenity/cafe', tags: { outdoor_seating: 'yes' }, openNow: true },
    { query: 'open cafes', category: 'amenity/cafe', openNow: true },
    { query: 'grocery stores nearby open now', category: 'shop/supermarket', openNow: true },
    { query: 'coffee shops with wifi', category: 'amenity/cafe', tags: { internet_access: 'wlan', 'internet_access:fee': 'no' } },
    { query: 'restaurants with takeout', category: 'amenity/restaurant', tags: { takeaway: 'yes' } },
    { query: 'fast food drive through', category: 'amenity/fast_food', tags: { drive_through: 'yes' } },
    { query: 'outdoor seating open now', category: 'outdoor_seating/yes', openNow: true },
  ])('browses $query', ({ query, category, tags, openNow }) => {
    const intent = classify(query)
    expect(intent).toMatchObject({ intent: 'browse', category: { id: category }, residual: '' })
    expect({ tags: intent.tags, openNow: intent.openNow }).toEqual({ tags, openNow })
  })

  test('names the attributes it filters on', () => {
    expect(classify('bars with outdoor seating').attributes).toEqual([
      { id: 'outdoor_seating/yes', name: 'Outdoor Seating' },
    ])
  })

  test('asks when category results cannot be filtered on the attribute', () => {
    expect(classify('dog friendly cafes')).toMatchObject({ intent: 'ask', residual: 'cafes' })
  })

  test('keeps a bare category as a lookup', () => {
    expect(classify('restaurants nearby')).toMatchObject({
      intent: 'lookup',
      category: { id: 'amenity/restaurant' },
    })
  })

  test('treats a query naming a result exactly as a lookup unless it ends in a question mark', () => {
    expect(classify('Cafe Open Now', ['Cafe Open Now']).intent).toBe('lookup')
    expect(classify('Is The Coffee Shop open?', ['Is The Coffee Shop open']).intent).toBe('ask')
  })
})
