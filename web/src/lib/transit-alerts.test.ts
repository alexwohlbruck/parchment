import { describe, it, expect } from 'vitest'
import {
  alertRank,
  alertTone,
  alertEffectKey,
  alertStart,
  alertEnd,
  isUpcoming,
  worstAlert,
  sortByRelevance,
  isInEffect,
  nextStart,
  splitFeedId,
  alertsFor,
} from './transit-alerts'
import type { ServiceAlert } from '@/types/transit.types'

/**
 * Reading an agency's alert.
 *
 * Two things here are easy to get wrong and invisible when they are. Feeds are
 * inconsistent about `severityLevel` — plenty publish a full suspension with it
 * unset — so severity alone would draw a shutdown in the same grey as a
 * poster-on-a-wall notice. And an informed entity constrains only on the
 * dimensions the caller can answer for — MTA scopes nearly every subway alert
 * to a route *and* a stop, so the narrowing rule decides both whether a route
 * page sees them at all and whether a stop page sees another stop's detour.
 */

const NOW = Date.UTC(2026, 7, 18, 12, 0, 0)

function alert(overrides: Partial<ServiceAlert> = {}): ServiceAlert {
  return {
    id: 'feed_a1',
    feedId: 'feed',
    cause: 'CONSTRUCTION',
    effect: 'DETOUR',
    severity: 'WARNING',
    header: 'Southbound B48 buses are detoured',
    activePeriods: [],
    informedEntities: [{ routeId: 'B48' }],
    ...overrides,
  }
}

describe('alertRank', () => {
  it('orders by the severity the feed declared', () => {
    const rank = (severity: string) => alertRank(alert({ severity, effect: 'OTHER_EFFECT' }))

    expect(rank('SEVERE')).toBeGreaterThan(rank('WARNING'))
    expect(rank('WARNING')).toBeGreaterThan(rank('INFO'))
  })

  it('reads the effect when the feed left severity unset', () => {
    const unrated = (effect: string) =>
      alertRank(alert({ severity: 'UNKNOWN_SEVERITY', effect }))

    expect(unrated('NO_SERVICE')).toBe(3)
    expect(unrated('DETOUR')).toBe(2)
    expect(unrated('MODIFIED_SERVICE')).toBe(1)
    expect(unrated('NO_EFFECT')).toBe(0)
  })
})

describe('alertTone', () => {
  it('draws an unrated suspension as severely as a rated one', () => {
    expect(alertTone(alert({ severity: 'UNKNOWN_SEVERITY', effect: 'NO_SERVICE' }))).toBe('severe')
    expect(alertTone(alert({ severity: 'SEVERE', effect: 'UNKNOWN_EFFECT' }))).toBe('severe')
  })

  it('keeps a plain notice quiet', () => {
    expect(alertTone(alert({ severity: 'INFO', effect: 'OTHER_EFFECT' }))).toBe('info')
  })
})

describe('alertEffectKey', () => {
  it('names the effect when the feed gives a useful one', () => {
    expect(alertEffectKey(alert({ effect: 'DETOUR' }))).toBe('DETOUR')
  })

  it('falls back to the severity word rather than saying "unknown effect"', () => {
    expect(alertEffectKey(alert({ effect: 'UNKNOWN_EFFECT', severity: 'SEVERE' }))).toBe('SEVERE')
  })

  it('says nothing when neither field does', () => {
    expect(alertEffectKey(alert({ effect: 'OTHER_EFFECT', severity: 'INFO' }))).toBeNull()
  })
})

