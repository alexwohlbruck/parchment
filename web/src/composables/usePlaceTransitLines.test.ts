/**
 * A bullet at a station says three things: which line, in what order, and
 * whether it is running. The third one is new, and it is the one that can
 * lie — so the rule is stated here: dim only what the board could judge.
 */
import { describe, test, expect, beforeEach } from 'vitest'
import { computed, ref } from 'vue'
import {
  setPlaceTransitLines,
  usePlaceTransitLines,
  usePlaceTransitLinesContext,
} from './usePlaceTransitLines'

const LINES = [
  { id: '1', shortName: '1', color: 'D82233' },
  { id: 'B', shortName: 'B', color: 'EB6800' },
  { id: 'A', shortName: 'A', color: '0062CF' },
]

let seq = 0
let place: ReturnType<typeof ref<string>>

beforeEach(() => {
  place = ref(`place-${++seq}`)
})

const lines = () => usePlaceTransitLines(computed(() => place.value)).value
const ctx = () => usePlaceTransitLinesContext(computed(() => place.value)).value

describe('the header’s line bullets', () => {
  test('come out in portolan’s order, not the order they arrived', () => {
    setPlaceTransitLines(place.value, LINES)
    // letter groups before number groups, by colour — as the map draws it
    expect(lines().map(l => l.id)).toEqual(['A', 'B', '1'])
  })

  test('a line with a run on the board is in service', () => {
    setPlaceTransitLines(place.value, LINES, { runningRouteIds: ['A', '1'] })
    expect(lines().map(l => [l.id, l.inService])).toEqual([
      ['A', true],
      ['B', false],
      ['1', true],
    ])
  })

  test('an empty board dims nothing — absence is not evidence', () => {
    // no departures at all is a board that failed or a stop with no data,
    // and neither says the lines stopped running
    setPlaceTransitLines(place.value, LINES, { runningRouteIds: [] })
    expect(lines().every(l => l.inService)).toBe(true)
    expect(ctx().known).toBe(false)
  })

  test('publishing without any context leaves every line in service', () => {
    setPlaceTransitLines(place.value, LINES)
    expect(lines().every(l => l.inService)).toBe(true)
  })

  test('carries the feed and window the board used', () => {
    setPlaceTransitLines(place.value, LINES, {
      feedId: 'f-mta',
      windowMinutes: 90,
      runningRouteIds: ['A'],
    })
    expect(ctx()).toEqual({ feedId: 'f-mta', windowMinutes: 90, known: true })
  })

  test('an unknown place has no lines and no context', () => {
    expect(lines()).toEqual([])
    expect(ctx().known).toBe(false)
    expect(ctx().feedId).toBeUndefined()
  })

  test('a later publish replaces the earlier one', () => {
    setPlaceTransitLines(place.value, LINES, { runningRouteIds: ['A', 'B', '1'] })
    expect(lines().every(l => l.inService)).toBe(true)
    setPlaceTransitLines(place.value, LINES, { runningRouteIds: ['A'] })
    expect(lines().filter(l => l.inService).map(l => l.id)).toEqual(['A'])
  })
})
