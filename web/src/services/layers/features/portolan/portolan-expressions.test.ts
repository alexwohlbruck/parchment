/**
 * Unit tests for the portolan expression/predicate logic.
 *
 * The acts encoding is the load-bearing piece: 7 days x 6 hex digits,
 * Monday first, each day a big-endian 24-bit word with hour 0 at the
 * LSB. actsFilterExpr (a MapLibre filter) and maskActive (the JS
 * predicate) must read the SAME bit for the same instant, so the tests
 * pin hand-computed positions and then cross-check the two against each
 * other over every hour of the week.
 */

import { describe, test, expect } from 'vitest'
import { cssFontFor } from './portolan-images'
import { ribbonColorWithAlpha } from './portolan-expressions'
import {
  ACTS_MAX_ROUTES,
  BANDS,
  HEX_BIT,
  actsFilterExpr,
  actsSlot,
  activeRouteIdx,
  bandForZoom,
  bulletIdsOf,
  classFilterExpr,
  composeFilter,
  maskActive,
  modeExprs,
  stationVisible,
} from './portolan-expressions'

/** Build a 42-char weekly mask with exactly the given (day, hour) bits
 *  set — day 0 = Monday, hour 0 at the LSB of the day's 24-bit word. */
function maskWith(...slots: [number, number][]): string {
  const days = Array.from({ length: 7 }, () => 0)
  for (const [day, hour] of slots) days[day] |= 1 << hour
  return days.map(d => d.toString(16).padStart(6, '0')).join('')
}

/** A local Date pinned to a weekday (0=Monday) and hour. 2026-08-17 is a
 *  Monday, so day d falls on the 17th + d. */
const at = (day: number, hour: number) => new Date(2026, 7, 17 + day, hour, 30)

describe('maskActive', () => {
  test('reads the hand-placed bit and nothing else', () => {
    const mask = maskWith([0, 0], [2, 23], [6, 5])
    expect(maskActive(mask, 0, 0)).toBe(true)
    expect(maskActive(mask, 2, 23)).toBe(true)
    expect(maskActive(mask, 6, 5)).toBe(true)
    expect(maskActive(mask, 0, 1)).toBe(false)
    expect(maskActive(mask, 1, 0)).toBe(false)
    expect(maskActive(mask, 2, 22)).toBe(false)
  })
})

describe('actsSlot', () => {
  test('Monday 00:00 → digit 5 (last digit of day 0), bit 0', () => {
    expect(actsSlot(at(0, 0))).toEqual({ digit: 5, hexDigits: HEX_BIT[0] })
  })

  test('Monday 23:00 → digit 0 (top of the big-endian word), bit 3', () => {
    expect(actsSlot(at(0, 23))).toEqual({ digit: 0, hexDigits: HEX_BIT[3] })
  })

  test('Sunday 12:00 → day 6, digit 6*6 + (5-3) = 38, bit 0', () => {
    expect(actsSlot(at(6, 12))).toEqual({ digit: 38, hexDigits: HEX_BIT[0] })
  })

  test('agrees with maskActive for every hour of the week', () => {
    // one route active exactly at (day, hour): the filter's digit/bit
    // must find that mask's set digit, and only that one
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const mask = maskWith([day, hour])
        const { digit, hexDigits } = actsSlot(at(day, hour))
        expect(hexDigits).toContain(mask[digit])
        // and the same slot in an empty-except-elsewhere mask misses
        const other = maskWith([day, (hour + 1) % 24])
        expect(maskActive(other, day, hour)).toBe(false)
        expect(hexDigits.includes(other[digit])).toBe(false)
      }
    }
  })
})

/** Evaluate the actsFilterExpr shape against a feature's acts string —
 *  a tiny interpreter for exactly the expression actsFilterExpr builds,
 *  so the fan-out arithmetic (stride 43, out-of-range slices) is tested
 *  without a live style. */
function evalActsFilter(expr: any, acts: string): boolean {
  // ['case', ['==', acts, ''], true, ['any', ...tests]]
  if (acts === '') return true
  const tests: any[] = expr[3].slice(1)
  return tests.some(t => {
    // ['match', ['slice', actsExpr, at, at+1], hexDigits, true, false]
    const [, sliceExpr, labels] = t
    const from = sliceExpr[2]
    const ch = acts.slice(from, from + 1)
    return labels.includes(ch)
  })
}