describe('active periods', () => {
  const iso = (ms: number) => new Date(ms).toISOString()

  it('takes the earliest start and the latest end across periods', () => {
    const weekend = alert({
      activePeriods: [
        { start: iso(NOW + 86_400_000), end: iso(NOW + 90_000_000) },
        { start: iso(NOW - 3_600_000), end: iso(NOW + 3_600_000) },
      ],
    })

    expect(alertStart(weekend)?.getTime()).toBe(NOW - 3_600_000)
    expect(alertEnd(weekend)?.getTime()).toBe(NOW + 90_000_000)
  })

  it('treats an open-ended alert as having no printable start', () => {
    expect(alertStart(alert({ activePeriods: [{ end: iso(NOW) }] }))).toBeNull()
  })

  it('separates what starts later from what is happening now', () => {
    expect(isUpcoming(alert({ activePeriods: [{ start: iso(NOW + 60_000) }] }), NOW)).toBe(true)
    expect(isUpcoming(alert({ activePeriods: [{ start: iso(NOW - 60_000) }] }), NOW)).toBe(false)
    expect(isUpcoming(alert({ activePeriods: [] }), NOW)).toBe(false)
  })
})

describe('worstAlert', () => {
  const info = alert({ id: 'info', severity: 'INFO', effect: 'OTHER_EFFECT' })
  const detour = alert({ id: 'detour', severity: 'WARNING' })
  const suspended = alert({ id: 'suspended', severity: 'SEVERE', effect: 'NO_SERVICE' })

  it('picks the alert a single badge should stand for', () => {
    expect(worstAlert([info, suspended, detour])?.id).toBe('suspended')
  })

  it('has nothing to stand for in an empty set', () => {
    expect(worstAlert([])).toBeNull()
  })
})

/**
 * Recurring work is the case that matters here. MTA publishes "trains board
 * from the other platform" as ONE alert carrying a window per night — 58 of
 * them on the 7, 254 on the Queens Blvd line. Judging by the earliest start
 * marks every one of those as in effect from the first night until the last,
 * which is months of a route page insisting nothing runs normally. Three of
 * the four alerts on the 7's page were exactly this.
 */
describe('isInEffect and isUpcoming', () => {
  const iso = (ms: number) => new Date(ms).toISOString()
  const HOUR = 3_600_000

  it('is in effect only while a window is actually open', () => {
    const open = alert({ activePeriods: [{ start: iso(NOW - HOUR), end: iso(NOW + HOUR) }] })

    expect(isInEffect(open, NOW)).toBe(true)
    expect(isUpcoming(open, NOW)).toBe(false)
  })

  it('does not call recurring work "in effect" between its windows', () => {
    const overnight = alert({
      activePeriods: [
        { start: iso(NOW - 48 * HOUR), end: iso(NOW - 44 * HOUR) }, // ran, finished
        { start: iso(NOW + 4 * HOUR), end: iso(NOW + 8 * HOUR) },   // runs again tonight
      ],
    })

    expect(isInEffect(overnight, NOW)).toBe(false)
    expect(isUpcoming(overnight, NOW)).toBe(true)
    expect(nextStart(overnight, NOW)?.getTime()).toBe(NOW + 4 * HOUR)
  })

  it('treats an alert with no window as in effect until further notice', () => {
    expect(isInEffect(alert({ activePeriods: [] }), NOW)).toBe(true)
  })

  it('is neither in effect nor upcoming once every window has closed', () => {
    const done = alert({ activePeriods: [{ start: iso(NOW - 4 * HOUR), end: iso(NOW - HOUR) }] })

    expect(isInEffect(done, NOW)).toBe(false)
    expect(isUpcoming(done, NOW)).toBe(false)
  })
})

