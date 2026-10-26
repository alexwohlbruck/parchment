import { describe, expect, test } from 'bun:test'
import { searchAlongNavRoute, type AlongRouteDeps } from './route-search.service'
import type { Place } from '../types/place.types'

const route = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 0.02 },
]
const place = (id: string, lat: number, lng: number) =>
  ({ id, geometry: { value: { type: 'point', center: { lat, lng } } } }) as unknown as Place

function deps(places: Place[], viaExtra = 120): AlongRouteDeps & { searched: unknown[] } {
  const searched: unknown[] = []
  return {
    searched,
    search: async (line, options) => {
      searched.push({ line, options })
      return places
    },
    duration: async points => (points.length === 3 ? 60 + viaExtra : 60),
  }
}

describe('searchAlongNavRoute', () => {
  test('orders places by distance ahead with their detour cost', async () => {
    const d = deps([place('far', 0.001, 0.015), place('near', 0.001, 0.005)])
    const results = await searchAlongNavRoute({ route, mode: 'driving', query: 'coffee' }, d)
    expect(results.map(r => r.place.id)).toEqual(['near', 'far'])
    expect(results[0].alongDistance).toBeCloseTo(556, -1)
    expect(results[0].detourSeconds).toBe(120)
  })

  test('drops places behind the traveller', async () => {
    const results = await searchAlongNavRoute({ route, mode: 'walking' }, deps([place('behind', 0, -0.003)]))
    expect(results).toEqual([])
  })

  test('drops matches outside the corridor', async () => {
    const results = await searchAlongNavRoute({ route, mode: 'walking' }, deps([place('far off', 0.05, 0.01)]))
    expect(results).toEqual([])
  })

  test('sizes the corridor by mode', async () => {
    const d = deps([])
    await searchAlongNavRoute({ route, mode: 'walking' }, d)
    expect(d.searched[0]).toMatchObject({ options: { buffer: 250 } })
  })

  test('leaves the detour unknown when it cannot be routed', async () => {
    const d = { ...deps([place('p', 0.001, 0.005)]), duration: async () => null }
    const [result] = await searchAlongNavRoute({ route, mode: 'cycling' }, d)
    expect(result.detourSeconds).toBeNull()
  })
})
