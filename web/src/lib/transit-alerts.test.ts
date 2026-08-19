import { describe, it, expect } from 'vitest'
import {
  alertRank,
  alertTone,
  alertEffectKey,
  alertStart,
  alertEnd,
  isUpcoming,
  worstAlert,
  sortAlerts,
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

describe('worstAlert and sortAlerts', () => {
  const info = alert({ id: 'info', severity: 'INFO', effect: 'OTHER_EFFECT' })
  const detour = alert({ id: 'detour', severity: 'WARNING' })
  const suspended = alert({ id: 'suspended', severity: 'SEVERE', effect: 'NO_SERVICE' })

  it('picks the alert a single badge should stand for', () => {
    expect(worstAlert([info, suspended, detour])?.id).toBe('suspended')
  })

  it('has nothing to stand for in an empty set', () => {
    expect(worstAlert([])).toBeNull()
  })

  it('sorts worst first without mutating the input', () => {
    const input = [info, detour, suspended]

    expect(sortAlerts(input).map(a => a.id)).toEqual(['suspended', 'detour', 'info'])
    expect(input.map(a => a.id)).toEqual(['info', 'detour', 'suspended'])
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