describe('actsFilterExpr', () => {
  test('null for no time or an invalid date', () => {
    expect(actsFilterExpr(null)).toBeNull()
    expect(actsFilterExpr(new Date('nope'))).toBeNull()
  })

  test('empty acts renders always-active', () => {
    const expr = actsFilterExpr(at(0, 0))!
    expect(evalActsFilter(expr, '')).toBe(true)
  })

  test('single-route feature matches its own mask', () => {
    const expr = actsFilterExpr(at(1, 9))! // Tuesday 09:00
    expect(evalActsFilter(expr, maskWith([1, 9]))).toBe(true)
    expect(evalActsFilter(expr, maskWith([1, 10]))).toBe(false)
    expect(evalActsFilter(expr, maskWith([2, 9]))).toBe(false)
  })

  test('any awake route slot at stride 43 wins', () => {
    const expr = actsFilterExpr(at(4, 22))! // Friday 22:00
    const asleep = maskWith([0, 0])
    const awake = maskWith([4, 22])
    expect(evalActsFilter(expr, [asleep, asleep, awake].join(';'))).toBe(true)
    expect(evalActsFilter(expr, [asleep, asleep, asleep].join(';'))).toBe(false)
  })

  test('slots beyond the route count are inert', () => {
    const expr = actsFilterExpr(at(0, 0))!
    const tests: any[] = expr[3].slice(1)
    expect(tests).toHaveLength(ACTS_MAX_ROUTES)
    // a one-route feature: slot 15's slice lands beyond the string
    expect(evalActsFilter(expr, maskWith([0, 12]))).toBe(false)
  })
})

describe('bandForZoom', () => {
  test('exactly one band per zoom, boundaries inclusive-low', () => {
    expect(bandForZoom(0)).toBe(0)
    expect(bandForZoom(12.99)).toBe(0)
    expect(bandForZoom(13)).toBe(13)
    expect(bandForZoom(13.5)).toBe(13)
    expect(bandForZoom(14)).toBe(14)
    expect(bandForZoom(15)).toBe(15)
    expect(bandForZoom(22)).toBe(15)
  })

  test('band zoom ranges tile the whole range without overlap', () => {
    const sorted = [...BANDS].sort((a, b) => a.min - b.min)
    expect(sorted[0].min).toBe(0)
    expect(sorted[sorted.length - 1].max).toBe(24)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].min).toBe(sorted[i - 1].max)
    }
  })
})

describe('class filter composition', () => {
  test('no classes off → no clause; structural filter survives alone', () => {
    expect(classFilterExpr(new Set())).toBeNull()
    const structural = ['==', ['get', 'kind'], 'steady']
    expect(composeFilter(structural, [])).toBe(structural)
  })

  test('clauses AND onto the structural filter losslessly', () => {
    const structural = ['==', ['get', 'kind'], 'steady']
    const cls = classFilterExpr(new Set(['bus', 'ferry']))!
    expect(cls).toEqual(['!', ['in', ['get', 'mode'], ['literal', ['bus', 'ferry']]]])
    expect(composeFilter(structural, [cls])).toEqual(['all', structural, cls])
    // detaching = restoring exactly the structural filter
    expect(composeFilter(structural, [])).toBe(structural)
  })
})

describe('modeExprs', () => {
  test('missing manifest yields literal 1s, not an empty match', () => {
    expect(modeExprs(null)).toEqual({ w: 1, o: 1 })
  })

  test('classes map to their width/opacity with fallback 1', () => {
    const { w, o } = modeExprs({
      modes: { metro: { width: 1.4, opacity: 0.9 }, unknown: { width: 9, opacity: 9 } },
    } as any)
    expect(w).toEqual(['match', ['coalesce', ['get', 'mode'], ''], 'metro', 1.4, 1])
    expect(o).toEqual(['match', ['coalesce', ['get', 'mode'], ''], 'metro', 0.9, 1])
  })
})

