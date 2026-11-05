import { describe, test, expect } from 'bun:test'
import { expectedMissPenaltySec } from './connection-risk'

describe('expectedMissPenaltySec', () => {
  test('weights each transfer by what missing it costs', () => {
    expect(expectedMissPenaltySec([
      { slackSec: 30, missDelaySec: 600 },
      { slackSec: 200, missDelaySec: 300 },
      { slackSec: 900, missDelaySec: 1200 },
    ])).toBe(330)
  })

  test('is zero without transfers', () => {
    expect(expectedMissPenaltySec([])).toBe(0)
  })
})
