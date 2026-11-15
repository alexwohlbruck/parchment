import { describe, test, expect } from 'bun:test'
import { toolCacheKey } from './tool-cache-key'

const scope = { language: 'en-US' }

describe('toolCacheKey', () => {
  test('ignores key order, spacing, undefined args and sub-metre moves', () => {
    expect(
      toolCacheKey('find_places', { query: ' ramen  bar', origin: { lat: 40.712801, lng: -74.006 }, limit: undefined }, scope),
    ).toBe(toolCacheKey('find_places', { origin: { lng: -74.006001, lat: 40.7128 }, query: 'ramen bar' }, scope))
  })

  test('keeps distinct searches, languages and users apart', () => {
    const key = toolCacheKey('find_places', { query: 'ramen' }, scope)
    expect(toolCacheKey('find_places', { query: 'pho' }, scope)).not.toBe(key)
    expect(toolCacheKey('get_place', { query: 'ramen' }, scope)).not.toBe(key)
    expect(toolCacheKey('find_places', { query: 'ramen' }, { language: 'es-ES' })).not.toBe(key)
    expect(toolCacheKey('find_places', { query: 'ramen' }, { ...scope, userId: 'u1' })).not.toBe(
      toolCacheKey('find_places', { query: 'ramen' }, { ...scope, userId: 'u2' }),
    )
  })
})
