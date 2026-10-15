import { describe, test, expect } from 'bun:test'
import {
  ROUTE_SERVICE_BOARD_EVENTS,
  routesServingStop,
  servedRouteOptions,
} from './route-options'

const T = Date.parse('2026-10-15T19:00:00Z')
const at = (min: number) => new Date(T + min * 60_000).toISOString()
const run = (shortName: string, min: number, directionId = '0') => ({
  route: { shortName },
  directionId,
  departureTime: at(min),
})
const window = { fromMs: T - 20 * 60_000, toMs: T + 20 * 60_000 }

describe('routesServingStop', () => {
  test('names the lines departing inside the window', () => {
    const boards = [{ departures: [run('D', 2), run('N', 5), run('R', 8), run('W', 90)] }]
    expect(routesServingStop(boards, window, 'R')).toEqual(new Set(['D', 'N', 'R']))
  })

  test('ignores runs the other way and cancelled ones', () => {
    const boards = [{
      departures: [run('R', 1), run('N', 3, '1'), { ...run('D', 4), cancelled: true }],
    }]
    expect(routesServingStop(boards, window, 'R', '0')).toEqual(new Set(['R']))
  })

  test('is no evidence when the ridden line is absent from its own stop', () => {
    expect(routesServingStop([{ departures: [run('N', 2)] }], window, 'R')).toBeNull()
  })

  test('is no evidence when a board hit the event cap', () => {
    const full = Array.from({ length: ROUTE_SERVICE_BOARD_EVENTS }, (_, i) => run('R', i % 10))
    expect(routesServingStop([{ departures: full }], window, 'R')).toBeNull()
  })

  test('is no evidence without boards', () => {
    expect(routesServingStop(null, window, 'R')).toBeNull()
    expect(routesServingStop([], window, 'R')).toBeNull()
  })
})

describe('servedRouteOptions', () => {
  const options = ['D', 'N', 'R', 'W'].map((shortName) => ({ shortName }))

  test('keeps only lines serving both ends (Atlantic Av → Union St by day)', () => {
    const atlantic = new Set(['D', 'N', 'R'])
    const unionSt = new Set(['R'])
    expect(servedRouteOptions(options, 'R', [atlantic, unionSt]).map((o) => o.shortName)).toEqual(['R'])
  })

  test('a stop without evidence does not narrow the set', () => {
    const atlantic = new Set(['D', 'N', 'R'])
    expect(servedRouteOptions(options, 'R', [atlantic, null]).map((o) => o.shortName)).toEqual([
      'D',
      'N',
      'R',
    ])
  })

  test('always keeps the ridden line', () => {
    expect(servedRouteOptions(options, 'W', [new Set(['R']), new Set(['R'])]).map((o) => o.shortName))
      .toEqual(['R', 'W'])
  })
})
