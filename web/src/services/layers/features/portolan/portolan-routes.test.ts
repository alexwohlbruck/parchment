/**
 * A bullet on the map is a link to its line. Getting there means reading
 * the route off the tile feature and turning the pyramid's id into the
 * (feedId, routeId) pair the route detail is keyed by — once per route,
 * however many bullets of it a rider taps.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'

const get = vi.fn()
vi.mock('@/lib/api', () => ({ api: { get: (...args: any[]) => get(...args) } }))

const { bareRouteId, resetResolvedRoutes, resolveRouteRef, routeRefFor } = await import(
  './portolan-routes'
)

const CAT = { route: '2', mode: 'metro', _feed: 'mta-subway' }
const POINT = [-73.99, 40.75]

beforeEach(() => {
  resetResolvedRoutes()
  get.mockReset()
  get.mockResolvedValue({ data: { feedId: 'mta-subway', routeId: '2' } })
})

describe('reading the route off a bullet', () => {
  test('carries the id, the mode and the bullet’s own point', () => {
    expect(routeRefFor(CAT, POINT)).toMatchObject({
      routeId: '2',
      mode: 'metro',
      lat: 40.75,
      lng: -73.99,
    })
  })

  test('a group pyramid’s prefix is not part of the id', () => {
    expect(bareRouteId('f3:2')).toBe('2')
    expect(routeRefFor({ ...CAT, route: 'f3:2' }, POINT)?.routeId).toBe('2')
  })

  test('a colon the feed put there survives', () => {
    expect(bareRouteId('SEPTA:BSL')).toBe('SEPTA:BSL')
  })

  test('a feature with no route is not a link', () => {
    expect(routeRefFor({ ftype: 'station', name: 'Canal St' }, POINT)).toBeNull()
  })

  test('nor is one with no usable point', () => {
    expect(routeRefFor(CAT, undefined)).toBeNull()
    expect(routeRefFor(CAT, ['x', 'y'])).toBeNull()
  })
})

describe('resolving it to a feed', () => {
  test('asks with the id, the point and the mode class', async () => {
    await resolveRouteRef(routeRefFor(CAT, POINT)!)

    expect(get).toHaveBeenCalledWith('/transit/resolve-route', {
      params: { routeId: '2', lat: 40.75, lng: -73.99, mode: 'metro' },
    })
  })

  test('every bullet of one route in one pyramid asks once', async () => {
    const first = routeRefFor(CAT, POINT)!
    const elsewhere = routeRefFor(CAT, [-73.94, 40.81])!

    expect(await resolveRouteRef(first)).toEqual({ feedId: 'mta-subway', routeId: '2' })
    expect(await resolveRouteRef(elsewhere)).toEqual({ feedId: 'mta-subway', routeId: '2' })
    expect(get).toHaveBeenCalledTimes(1)
  })

  test('two pyramids drawing the same id are two questions', async () => {
    await resolveRouteRef(routeRefFor(CAT, POINT)!)
    await resolveRouteRef(routeRefFor({ ...CAT, _feed: 'northeast-corridor' }, POINT)!)

    expect(get).toHaveBeenCalledTimes(2)
  })

  test('a route no feed claims stays unclaimed rather than being re-asked', async () => {
    get.mockRejectedValue({ response: { status: 404 } })

    const ref = routeRefFor(CAT, POINT)!
    expect(await resolveRouteRef(ref)).toBeNull()
    expect(await resolveRouteRef(ref)).toBeNull()
    expect(get).toHaveBeenCalledTimes(1)
  })

  test('a request that lost the network is asked again', async () => {
    get.mockRejectedValueOnce(new Error('Network Error'))

    const ref = routeRefFor(CAT, POINT)!
    expect(await resolveRouteRef(ref)).toBeNull()
    expect(await resolveRouteRef(ref)).toEqual({ feedId: 'mta-subway', routeId: '2' })
  })
})