describe('sortByRelevance', () => {
  const iso = (ms: number) => new Date(ms).toISOString()
  const HOUR = 3_600_000

  const liveMinor = alert({
    id: 'live-minor',
    severity: 'INFO',
    effect: 'OTHER_EFFECT',
    activePeriods: [{ start: iso(NOW - HOUR), end: iso(NOW + HOUR) }],
  })
  const liveSevere = alert({
    id: 'live-severe',
    severity: 'SEVERE',
    effect: 'NO_SERVICE',
    activePeriods: [{ start: iso(NOW - HOUR), end: iso(NOW + HOUR) }],
  })
  const laterSevere = alert({
    id: 'later-severe',
    severity: 'SEVERE',
    effect: 'NO_SERVICE',
    activePeriods: [{ start: iso(NOW + 48 * HOUR), end: iso(NOW + 52 * HOUR) }],
  })
  const laterTonight = alert({
    id: 'later-tonight',
    severity: 'WARNING',
    activePeriods: [{ start: iso(NOW + 4 * HOUR), end: iso(NOW + 8 * HOUR) }],
  })

  it('puts what is happening now above worse news scheduled for later', () => {
    // A rider on the platform cannot act on Thursday's suspension.
    const order = sortByRelevance([laterSevere, liveMinor], NOW).map(a => a.id)

    expect(order).toEqual(['live-minor', 'later-severe'])
  })

  it('ranks by severity within what is happening now', () => {
    const order = sortByRelevance([liveMinor, liveSevere], NOW).map(a => a.id)

    expect(order).toEqual(['live-severe', 'live-minor'])
  })

  it('orders scheduled work by how soon it starts', () => {
    const order = sortByRelevance([laterSevere, laterTonight], NOW).map(a => a.id)

    expect(order[0]).toBe('later-tonight')
  })

  it('does not mutate its input', () => {
    const input = [laterSevere, liveMinor]
    sortByRelevance(input, NOW)

    expect(input.map(a => a.id)).toEqual(['later-severe', 'live-minor'])
  })
})

describe('splitFeedId', () => {
  it('splits a MOTIS id at the feed tag', () => {
    expect(splitFeedId('mta-nyct-subway_B48')).toEqual({
      feedId: 'mta-nyct-subway',
      localId: 'B48',
    })
  })

  it('keeps the rest intact when the local id has underscores of its own', () => {
    expect(splitFeedId('feed_trip_123_weekday')).toEqual({
      feedId: 'feed',
      localId: 'trip_123_weekday',
    })
  })

  it('treats an unprefixed id as already feed-local', () => {
    expect(splitFeedId('B48')).toEqual({ feedId: '', localId: 'B48' })
  })
})

describe('alertsFor', () => {
  const routeWide = alert({ id: 'route', informedEntities: [{ routeId: 'B48' }] })
  const atOneStop = alert({
    id: 'stop',
    informedEntities: [{ routeId: 'B48', stopId: 'S1' }],
  })
  const agencyWide = alert({ id: 'agency', informedEntities: [{ agencyId: 'MTA' }] })
  const oneRun = alert({ id: 'trip', informedEntities: [{ tripId: 'T9' }] })
  const all = [routeWide, atOneStop, agencyWide, oneRun]

  it('keeps every alert on that line, including ones scoped to a stop on it', () => {
    // A route page has no stop to answer with, so a stop-scoped alert on this
    // line still belongs there — "the N is skipping R09" is news about the N.
    expect(alertsFor(all, { routeId: 'B48' }).map(a => a.id))
      .toEqual(['route', 'stop', 'agency'])
  })

  it('drops it from a different line', () => {
    expect(alertsFor(all, { routeId: 'B62' }).map(a => a.id)).toEqual(['agency'])
  })

  it('lets a route match stand when the caller named no stop', () => {
    // MTA scopes nearly every subway alert to a route *and* a stop. A route
    // heading knows its route and nothing about stops; letting the
    // unanswerable half veto stripped the badge off every line.
    const routeAndStop = alert({
      id: 'nyc',
      informedEntities: [{ agencyId: 'MTASBWY', routeId: 'N', stopId: 'R09' }],
    })

    expect(alertsFor([routeAndStop], { routeId: 'N' }).map(a => a.id)).toEqual(['nyc'])
  })

  it('honours a stop constraint on a route-scoped alert', () => {
    expect(alertsFor(all, { routeId: 'B48', stopId: 'S1' }).map(a => a.id))
      .toEqual(['route', 'stop', 'agency'])
    expect(alertsFor(all, { routeId: 'B48', stopId: 'S2' }).map(a => a.id))
      .toEqual(['route', 'agency'])
  })

  it('reaches a run only when the caller asked about that run', () => {
    expect(alertsFor(all, { tripId: 'T9' }).map(a => a.id)).toEqual(['agency', 'trip'])
    expect(alertsFor(all, { routeId: 'B48' }).map(a => a.id)).not.toContain('trip')
  })
})
