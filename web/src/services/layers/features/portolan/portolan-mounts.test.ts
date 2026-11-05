import { describe, test, expect } from 'vitest'
import { MAX_KEPT, MAX_MOUNTED, planMounts } from './portolan-mounts'

const MIDTOWN = { w: -74.0, s: 40.74, e: -73.97, n: 40.76 }
const feedAt = (feed: string, lng: number, lat: number) => ({
  feed,
  bounds: [lng - 0.01, lat - 0.01, lng + 0.01, lat + 0.01],
  maxzoom: 15,
})
const nyc = feedAt('nyc', -73.985, 40.75)
const boston = feedAt('boston', -71.06, 42.36)

describe('planMounts', () => {
  test('wants the feeds the viewport touches', () => {
    const { want, drop } = planMounts([nyc, boston], MIDTOWN, new Set())
    expect(want.map(r => r.feed)).toEqual(['nyc'])
    expect(drop).toEqual([])
  })

  test('keeps a feed the viewport has left mounted', () => {
    const { want, drop } = planMounts([nyc, boston], MIDTOWN, new Set(['nyc', 'boston']))
    expect(want.map(r => r.feed)).toEqual(['nyc'])
    expect(drop).toEqual([])
  })

  test('drops the farthest spare feeds once past the cap', () => {
    const far = Array.from({ length: MAX_KEPT }, (_, i) => feedAt(`far${i}`, -73.985 + i + 1, 40.75))
    const { drop } = planMounts([nyc, ...far], MIDTOWN, new Set(far.map(r => r.feed)))
    expect(drop).toEqual([`far${MAX_KEPT - 1}`])
  })

  test('drops a mounted feed the index no longer lists', () => {
    expect(planMounts([nyc], MIDTOWN, new Set(['nyc', 'gone'])).drop).toEqual(['gone'])
  })

  test('caps the wanted set, nearest the middle first', () => {
    const many = Array.from({ length: MAX_MOUNTED + 5 }, (_, i) => ({
      feed: `f${i}`,
      bounds: [-73.985 + i * 0.0005, 40.75, -73.985 + i * 0.0005, 40.75],
      maxzoom: 15,
    }))
    const { want } = planMounts([...many].reverse(), MIDTOWN, new Set())
    expect(want.map(r => r.feed)).toEqual(many.slice(0, MAX_MOUNTED).map(r => r.feed))
  })
})
