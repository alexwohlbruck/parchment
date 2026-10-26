import { describe, test, expect } from 'bun:test'
import { rankCodesByProximity } from './barrelman-search-rank'

const hit = (name: string, text_rank: number, distanceKm: number | null, geom_type = 'point') => ({
  name,
  text_rank,
  distance_m: distanceKm == null ? null : distanceKm * 1000,
  geom_type,
})
const names = (hits: { name: string }[]) => hits.map((h) => h.name)

describe('rankCodesByProximity', () => {
  test('a nearby name match outranks a distant alt_name code', () => {
    const hits = [
      hit('Garland Central Park', 0.98, 2193),
      hit('DSW', 0.98, 407),
      hit('Central Park', 1.5, 3.4),
      hit('Central Park Zoo', 1.15, 2.8),
    ]
    expect(names(rankCodesByProximity(hits, 10))).toEqual(['Central Park', 'Central Park Zoo', 'DSW', 'Garland Central Park'])
  })

  test('keeps a far code when nothing nearer matches', () => {
    const hits = [hit('Garland Central Park', 0.98, 2193), hit('Central Park Street', 0.4, 1500)]
    expect(names(rankCodesByProximity(hits, 10))).toEqual(['Garland Central Park', 'Central Park Street'])
  })

  test('codes no longer crowd the page: the cap applies after the re-rank', () => {
    const codes = Array.from({ length: 10 }, (_, i) => hit(`far ${i}`, 0.98, 1000 + i))
    const ranked = rankCodesByProximity([...codes, hit('near', 1.0, 1)], 3)
    expect(names(ranked)).toEqual(['near', 'far 0', 'far 1'])
  })

  test('localities pinned ahead of the codes stay ahead of everything', () => {
    const hits = [
      hit('Paris', 0.47, 929),
      hit('Paris', 0.41, 1173),
      hit('Town of Paris', 0.98, 1397),
      hit('Paris Baguette', 0.6, 0.2),
    ]
    expect(names(rankCodesByProximity(hits, 10))).toEqual(['Paris', 'Paris', 'Paris Baguette', 'Town of Paris'])
  })

  test('a code on a road yields to the destination carrying it', () => {
    const hits = [
      hit('JFK Airport', 0.98, 20.8, 'area'),
      hit('JFK Expressway', 0.98, 19.6, 'line'),
    ]
    expect(names(rankCodesByProximity([...hits].reverse(), 10))).toEqual(['JFK Airport', 'JFK Expressway'])
  })

  test('leaves the order alone without codes or without a location', () => {
    const plain = [hit('b', 0.5, 900), hit('a', 1.0, 1)]
    expect(names(rankCodesByProximity(plain, 10))).toEqual(['b', 'a'])
    const unlocated = [hit('code', 0.98, null), hit('name', 1.5, null)]
    expect(names(rankCodesByProximity(unlocated, 1))).toEqual(['code'])
  })
})
