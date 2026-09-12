/**
 * An open itinerary narrows the symbols on the map to its own legs.
 *
 * The rule has three parts, and the interesting failures are all in the
 * third: the right LINE (a leg riding the A must not light up the C that
 * shares its stations), the right SPAN (the A runs to Inwood whether or
 * not the rider does), and the right kind of span test for the kind of
 * symbol — a station sits AT a stop, a caterpillar bullet rides between
 * two of them.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('maplibre-gl', () => ({ getVersion: () => '6.4.1-transit.3' }))
vi.mock('@/router', () => ({ default: {}, AppRoute: {} }))
vi.mock('@/lib/api', () => ({ api: { defaults: { baseURL: 'http://test' } } }))

import { usePortolanTransitService } from '@/services/layers/features/portolan/portolan-transit.service'
import { MapEngine, MapTheme } from '@/types/map.types'

const FLAG_KEY = 'parchment.portolan-transit'

/** Four stops down one avenue, ~1.1 km apart, and the A/C run all four. */
const STOPS: [number, number][] = [
  [-73.99, 40.75],
  [-73.99, 40.76],
  [-73.99, 40.77],
  [-73.99, 40.78],
]

const station = (name: string, at: [number, number], routes: string) => ({
  type: 'Feature',
  properties: { ftype: 'station', name, routes, route_colors: '2850AD' },
  geometry: { type: 'Point', coordinates: at },
})

const cat = (label: string, at: [number, number], route: string) => ({
  type: 'Feature',
  properties: { ftype: 'cat', label, route, band: 14, vec: '[0,0]', veclo: '[0,0]' },
  geometry: { type: 'Point', coordinates: at },
})

function fakeMap(features: Record<string, unknown[]>) {
  const layers: Array<{ id: string }> = [{ id: 'background' }]
  const sources: Record<string, unknown> = { basemap: {}, 'portolan-tiles-nyc': {} }
  const handlers: Record<string, (e?: unknown) => void> = {}
  const stationData: unknown[] = []

  const map = {
    style: {},
    isStyleLoaded: () => true,
    getStyle: () => ({ layers: [...layers], sources: { ...sources } }),
    getLayer: (id: string) => layers.find(l => l.id === id),
    getSource: (id: string) =>
      id === 'portolan-stations'
        ? { setData: (d: any) => stationData.push(d) }
        : sources[id],
    addLayer: (l: { id: string }) => layers.push(l),
    addSource: (id: string, def: unknown) => {
      sources[id] = def
    },
    removeLayer: (id: string) => {
      const i = layers.findIndex(l => l.id === id)
      if (i >= 0) layers.splice(i, 1)
    },
    removeSource: (id: string) => {
      delete sources[id]
    },
    querySourceFeatures: (_sid: string, opts: { sourceLayer: string }) =>
      features[opts.sourceLayer] ?? [],
    setFilter: () => {},
    setPaintProperty: () => {},
    setLayoutProperty: () => {},
    setLayerZoomRange: () => {},
    getBounds: () => ({
      getWest: () => -74.3,
      getEast: () => -73.6,
      getSouth: () => 40.5,
      getNorth: () => 41,
    }),
    hasImage: () => true,
    addImage: () => {},
    on: (ev: string, fn: (e?: unknown) => void) => {
      handlers[ev] = fn
    },
    off: () => {},
    once: vi.fn(),
    fire: (ev: string) => handlers[ev]?.(),
    /** The features the last setData put on the map. */
    symbols: () => (stationData.at(-1) as any)?.features ?? [],
  }
  return map
}

const strategyFor = (map: unknown) =>
  ({
    mapInstance: map,
    options: { engine: MapEngine.MAPLIBRE, theme: MapTheme.LIGHT },
  }) as any

const names = (map: ReturnType<typeof fakeMap>) =>
  map.symbols().map((f: any) => f.properties.name ?? f.properties.label)

/** Hydrate the tiles into the symbol source, the way an idle does. */
async function hydrate(map: ReturnType<typeof fakeMap>) {
  map.fire('idle')
  await new Promise(r => requestAnimationFrame(() => r(null)))
}

describe('trip legs narrow the symbols to the itinerary', () => {
  let service: ReturnType<typeof usePortolanTransitService>

  beforeEach(() => {
    // Station names are measured on a canvas to predict their wrap count,
    // and happy-dom has no 2d context to measure on.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (t: string) => ({ width: t.length * 50 }),
    } as unknown as CanvasRenderingContext2D)
    localStorage.setItem(FLAG_KEY, '1')
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve([]) })),
    )
    service = usePortolanTransitService()
  })

  afterEach(() => {
    service.teardownPortolanTransit()
    localStorage.removeItem(FLAG_KEY)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('keeps the legitimate stops and drops everything else', async () => {
    const map = fakeMap({
      stations: [
        station('Ridden', STOPS[1], 'A,C'),
        station('Off the line', STOPS[1], 'L'),
        station('Past the last stop', [-73.99, 40.83], 'A,C'),
      ],
      markers: [],
      cat: [],
    })
    service.initializePortolanTransit(strategyFor(map))
    await hydrate(map)

    service.setTripLegs([{ routes: ['A'], stops: STOPS }])

    expect(names(map)).toEqual(['Ridden'])
  })

  test('bullets ride the span between stops, not only the stops', async () => {
    const map = fakeMap({
      stations: [],
      markers: [],
      cat: [
        cat('A', [-73.99, 40.755], 'A'),
        cat('A', [-73.99, 40.81], 'A'),
        cat('L', [-73.99, 40.755], 'L'),
      ],
    })
    service.initializePortolanTransit(strategyFor(map))
    await hydrate(map)

    service.setTripLegs([{ routes: ['A'], stops: STOPS }])

    // Between two ridden stops, and only for the line being ridden. The
    // one at 40.81 is past the leg's last stop.
    expect(map.symbols()).toHaveLength(1)
    expect(map.symbols()[0].geometry.coordinates).toEqual([-73.99, 40.755])
  })

  test('each leg contributes its own line and its own span', async () => {
    const far: [number, number][] = [
      [-73.95, 40.68],
      [-73.95, 40.69],
    ]
    const map = fakeMap({
      stations: [
        station('First leg', STOPS[2], 'A,C'),
        station('Second leg', far[0], 'Q'),
        station('Second line, first span', STOPS[2], 'Q'),
      ],
      markers: [],
      cat: [],
    })
    service.initializePortolanTransit(strategyFor(map))
    await hydrate(map)

    service.setTripLegs([
      { routes: ['A'], stops: STOPS },
      { routes: ['Q'], stops: far },
    ])

    expect(names(map)).toEqual(['First leg', 'Second leg'])
  })

  test('putting the trip away puts the whole network back', async () => {
    const map = fakeMap({
      stations: [station('Ridden', STOPS[1], 'A'), station('Elsewhere', [0, 0], 'L')],
      markers: [],
      cat: [],
    })
    service.initializePortolanTransit(strategyFor(map))
    await hydrate(map)

    service.setTripLegs([{ routes: ['A'], stops: STOPS }])
    expect(names(map)).toEqual(['Ridden'])

    service.setTripLegs(null)
    expect(names(map)).toEqual(['Ridden', 'Elsewhere'])
  })
})
