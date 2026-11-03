import { describe, expect, test } from 'vitest'
import { laterRuns } from './later-runs'

const MIN = 60_000
const run = (minutes: number, lineName = '4') => ({ departureMs: minutes * MIN, lineName })

describe('laterRuns', () => {
  test('keeps the next two after the planned run', () => {
    expect(laterRuns([run(10), run(14), run(19), run(25)], 10 * MIN)).toEqual([run(14), run(19)])
  })

  test('drops the planned run when realtime has nudged it', () => {
    expect(laterRuns([run(10.5), run(14, '5')], 10 * MIN)).toEqual([run(14, '5')])
  })

  test('is empty when nothing runs later', () => {
    expect(laterRuns([run(10)], 10 * MIN)).toEqual([])
  })
})
