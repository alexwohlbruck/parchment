import { describe, expect, test } from 'bun:test'
import { sameRun } from './same-run'

describe('sameRun', () => {
  test('matches a vehicle by the trip id inside the timetable id', () => {
    expect(sameRun('20261015_19:00_5_A123', '5_A123')).toBe(true)
    expect(sameRun('20261015_19:00_5_A123', '5_A12')).toBe(false)
  })

  test('matches a subway train that drops the shape suffix', () => {
    expect(sameRun('20261126_09:05_5_054550_A..S57R', '5_054550_A..S')).toBe(true)
    expect(sameRun('054550_A..S57R', '054550_A..S')).toBe(true)
    expect(sameRun('20261126_09:05_5_054550_A..S57R', '5_054550_A..N')).toBe(false)
    expect(sameRun('20261126_09:05_5_054550_A..S57R', '5_054600_A..S')).toBe(false)
  })
})
