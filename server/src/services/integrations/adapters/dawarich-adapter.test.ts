import { describe, test, expect } from 'bun:test'
import { DawarichAdapter } from './dawarich-adapter'
import { TravelMode } from '../../../types/unified-routing.types'
import type {
  DawarichTimelineJourneyEntry,
  DawarichTimelineResponse,
  DawarichTimelineVisitEntry,
} from './dawarich-adapter'
import type {
  LocationHistoryStop,
  LocationHistorySegment,
} from '../../../types/location-history.types'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeVisit(overrides: Partial<DawarichTimelineVisitEntry> = {}): DawarichTimelineVisitEntry {
  return {
    type: 'visit',
    visit_id: 1,
    name: 'Place',
    editable_name: null,
    status: 'confirmed',
    place_id: 1,
    point_count: 0,
    tags: [],
    started_at: '2026-04-26T13:00:00-04:00',
    ended_at: '2026-04-26T13:30:00-04:00',
    duration: 30,
    place: {
      name: 'Place',
      lat: 35.21,
      lng: -80.82,
      city: 'Charlotte',
      country: 'United States',
    },
    ...overrides,
  }
}

function makeJourney(overrides: Partial<DawarichTimelineJourneyEntry> = {}): DawarichTimelineJourneyEntry {
  return {
    type: 'journey',
    track_id: 100,
    started_at: '2026-04-26T13:00:00-04:00',
    ended_at: '2026-04-26T14:00:00-04:00',
    duration: 3600,
    distance: 10,
    distance_unit: 'km',
    dominant_mode: 'cycling',
    avg_speed: 10,
    speed_unit: 'km/h',
    ...overrides,
  }
}

