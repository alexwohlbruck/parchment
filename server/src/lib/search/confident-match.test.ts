import { describe, it, expect } from 'bun:test'
import type { SearchResult } from '../../types/search.types'
import { confidentMatch, type ScoredResult } from './confident-match'

const result = (
  type: SearchResult['type'],
  title: string,
  id = title,
  relevance = 0.9,
): ScoredResult => ({ result: { id, type, title, metadata: {} }, relevance })

describe('confidentMatch', () => {
  it('opens the only place named what was typed', () => {
    expect(confidentMatch('pianoland', [
      result('place', 'Pianoland', 'node/1'),
      result('transit_stop', 'Poland Park'),
    ])).toBe('node/1')
  })

  it('ignores case and punctuation', () => {
    expect(confidentMatch("joe's  pizza", [result('place', 'Joe’s Pizza', 'node/2')])).toBe('node/2')
  })

  it('opens a typed coordinate', () => {
    expect(confidentMatch('40.7, -74', [result('place', '40.7, -74', 'coords/40.7/-74')]))
      .toBe('coords/40.7/-74')
  })

  it('lists a chain', () => {
    expect(confidentMatch('starbucks', [
      result('brand', 'Starbucks'),
      result('place', 'Starbucks', 'node/3'),
    ])).toBeUndefined()
    expect(confidentMatch('starbucks', [
      result('place', 'Starbucks', 'node/3'),
      result('place', 'Starbucks', 'node/4'),
    ])).toBeUndefined()
  })

  it('lists a kind of place', () => {
    expect(confidentMatch('coffee', [
      result('place', '& Coffee', 'node/5'),
      result('category', 'Cafe', 'amenity/cafe', 0.85),
    ])).toBeUndefined()
  })

  it('ignores a loosely related category', () => {
    expect(confidentMatch('pianoland', [
      result('place', 'Pianoland', 'node/1'),
      result('category', 'Musical Instrument Store', 'shop/musical_instrument', 0.39),
    ])).toBe('node/1')
  })

  it('lists when the exact name is not the top place', () => {
    expect(confidentMatch('empire', [
      result('place', 'Empire State Building', 'node/6'),
      result('place', 'Empire', 'node/7'),
    ])).toBeUndefined()
  })

  it('lists partial matches and very short queries', () => {
    expect(confidentMatch('coffee', [result('place', 'Dyad Coffee')])).toBeUndefined()
    expect(confidentMatch('q', [result('place', 'Q', 'node/8')])).toBeUndefined()
  })
})
