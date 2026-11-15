import { describe, expect, it } from 'vitest'
import { prefersAsk } from './ask-intent'

describe('prefersAsk', () => {
  it.each([
    'quiet cafe with outdoor seating',
    'where can I get pho after 10',
    'bars open late',
    'pizza within a 10 min walk',
    'somewhere good for a date',
    'coffee?',
  ])('asks for %s', (query) => {
    expect(prefersAsk(query)).toBe(true)
  })

  it.each(['starbucks', 'coffee', 'central park', '123 main st', 'thai food', ''])(
    'looks up %s',
    (query) => {
      expect(prefersAsk(query)).toBe(false)
    },
  )

  it('treats an exact result name as a lookup unless it ends in a question mark', () => {
    expect(prefersAsk('The Coffee Shop With Wifi', { exactMatch: true })).toBe(false)
    expect(prefersAsk('Is The Coffee Shop open?', { exactMatch: true })).toBe(true)
  })
})
