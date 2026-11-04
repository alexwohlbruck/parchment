import { describe, test, expect } from 'bun:test'
import { expectedMissPenaltySec, missProbability } from './connection-risk'

describe('missProbability', () => {
  test('falls with slack', () => {
    expect([-10, 0, 59, 60, 119, 120, 239, 240, 600].map(missProbability))
      .toEqual([1, 0.5, 0.5, 0.25, 0.25, 0.1, 0.1, 0, 0])
  })
})

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
