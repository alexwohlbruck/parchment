import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { routingService } from './routing.service'
import { rerouteSegment } from './reroute.service'

const route = (legs: object[]) => ({ routes: legs.length ? [{ legs }] : [] }) as any

describe('rerouteSegment', () => {
  afterEach(() => {
    ;(routingService.getRoute as any).mockRestore?.()
  })

  test('routes from the position to the segment end with the heading favoured', async () => {
    const getRoute = spyOn(routingService, 'getRoute').mockResolvedValue(
      route([{ duration: 300, distance: 2000, geometry: [{ lat: 1, lng: 2 }], instructions: [], edgeSegments: [] }]),
    )
    const segment = await rerouteSegment({
      position: { lat: 40.7, lng: -73.99 },
      heading: 90,
      speed: 6,
      destination: { lat: 40.75, lng: -73.98 },
      mode: 'cycling',
    })
    expect(segment?.distance).toBe(2000)
    const [locations, costing, , options] = getRoute.mock.calls[0] as any[]
    expect(locations[0].value).toEqual([40.7, -73.99])
    expect(costing).toBe('bicycle')
    expect(options).toEqual({ startHeading: 90 })
  })

  test('lets a walker turn round rather than holding their heading', async () => {
    const getRoute = spyOn(routingService, 'getRoute').mockResolvedValue(
      route([{ duration: 60, distance: 80, geometry: [{ lat: 1, lng: 2 }], instructions: [], edgeSegments: [] }]),
    )
    await rerouteSegment({ position: { lat: 0, lng: 0 }, heading: 90, speed: 1.4, destination: { lat: 1, lng: 1 }, mode: 'walking' })
    expect((getRoute.mock.calls[0] as any[])[3].startHeading).toBeUndefined()
  })

  test('answers null when the router finds nothing', async () => {
    spyOn(routingService, 'getRoute').mockResolvedValue(route([]))
    expect(await rerouteSegment({ position: { lat: 0, lng: 0 }, destination: { lat: 1, lng: 1 }, mode: 'walking' })).toBeNull()
  })
})
