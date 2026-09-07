/**
 * Tests for the "is this line running here" judgement.
 *
 * The anchors are the real boards that produced the bug: the R at 03:20, whose
 * timeline alternated served and skipped down the length of Manhattan because
 * quiet stops' boards reached past dawn and busy ones reached minutes.
 */

import { describe, test, expect } from 'bun:test'
import {
  routesRunningAt,
  MIN_HORIZON_MINUTES,
  SERVICE_WINDOW_MINUTES,
} from './service-window'

const NOW = Date.parse('2026-09-07T07:20:00Z')
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()

const run = (routeId: string, minutes: number) => ({
  route: { id: routeId },
  departureTime: at(minutes),
})

/** A board cut off by the event count, so it is silent past its last run. */
const truncated = (departures: ReturnType<typeof run>[]) => ({
  departures,
  hasMore: true,
})

describe('routesRunningAt', () => {
  test('names the lines with a run inside the window', () => {
    const ids = routesRunningAt([truncated([run('N', 4), run('Q', 11), run('R', 60)])], NOW)
    expect(ids).toEqual(['N', 'Q', 'R'])
  })

  test('ignores runs past the window, however far the board reaches', () => {
    // Prince St at 03:20: two lines, so 150 events run past dawn and the R's
    // 06:00 departure is on the board. It is not service now.
    const ids = routesRunningAt(
      [truncated([run('N', 8), run('R', 160), run('W', 200)])],
      NOW,
    )
    expect(ids).toEqual(['N'])
  })

  test('answers nothing when the board is too short to have looked', () => {
    // Times Sq at rush hour with too small a page: 13 minutes of runs. The R
    // being absent from that is not evidence that the R has stopped calling.
    const ids = routesRunningAt(
      [truncated([run('N', 2), run('Q', 5), run('1', 13)])],
      NOW,
    )
    expect(ids).toBeNull()
  })

  test('is limited by the shortest board of a complex', () => {
    // The BMT platforms are cut off at 25 minutes while the IRT reaches an
    // hour. A line absent from both is only unheard-of for 25 minutes, and the
    // one due at 40 is past what the complex can vouch for.
    const ids = routesRunningAt(
      [
        truncated([run('N', 5), run('Q', 25)]),
        truncated([run('1', 3), run('2', 40), run('3', 60)]),
      ],
      NOW,
    )
    expect(ids).toEqual(['N', 'Q', '1'])
  })

  test('an empty board neither names a line nor shortens the horizon', () => {
    // The 42 St shuttle is asleep at 03:20. That must not make the rest of the
    // complex unanswerable.
    const ids = routesRunningAt(
      [truncated([run('N', 9), run('R', 200)]), { departures: [], hasMore: true }],
      NOW,
    )
    expect(ids).toEqual(['N'])
  })

  test('every board empty is an answer: nothing departs here', () => {
    expect(routesRunningAt([{ departures: [], hasMore: true }], NOW)).toEqual([])
    expect(routesRunningAt([], NOW)).toEqual([])
  })

  test('a board with room to spare is complete, not truncated', () => {
    // hasMore false means the timetable had nothing more, so silence past the
    // last run is real silence — no horizon to respect.
    const ids = routesRunningAt(
      [{ departures: [run('5', 3)], hasMore: false }],
      NOW,
    )
    expect(ids).toEqual(['5'])
  })

  test('keeps a line whose departure time is unreadable', () => {
    const ids = routesRunningAt(
      [truncated([run('N', 30), { route: { id: 'W' }, departureTime: 'not a time' }])],
      NOW,
    )
    expect(ids).toEqual(['N', 'W'])
  })

  test('the horizon floor sits inside the window', () => {
    expect(MIN_HORIZON_MINUTES).toBeLessThan(SERVICE_WINDOW_MINUTES)
  })
})
