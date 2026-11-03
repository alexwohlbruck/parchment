import { describe, expect, test } from 'vitest'
import { createRandom } from '@/dev/gpx-simulator/fix-model'
import { syntheticAcceleration } from '@/dev/gpx-simulator/motion-synth'
import { DEFAULT_STRIDE, Pedometer } from './pedometer'

function feed(pedometer: Pedometer, from: number, to: number, speed: number, hz = 50) {
  const random = createRandom(5)
  for (let t = from; t < to; t += 1 / hz) {
    pedometer.push({ t, accelWithGravity: syntheticAcceleration(t, speed, random), rotationRate: { x: 0, y: 0, z: 0 } })
  }
}

describe('Pedometer', () => {
  test('counts a steady walk step for step', () => {
    const pedometer = new Pedometer()
    feed(pedometer, 0, 30, 1.4)
    expect(Math.abs(pedometer.stepsBetween(0, 30) - 60)).toBeLessThanOrEqual(2)
    expect(pedometer.cadence(30)).toBeCloseTo(2, 1)
    expect(pedometer.speed(30)).toBeCloseTo(2 * DEFAULT_STRIDE, 1)
  })

  test('counts at a coarser sampling rate too', () => {
    const pedometer = new Pedometer()
    feed(pedometer, 0, 30, 1.4, 20)
    expect(Math.abs(pedometer.stepsBetween(0, 30) - 60)).toBeLessThanOrEqual(3)
  })

  test('senses no walk standing still or shaken in a vehicle', () => {
    const standing = new Pedometer()
    feed(standing, 0, 20, 0)
    expect(standing.stepsBetween(0, 20)).toBe(0)
    const riding = new Pedometer()
    feed(riding, 0, 20, 12)
    expect(riding.cadence(20)).toBeNull()
  })

  test('stops reporting a walk soon after the steps stop', () => {
    const pedometer = new Pedometer()
    feed(pedometer, 0, 10, 1.4)
    feed(pedometer, 10, 14, 0)
    expect(pedometer.speed(14)).toBeNull()
  })

  test('learns the stride from distance walked, ignoring absurd ones', () => {
    const pedometer = new Pedometer()
    pedometer.learnStride(80, 100)
    expect(pedometer.stride).toBeGreaterThan(DEFAULT_STRIDE)
    const learned = pedometer.stride
    pedometer.learnStride(300, 100)
    pedometer.learnStride(5, 4)
    expect(pedometer.stride).toBe(learned)
  })
})