describe('stationVisible', () => {
  const props = {
    routes: 'A,B',
    modes: 'metro,bus',
    acts: [maskWith([0, 8]), maskWith([0, 20])].join(';'),
  }

  test('no filters → visible', () => {
    expect(stationVisible(props, {}, null, new Set())).toBe(true)
  })

  test('time hides when every member route sleeps', () => {
    expect(stationVisible(props, {}, at(0, 8), new Set())).toBe(true)
    expect(stationVisible(props, {}, at(0, 20), new Set())).toBe(true)
    expect(stationVisible(props, {}, at(0, 3), new Set())).toBe(false)
  })

  test('class toggle removes that route from consideration', () => {
    // at 20:00 only the bus route is awake; hiding buses hides the stop
    expect(stationVisible(props, {}, at(0, 20), new Set(['bus']))).toBe(false)
    expect(stationVisible(props, {}, at(0, 8), new Set(['bus']))).toBe(true)
  })

  test('a route without acts is always active (honest default)', () => {
    expect(stationVisible({ routes: 'X', modes: 'metro' }, {}, at(3, 3), new Set())).toBe(true)
  })
})

describe('activeRouteIdx', () => {
  const props = {
    routes: 'A,B,C',
    modes: 'metro,metro,bus',
    acts: [maskWith([0, 8]), maskWith([0, 20]), maskWith([0, 8], [0, 20])].join(';'),
  }

  test('null when nothing filters (reuse the original feature)', () => {
    expect(activeRouteIdx(props, {}, null, new Set())).toBeNull()
  })

  test('picks exactly the awake, enabled indices', () => {
    expect(activeRouteIdx(props, {}, at(0, 8), new Set())).toEqual([0, 2])
    expect(activeRouteIdx(props, {}, at(0, 20), new Set())).toEqual([1, 2])
    expect(activeRouteIdx(props, {}, at(0, 8), new Set(['bus']))).toEqual([0])
  })
})

describe('bulletIdsOf', () => {
  test('dedupes, skips regional/bus, folds express variants', () => {
    const ids = bulletIdsOf({
      labels: 'A,A,6,6X,LIRR,42',
      route_colors: '0039a6,0039a6,00933c,00933c,888888,ff6319',
      modes: 'metro,metro,metro,metro,regional,bus',
      shapes: ',,,,,',
    })
    // A dedupes, 6X folds into 6, LIRR is regional, 42 is bus
    expect(ids).toEqual(['blt-0039a6--A', 'blt-00933c--6'])
  })
})

describe('cssFontFor', () => {
  // A row estimate measured in the wrong face reports a wrap that never
  // happens, and the bullet strip drops a line below a one-line name.
  test('splits MapLibre font modifiers into CSS weight and style', () => {
    expect(cssFontFor(['Roboto Condensed Italic'])).toBe(
      'italic 400 100px "Roboto Condensed", Roboto, system-ui, sans-serif',
    )
    expect(cssFontFor(['Roboto Medium'])).toBe(
      '500 100px "Roboto", Roboto, system-ui, sans-serif',
    )
    expect(cssFontFor(['Noto Sans Bold'])).toBe(
      '700 100px "Noto Sans", Roboto, system-ui, sans-serif',
    )
  })

  test('keeps a bare family intact and honours the size', () => {
    expect(cssFontFor(['Inter'], 24)).toBe('400 24px "Inter", Roboto, system-ui, sans-serif')
  })

  test('falls back to the default face when the stack is empty', () => {
    // the fallback NAME is "Roboto Medium", which parses the same way
    // everything else does: family Roboto, weight 500
    expect(cssFontFor([])).toBe('500 100px "Roboto", Roboto, system-ui, sans-serif')
  })
})

describe('ribbonColorWithAlpha', () => {
  // Mapbox drops line-occlusion-opacity the moment line-opacity is
  // data-driven, so the class opacity has to ride in the colour instead.
  test('folds the opacity expression into the alpha channel', () => {
    const modeOpacity = ['match', ['get', 'mode'], 'aerial', 0.75, 1]
    expect(ribbonColorWithAlpha(['get', 'c'], modeOpacity as any)).toEqual([
      'let',
      'c',
      ['to-rgba', ['get', 'c']],
      ['rgba', ['at', 0, ['var', 'c']], ['at', 1, ['var', 'c']], ['at', 2, ['var', 'c']], modeOpacity],
    ])
  })
})
