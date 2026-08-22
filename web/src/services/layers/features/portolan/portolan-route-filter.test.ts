/**
 * The isolated-route filter, evaluated rather than eyeballed.
 *
 * These build the expression and run it through MapLibre's own evaluator
 * against real tile properties, because the thing being asserted is not
 * "the array looks right" — it is "the renderer keeps this segment and
 * drops that one at 3am". An off-by-one in a slice offset is invisible in
 * a snapshot and obvious here.
 */
import { describe, test, expect } from 'vitest'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import {
  actsFilterExpr,
  routeFilterExpr,
  stationServesRoute,
} from './portolan-expressions'

const evaluate = (expr: any, props: Record<string, unknown>) => {
  const compiled = expression.createExpression(expr as any, { type: 'boolean' } as any)
  if (compiled.result !== 'success') {
    throw new Error(`bad expression: ${JSON.stringify((compiled as any).value)}`)
  }
  return compiled.value.evaluate({ zoom: 14 } as any, { properties: props } as any)
}

const ALWAYS = 'f'.repeat(42)
/** Awake only 06:00–21:59, every day — the shape of a daytime-only line. */
const DAYTIME = Array.from({ length: 7 }, () => '3fffc0').join('')
/** Never awake anywhere. */
const NEVER = '0'.repeat(42)

/** A 2/3-style shared segment: both routes on one track. */
const SHARED = {
  routes: '2,3',
  ridx: '2=00;3=01',
  acts: [ALWAYS, DAYTIME].join(';'),
}

const MONDAY_NOON = new Date(2026, 7, 17, 12, 0, 0) // a Monday
const MONDAY_3AM = new Date(2026, 7, 17, 3, 0, 0)

describe('a route filter picks one line off a shared track', () => {
  test('both run at noon', () => {
    expect(evaluate(routeFilterExpr('2', MONDAY_NOON), SHARED)).toBe(true)
    expect(evaluate(routeFilterExpr('3', MONDAY_NOON), SHARED)).toBe(true)
  })

  test('at 3am only the one that runs is kept', () => {
    // this is the case the union test gets wrong: the 2 is awake here, so
    // "any route awake" would draw the 3 down track it does not run
    expect(evaluate(actsFilterExpr(MONDAY_3AM), SHARED)).toBe(true)
    expect(evaluate(routeFilterExpr('2', MONDAY_3AM), SHARED)).toBe(true)
    expect(evaluate(routeFilterExpr('3', MONDAY_3AM), SHARED)).toBe(false)
  })

  test('a route that is not on the segment is never kept', () => {
    expect(evaluate(routeFilterExpr('4', MONDAY_NOON), SHARED)).toBe(false)
  })

  test('with no time set, carrying the route is enough', () => {
    expect(evaluate(routeFilterExpr('3', null), SHARED)).toBe(true)
    expect(evaluate(routeFilterExpr('4', null), SHARED)).toBe(false)
  })
})

describe('the token match is exact', () => {
  const props = { routes: 'AC,E', ridx: 'AC=00;E=01', acts: [ALWAYS, ALWAYS].join(';') }

  test('a route id that is a prefix of another does not borrow its track', () => {
    expect(evaluate(routeFilterExpr('A', MONDAY_NOON), props)).toBe(false)
    expect(evaluate(routeFilterExpr('AC', MONDAY_NOON), props)).toBe(true)
  })

  test('nor does one that is a suffix', () => {
    expect(evaluate(routeFilterExpr('C', MONDAY_NOON), props)).toBe(false)
  })

  test('the slot lookup is anchored too', () => {
    // "E=01" appears inside "AC=07;NE=01" — without the leading ';' the
    // search would find the wrong slot and read another route's hours
    const tricky = {
      routes: 'ACE,NE',
      ridx: 'ACE=00;NE=01',
      acts: [NEVER, ALWAYS].join(';'),
    }
    expect(evaluate(routeFilterExpr('ACE', MONDAY_NOON), tricky)).toBe(false)
    expect(evaluate(routeFilterExpr('NE', MONDAY_NOON), tricky)).toBe(true)
  })
})

