import { test, expect } from 'bun:test'
import { samplePoints } from './route-sample'

test('samplePoints thins a long line to the limit, keeping both ends', () => {
  const line = Array.from({ length: 1001 }, (_, i) => ({ lat: i, lng: 0 }))
  const sampled = samplePoints(line, 5)
  expect(sampled.map((p) => p.lat)).toEqual([0, 250, 500, 750, 1000])
  expect(samplePoints(line.slice(0, 3), 5)).toHaveLength(3)
})
