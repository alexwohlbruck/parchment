import { describe, expect, mock, test } from 'bun:test'
import type { AskContext } from './ask-tool-base'

const responses: Record<string, unknown> = {
  '/transit/departures': [
    {
      stop: { stopId: 'L06', feedId: 'mta', name: '1 Av' },
      departures: [
        { route: { id: 'M', shortName: 'M' }, departureTime: '', realTime: true, cancelled: false },
        { route: { id: 'L', shortName: 'L' }, departureTime: '', realTime: true, cancelled: false },
      ],
    },
  ],
  '/transit/route-detail': {
    routeShortName: 'L',
    routeLongName: '14 St-Canarsie Local',
    agencyName: 'MTA New York City Transit',
    stops: [
      { stopId: 'L01N', parentStation: 'L01', stopName: '8 Av' },
      { stopId: 'L02N', parentStation: 'L02', stopName: '6 Av' },
      { stopId: 'L02S', parentStation: 'L02', stopName: '6 Av' },
      { stopId: 'L06N', parentStation: 'L06', stopName: '1 Av' },
    ],
  },
  '/transit/route-vehicles': {
    vehicles: [
      { nextStopId: 'L02N', timestamp: '' },
      { nextStopId: 'L06', timestamp: '' },
      { nextStopId: 'L06S', timestamp: '' },
    ],
    feedTimestamps: { mta: 1 },
  },
  '/transit/alerts': { alerts: [{ header: 'No L trains between Lorimer St and Broadway Junction', effect: 'NO_SERVICE' }] },
}
const mockBarrelman = mock(async (path: string, _query: Record<string, unknown>) =>
  path in responses ? Response.json(responses[path]) : Response.json({ error: 'Route not found' }, { status: 404 }),
)
mock.module('../barrelman.service', () => ({ requestBarrelman: mockBarrelman }))
mock.module('../geocoding.service', () => ({
  forwardGeocode: async () => ({ results: [] }),
  reverseGeocode: async () => ({ results: [] }),
}))
mock.module('../place.service', () => ({ lookupEnrichedPlaceById: async () => null }))

const { transitTools } = await import('./ask-transit-tools')
const transitLine = transitTools.find((tool) => tool.name === 'transit_line')!

function context(): AskContext {
  return {
    userId: 'u1',
    language: 'en-US',
    origin: { lat: 40.73, lng: -73.98 },
    places: new Map(),
    units: 'metric',
    vehicles: [],
    now: new Date('2026-11-20T15:00:00Z'),
    seen: new Map(),
    routes: new Map(),
    sources: new Map(),
    emit: () => {},
  }
}

describe('transit_line', () => {
  test('finds a line by its GTFS id first', async () => {
    responses['/transit/resolve-route'] = { feedId: 'mta', routeId: 'L-by-id' }
    await transitLine.run({ line: 'l' }, context())
    expect(mockBarrelman.mock.calls.some(([path]) => path === '/transit/departures')).toBe(false)
    delete responses['/transit/resolve-route']
    mockBarrelman.mockClear()
  })

  test("finds the line on a nearby board and reports its stops, service and alerts", async () => {
    const result = await transitLine.run({ line: 'l' }, context())
    const lineQuery = (path: string) => mockBarrelman.mock.calls.find(([called]) => called === path)![1]
    expect(lineQuery('/transit/route-detail')).toEqual({ feedId: 'mta', routeId: 'L' })
    expect(lineQuery('/transit/route-vehicles')).toEqual({ feedId: 'mta', routeIds: 'L' })
    expect(result).toEqual({
      line: 'L',
      name: '14 St-Canarsie Local',
      agency: 'MTA New York City Transit',
      stops: ['8 Av', '6 Av', '1 Av'],
      running_now: 3,
      next_stops: ['6 Av', '1 Av'],
      alerts: [{ header: 'No L trains between Lorimer St and Broadway Junction', effect: 'NO_SERVICE' }],
    })
  })

  test('leaves out live service when the feed publishes no positions', async () => {
    const live = responses['/transit/route-vehicles']
    responses['/transit/route-vehicles'] = { vehicles: [], feedTimestamps: {} }
    const result = await transitLine.run({ line: 'L' }, context())
    expect(result).not.toHaveProperty('running_now')
    responses['/transit/route-vehicles'] = live
  })

  test('says so when no such line runs nearby', async () => {
    await expect(transitLine.run({ line: 'Z' }, context())).rejects.toThrow('No Z line stops near there')
  })
})