describe('slots beyond the first, and tiles without an index', () => {
  test('reads the right mask for a late slot', () => {
    const many = {
      routes: 'a,b,c,d,e,f,g,h,i,j,k',
      ridx: 'a=00;b=01;c=02;d=03;e=04;f=05;g=06;h=07;i=08;j=09;k=10',
      acts: [...Array(10).fill(NEVER), ALWAYS].join(';'),
    }
    // slot 10 is the only awake one — a stride error would read a NEVER
    expect(evaluate(routeFilterExpr('k', MONDAY_NOON), many)).toBe(true)
    expect(evaluate(routeFilterExpr('j', MONDAY_NOON), many)).toBe(false)
  })

  test('a tile predating ridx draws a generous route, not an empty map', () => {
    const old = { routes: '2,3', acts: [ALWAYS, NEVER].join(';') }
    // the union test says yes because the 2 is awake; without an index
    // that is the best answer available, and it errs toward drawing
    expect(evaluate(routeFilterExpr('3', MONDAY_NOON), old)).toBe(true)
    expect(evaluate(routeFilterExpr('9', MONDAY_NOON), old)).toBe(false)
  })

  test('a segment with no calendar at all stays visible', () => {
    const noActs = { routes: '2,3' }
    expect(evaluate(routeFilterExpr('3', MONDAY_3AM), noActs)).toBe(true)
  })
})

/**
 * The stations have to answer the same question as the track, or the map
 * shows a line that stops at platforms it is not reaching.
 */
describe('stations under isolation', () => {
  const FULTON = {
    routes: 'A,C,J',
    // A runs always, C daytime only, J never here
    acts: [ALWAYS, DAYTIME, NEVER].join(';'),
  }

  test('kept when the isolated route is awake there', () => {
    expect(stationServesRoute(FULTON, 'A', {}, MONDAY_3AM)).toBe(true)
    expect(stationServesRoute(FULTON, 'C', {}, MONDAY_NOON)).toBe(true)
  })

  test('dropped when it is that route’s off hours', () => {
    // the C does not run at 3am: its platform label should not float over
    // track the isolated line is not on
    expect(stationServesRoute(FULTON, 'C', {}, MONDAY_3AM)).toBe(false)
    expect(stationServesRoute(FULTON, 'J', {}, MONDAY_NOON)).toBe(false)
  })

  test('a station the route never calls at is never kept', () => {
    expect(stationServesRoute(FULTON, '7', {}, MONDAY_NOON)).toBe(false)
  })

  test('another route’s hours cannot keep it alive', () => {
    // the A is awake at 3am; that is not a reason to draw the C's stop
    expect(stationServesRoute(FULTON, 'A', {}, MONDAY_3AM)).toBe(true)
    expect(stationServesRoute(FULTON, 'C', {}, MONDAY_3AM)).toBe(false)
  })

  test('no calendar for the route means the stop stays', () => {
    // absence of a mask is not absence of service
    expect(stationServesRoute({ routes: 'A,C' }, 'C', {}, MONDAY_3AM)).toBe(true)
    // …and a per-feed mask still gets consulted when the station has none
    expect(stationServesRoute({ routes: 'A,C' }, 'C', { C: NEVER }, MONDAY_3AM)).toBe(false)
  })

  test('with no time set, serving the route is enough', () => {
    expect(stationServesRoute(FULTON, 'J', {}, null)).toBe(true)
  })
})

/**
 * A group pyramid does not use the feed's own route ids. Eleven feeds
 * cannot all own "2", so every feed after the first is prefixed — and the
 * filter has to be built from the token the TILE uses, not the one the
 * departure board sends.
 */
describe('prefixed route ids in a group build', () => {
  const GROUP = {
    routes: 'f3:2,f3:3',
    ridx: 'f3:2=00;f3:3=01',
    acts: [ALWAYS, DAYTIME].join(';'),
  }

  test('the tile token filters exactly, prefix and all', () => {
    expect(evaluate(routeFilterExpr('f3:2', MONDAY_3AM), GROUP)).toBe(true)
    expect(evaluate(routeFilterExpr('f3:3', MONDAY_3AM), GROUP)).toBe(false)
  })

  test('the bare id matches nothing — which is why it had to be resolved', () => {
    expect(evaluate(routeFilterExpr('2', MONDAY_NOON), GROUP)).toBe(false)
  })

  test('one feed’s prefix cannot borrow another’s route', () => {
    expect(evaluate(routeFilterExpr('f4:2', MONDAY_NOON), GROUP)).toBe(false)
  })

  test('a prefixed station answers the same way', () => {
    const station = { routes: 'f3:2,f3:3', acts: [ALWAYS, NEVER].join(';') }
    expect(stationServesRoute(station, 'f3:2', {}, MONDAY_NOON)).toBe(true)
    expect(stationServesRoute(station, 'f3:3', {}, MONDAY_NOON)).toBe(false)
    expect(stationServesRoute(station, '2', {}, MONDAY_NOON)).toBe(false)
  })
})