function makeTimeline(entries: any[]): DawarichTimelineResponse {
  return {
    days: [
      {
        date: '2026-04-26',
        summary: {
          total_distance: 10,
          distance_unit: 'km',
          places_visited: 0,
          time_moving_minutes: 60,
          time_stationary_minutes: 0,
          suggested_count: 0,
          confirmed_count: 0,
          declined_count: 0,
        },
        entries,
      },
    ],
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('DawarichAdapter', () => {
  const adapter = new DawarichAdapter()

  // ── Stop transformation ───────────────────────────────────────────────────

  describe('toStop', () => {
    test('strips trailing parenthetical place type from name', () => {
      const stop = adapter.toStop(makeVisit({ name: 'Bay Street (Residential)' }))
      expect(stop?.name).toBe('Bay Street')
    })

    test('strips parens from any of the visit name fields', () => {
      const stop = adapter.toStop(
        makeVisit({
          name: '28204 Hawthorne Lane 514 (House)',
          editable_name: null,
        }),
      )
      expect(stop?.name).toBe('28204 Hawthorne Lane 514')
    })

    test('prefers editable_name over name', () => {
      const stop = adapter.toStop(
        makeVisit({
          name: 'Generic Name (Tag)',
          editable_name: 'My Office',
        }),
      )
      expect(stop?.name).toBe('My Office')
    })

    test('returns null when place coordinates are missing', () => {
      const stop = adapter.toStop(
        makeVisit({ place: { name: '', lat: null, lng: null, city: null, country: null } }),
      )
      expect(stop).toBeNull()
    })

    test('derives duration in seconds from timestamps (NOT minutes from API)', () => {
      // The Dawarich API sends `duration` in MINUTES — but a 30-min visit
      // from 13:00 to 13:30 should produce 1800 seconds, not 30.
      const stop = adapter.toStop(
        makeVisit({
          started_at: '2026-04-26T13:00:00-04:00',
          ended_at: '2026-04-26T13:30:00-04:00',
          duration: 30, // API value in minutes
        }),
      )
      expect(stop?.duration).toBe(1800)
    })

    test('hides address when name already contains the city', () => {
      const stop = adapter.toStop(
        makeVisit({
          name: 'Big Spoon Charlotte',
          place: {
            name: 'Big Spoon Charlotte',
            lat: 1,
            lng: 1,
            city: 'Charlotte',
            country: 'United States',
          },
        }),
      )
      expect(stop?.address).toBeNull()
    })

    test('renders address as city only — country dropped', () => {
      const stop = adapter.toStop(makeVisit({ name: 'Some Place' }))
      expect(stop?.address?.formatted).toBe('Charlotte')
    })

    test('null address when no city is provided', () => {
      const stop = adapter.toStop(
        makeVisit({
          place: { name: 'X', lat: 1, lng: 1, city: null, country: 'X' },
        }),
      )
      expect(stop?.address).toBeNull()
    })
  })

  // ── Segment transformation (toLocationHistory paths) ───────────────────────

  describe('mode mapping (via toLocationHistory)', () => {
    function modeFromJourney(dominantMode: string | null): TravelMode {
      const result = adapter.toLocationHistory({
        timeline: makeTimeline([makeJourney({ dominant_mode: dominantMode })]),
        geometryByTrackId: new Map(),
        range: {
          start: new Date('2026-04-26T04:00:00.000Z'),
          end: new Date('2026-04-27T03:59:59.999Z'),
        },
        timezone: 'America/New_York',
        instanceUrl: 'https://x.test',
      })
      const seg = result.entries.find((e) => e.type === 'segment') as
        | LocationHistorySegment
        | undefined
      return seg?.mode ?? TravelMode.WALKING
    }

    test('maps each documented Dawarich mode', () => {
      expect(modeFromJourney('walking')).toBe(TravelMode.WALKING)
      expect(modeFromJourney('running')).toBe(TravelMode.WALKING)
      expect(modeFromJourney('cycling')).toBe(TravelMode.CYCLING)
      expect(modeFromJourney('driving')).toBe(TravelMode.DRIVING)
      expect(modeFromJourney('motorcycle')).toBe(TravelMode.MOTORCYCLE)
      expect(modeFromJourney('truck')).toBe(TravelMode.TRUCK)
      expect(modeFromJourney('bus')).toBe(TravelMode.TRANSIT)
      expect(modeFromJourney('train')).toBe(TravelMode.TRANSIT)
      expect(modeFromJourney('flying')).toBe(TravelMode.TRANSIT)
      expect(modeFromJourney('boat')).toBe(TravelMode.TRANSIT)
    })

    test('unknown / null mode falls back to WALKING placeholder (no guessing)', () => {
      expect(modeFromJourney('unknown')).toBe(TravelMode.WALKING)
      expect(modeFromJourney(null)).toBe(TravelMode.WALKING)
      expect(modeFromJourney('something-novel')).toBe(TravelMode.WALKING)
    })
  })

  // ── splitJourney ──────────────────────────────────────────────────────────

  describe('splitJourney', () => {
    test('returns one segment when there are no inner visits', () => {
      const journey = makeJourney()
      const out = adapter.splitJourney(journey, [], [])
      expect(out).toHaveLength(1)
      expect(out[0].duration).toBe(3600)
      expect(out[0].distance).toBe(10000) // 10 km in meters
    })

    test('emits no segments when a single visit fully contains the journey', () => {
      // 100 m of GPS jitter while at home → fully consumed by the home visit.
      const journey = makeJourney({
        started_at: '2026-04-26T05:55:00-04:00',
        ended_at: '2026-04-26T06:16:00-04:00',
        duration: 1260,
        distance: 0.1,
      })
      const homeVisit = makeVisit({
        started_at: '2026-04-26T05:55:00-04:00',
        ended_at: '2026-04-26T06:16:00-04:00',
      })
      expect(adapter.splitJourney(journey, [homeVisit], [])).toEqual([])
    })

    test('splits into the gaps between visits', () => {
      const journey = makeJourney({
        started_at: '2026-04-26T13:00:00-04:00',
        ended_at: '2026-04-26T17:00:00-04:00',
        duration: 14400,
        distance: 24,
      })
      const visits = [
        makeVisit({
          visit_id: 1,
          started_at: '2026-04-26T13:30:00-04:00',
          ended_at: '2026-04-26T13:45:00-04:00',
        }),
        makeVisit({
          visit_id: 2,
          started_at: '2026-04-26T14:30:00-04:00',
          ended_at: '2026-04-26T14:45:00-04:00',
        }),
      ]
      const out = adapter.splitJourney(journey, visits, [])
      expect(out).toHaveLength(3)
      expect(new Date(out[0].startTime).toISOString()).toBe(
        new Date('2026-04-26T13:00:00-04:00').toISOString(),
      )
      expect(new Date(out[0].endTime).toISOString()).toBe(
        new Date('2026-04-26T13:30:00-04:00').toISOString(),
      )
      expect(new Date(out[2].endTime).toISOString()).toBe(
        new Date('2026-04-26T17:00:00-04:00').toISOString(),
      )
    })

    test('sub-segment distances sum to the parent journey total', () => {
      const journey = makeJourney({ distance: 24 }) // 24 km = 24 000 m
      const visits = [
        makeVisit({
          visit_id: 1,
          started_at: '2026-04-26T13:15:00-04:00',
          ended_at: '2026-04-26T13:25:00-04:00',
        }),
        makeVisit({
          visit_id: 2,
          started_at: '2026-04-26T13:40:00-04:00',
          ended_at: '2026-04-26T13:50:00-04:00',
        }),
      ]
      const out = adapter.splitJourney(journey, visits, [])
      const sum = out.reduce((a, s) => a + s.distance, 0)
      // Allow ±1 m for rounding (we round each sub).
      expect(Math.abs(sum - 24000)).toBeLessThanOrEqual(out.length)
    })

    test('skips visits that do NOT overlap the journey window', () => {
      const journey = makeJourney({
        started_at: '2026-04-26T13:00:00-04:00',
        ended_at: '2026-04-26T14:00:00-04:00',
      })
      const tomorrowVisit = makeVisit({
        started_at: '2026-04-27T13:00:00-04:00',
        ended_at: '2026-04-27T13:30:00-04:00',
      })
      const out = adapter.splitJourney(journey, [tomorrowVisit], [])
      expect(out).toHaveLength(1) // unsplit
    })

    test('produces contiguous geometry slices (no map gaps)', () => {
      const journey = makeJourney({
        started_at: '2026-04-26T13:00:00-04:00',
        ended_at: '2026-04-26T17:00:00-04:00',
        duration: 14400,
        distance: 24,
      })
      const visits = [
        makeVisit({
          visit_id: 1,
          started_at: '2026-04-26T13:30:00-04:00',
          ended_at: '2026-04-26T13:45:00-04:00',
        }),
        makeVisit({
          visit_id: 2,
          started_at: '2026-04-26T14:30:00-04:00',
          ended_at: '2026-04-26T14:45:00-04:00',
        }),
      ]
      // 100 sequential coords; lat encodes the index so we can read it back.
      const geometry = Array.from({ length: 100 }, (_, i) => ({
        lat: i,
        lng: i,
      }))
      const out = adapter.splitJourney(journey, visits, geometry)

      for (let i = 0; i < out.length - 1; i++) {
        const lastLatThis = out[i].geometry[out[i].geometry.length - 1]?.lat
        const firstLatNext = out[i + 1].geometry[0]?.lat
        expect(firstLatNext).toBe(lastLatThis)
      }
    })
  })

  // ── End-to-end via toLocationHistory ─────────────────────────────────────

  describe('toLocationHistory', () => {
    const range = {
      start: new Date('2026-04-26T04:00:00.000Z'),
      end: new Date('2026-04-27T03:59:59.999Z'),
    }

    test('drops zero-distance journey sub-segments (GPS jitter)', () => {
      const result = adapter.toLocationHistory({
        timeline: makeTimeline([
          makeJourney({ track_id: 1, distance: 0.0 }),
          makeJourney({
            track_id: 2,
            started_at: '2026-04-26T15:00:00-04:00',
            ended_at: '2026-04-26T15:30:00-04:00',
            duration: 1800,
            distance: 5,
          }),
        ]),
        geometryByTrackId: new Map(),
        range,
        timezone: 'America/New_York',
        instanceUrl: 'https://x.test',
      })
      // Only the 5-km journey survives; the 0-distance one is filtered.
      const segments = result.entries.filter((e) => e.type === 'segment')
      expect(segments).toHaveLength(1)
      expect(segments[0].id).toContain('-track-2')
    })

    test('merges consecutive same-place stops into one continuous stay', () => {
      const result = adapter.toLocationHistory({
        timeline: makeTimeline([
          makeVisit({
            visit_id: 1,
            started_at: '2026-04-26T05:55:00-04:00',
            ended_at: '2026-04-26T06:16:00-04:00',
          }),
          makeVisit({
            visit_id: 2,
            started_at: '2026-04-26T13:00:00-04:00',
            ended_at: '2026-04-26T13:53:00-04:00',
          }),
        ]),
        geometryByTrackId: new Map(),
        range,
        timezone: 'America/New_York',
        instanceUrl: 'https://x.test',
      })
      const stops = result.entries.filter(
        (e): e is LocationHistoryStop => e.type === 'stop',
      )
      expect(stops).toHaveLength(1)
      // Spans from earliest start to latest end.
      expect(new Date(stops[0].startTime).toISOString()).toBe(
        new Date('2026-04-26T05:55:00-04:00').toISOString(),
      )
      expect(new Date(stops[0].endTime).toISOString()).toBe(
        new Date('2026-04-26T13:53:00-04:00').toISOString(),
      )
    })

    test('does NOT merge same-place stops separated by a real segment', () => {
      const result = adapter.toLocationHistory({
        timeline: makeTimeline([
          makeVisit({
            visit_id: 1,
            started_at: '2026-04-26T05:00:00-04:00',
            ended_at: '2026-04-26T06:00:00-04:00',
          }),
          makeJourney({
            track_id: 1,
            started_at: '2026-04-26T06:00:00-04:00',
            ended_at: '2026-04-26T07:00:00-04:00',
            duration: 3600,
            distance: 5,
          }),
          makeVisit({
            visit_id: 2,
            started_at: '2026-04-26T07:00:00-04:00',
            ended_at: '2026-04-26T08:00:00-04:00',
          }),
        ]),
        geometryByTrackId: new Map(),
        range,
        timezone: 'America/New_York',
        instanceUrl: 'https://x.test',
      })
      const stops = result.entries.filter((e) => e.type === 'stop')
      expect(stops).toHaveLength(2)
    })

    test('chronologically interleaves stops and segments', () => {
      const result = adapter.toLocationHistory({
        timeline: makeTimeline([
          makeJourney({
            track_id: 1,
            started_at: '2026-04-26T13:00:00-04:00',
            ended_at: '2026-04-26T17:00:00-04:00',
            duration: 14400,
            distance: 20,
          }),
          makeVisit({
            visit_id: 100,
            started_at: '2026-04-26T13:30:00-04:00',
            ended_at: '2026-04-26T13:45:00-04:00',
            place: {
              name: 'A',
              lat: 1,
              lng: 1,
              city: 'X',
              country: 'Y',
            },
          }),
          makeVisit({
            visit_id: 101,
            started_at: '2026-04-26T14:30:00-04:00',
            ended_at: '2026-04-26T14:45:00-04:00',
            place: {
              name: 'B',
              lat: 2,
              lng: 2,
              city: 'X',
              country: 'Y',
            },
          }),
        ]),
        geometryByTrackId: new Map(),
        range,
        timezone: 'America/New_York',
        instanceUrl: 'https://x.test',
      })
      const types = result.entries.map((e) => e.type)
      // segment, stop A, segment, stop B, segment
      expect(types).toEqual([
        'segment',
        'stop',
        'segment',
        'stop',
        'segment',
      ])
    })

    test('attaches geometry from the track id map to segments', () => {
      const geometry = [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
        { lat: 2, lng: 2 },
      ]
      const result = adapter.toLocationHistory({
        timeline: makeTimeline([makeJourney({ track_id: 100 })]),
        geometryByTrackId: new Map([[100, geometry]]),
        range,
        timezone: 'America/New_York',
        instanceUrl: 'https://x.test',
      })
      const seg = result.entries.find(
        (e): e is LocationHistorySegment => e.type === 'segment',
      )
      expect(seg?.geometry).toHaveLength(3)
    })

    test('builds dailyStats from timeline summary, converting km→m', () => {
      const tl = makeTimeline([])
      tl.days[0].summary.total_distance = 12.5 // 12.5 km
      tl.days[0].summary.distance_unit = 'km'
      const result = adapter.toLocationHistory({
        timeline: tl,
        geometryByTrackId: new Map(),
        range,
        timezone: 'America/New_York',
        instanceUrl: 'https://x.test',
      })
      const today = result.dailyStats.find((d) => d.date === '2026-04-26')
      expect(today?.distance).toBe(12_500)
    })

    test('miles distance unit is converted to meters', () => {
      const tl = makeTimeline([])
      tl.days[0].summary.total_distance = 1
      tl.days[0].summary.distance_unit = 'mi'
      const result = adapter.toLocationHistory({
        timeline: tl,
        geometryByTrackId: new Map(),
        range,
        timezone: 'America/New_York',
        instanceUrl: 'https://x.test',
      })
      const today = result.dailyStats.find((d) => d.date === '2026-04-26')
      expect(today?.distance).toBe(1609.344)
    })

    test('hashes the instance URL (not exposing it) on every response', () => {
      const result = adapter.toLocationHistory({
        timeline: makeTimeline([]),
        geometryByTrackId: new Map(),
        range,
        timezone: 'America/New_York',
        instanceUrl: 'https://my-private-instance.example.com',
      })
      const hash = result.source.instanceUrlHash
      expect(hash).toBeDefined()
      expect(hash).not.toContain('my-private-instance')
      expect(hash).toMatch(/^[0-9a-f]{16}$/)
    })

    test('drops entries that fall entirely outside the entries range', () => {
      const tl = {
        days: [
          {
            date: '2026-04-26',
            summary: makeTimeline([]).days[0].summary,
            entries: [
              makeJourney({
                track_id: 1,
                started_at: '2026-04-25T10:00:00-04:00',
                ended_at: '2026-04-25T11:00:00-04:00',
                duration: 3600,
                distance: 3,
              }),
            ],
          },
        ],
      }
      const result = adapter.toLocationHistory({
        timeline: tl as DawarichTimelineResponse,
        geometryByTrackId: new Map(),
        range, // window covers Apr 26 EST
        timezone: 'America/New_York',
        instanceUrl: 'https://x.test',
      })
      expect(result.entries).toHaveLength(0)
    })
  })
})
