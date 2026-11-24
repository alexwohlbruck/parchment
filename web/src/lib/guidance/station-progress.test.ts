import { describe, expect, it } from 'vitest'
import type { GuidanceStep, GuidanceStepType } from '@server/types/station-guidance.types'
import { createRandom } from '@/dev/gpx-simulator/fix-model'
import { syntheticAcceleration } from '@/dev/gpx-simulator/motion-synth'
import { StillnessDetector } from './motion'
import { DEFAULT_STRIDE, Pedometer } from './pedometer'
import type { StationGuideTarget } from './station-guide'
import {
  advanceProgress,
  HPA_PER_METRE,
  progressView,
  startProgress,
  updateProgress,
  type StationProgress,
} from './station-progress'

const step = (type: GuidanceStepType, instruction: string, distance: number, duration: number, levelChange: number | null = null): GuidanceStep => ({
  type, instruction, distance, duration, fromLevel: null, toLevel: null, levelChange, landmark: null, bridged: false, fromVertex: 0, toVertex: 1,
})

const end = { id: 'p', kind: 'platform' as const, name: null, lat: 0, lng: 0, level: -1 }
function guideFor(steps: GuidanceStep[], departureMs: number | null = null, kind: StationGuideTarget['kind'] = 'transfer'): StationGuideTarget {
  const seconds = steps.reduce((sum, s) => sum + s.duration, 0)
  return {
    key: `${kind}:1`, kind, ride: 1, departureMs, spot: 'middle',
    walk: {
      source: 'graph', estimate: false, seconds, uncertaintyS: 10, metres: 0, levels: 1, from: end, to: end,
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, steps,
    },
  }
}

const timesSq = guideFor([
  step('walk', 'Follow signs for the 7', 60, 45),
  step('stairs', 'Take the stairs down to the mezzanine', 10, 15, -1),
  step('platform', 'Walk along the platform', 40, 30),
  step('board', 'Board the 7', 0, 0),
])

const fulton = guideFor([
  step('escalator', 'Take the escalator up', 30, 45, 1),
  step('walk', 'Walk through the passage to the A C', 120, 90),
  step('stairs', 'Take the stairs down to the platform', 12, 15, -1),
  step('platform', 'Walk to the middle of the platform', 30, 25),
  step('board', 'Board the A', 0, 0),
])

const SEA_LEVEL_HPA = 1013.25
const HZ = 50
const READING_SEC = 0.25

/** A rider with a phone, walking a station with no GPS, read the way the guidance store reads its sensors. */
class Rider {
  private readonly pedometer = new Pedometer()
  private readonly stillness = new StillnessDetector()
  private readonly random = createRandom(11)
  private t = 0
  private lastReading = 0
  private altitude = 0
  state: StationProgress

  constructor(
    private readonly guide: StationGuideTarget,
    private readonly sensors: { barometer: boolean; stride?: number } = { barometer: true },
  ) {
    this.state = startProgress(guide, 0)
  }

  walk(metres: number, speed = 1.4) {
    return this.move(metres / speed, speed, 0)
  }

  /** Stairs, walked at `speed`, or an escalator or lift stood on when `speed` is 0. */
  climb(metres: number, seconds: number, speed = 0) {
    return this.move(seconds, speed, metres / seconds)
  }

  stand(seconds: number) {
    return this.move(seconds, 0, 0)
  }

  ride(seconds: number) {
    return this.move(seconds, 12, 0)
  }

  private move(seconds: number, speed: number, climbRate: number) {
    const until = this.t + seconds
    while (this.t < until) {
      this.t += 1 / HZ
      this.altitude += climbRate / HZ
      const sample = { t: this.t, accelWithGravity: syntheticAcceleration(this.t, speed, this.random), rotationRate: { x: 0, y: 0, z: 0 } }
      this.pedometer.push(sample)
      this.stillness.push(sample)
      if (this.t - this.lastReading >= READING_SEC) this.read()
    }
    return this
  }

  private read() {
    const pressure = SEA_LEVEL_HPA - this.altitude * HPA_PER_METRE + 0.02 * (2 * this.random() - 1)
    this.state = updateProgress(this.state, this.guide, {
      nowMs: this.t * 1000,
      steps: this.pedometer.stepsBetween(this.lastReading, this.t),
      stride: this.sensors.stride ?? this.pedometer.stride,
      still: this.stillness.isStill(),
      pressure: this.sensors.barometer ? pressure : null,
    })
    this.lastReading = this.t
  }

  get step() {
    return this.guide.walk.steps[this.state.step].instruction
  }

  get view() {
    return progressView(this.state, this.guide, this.t * 1000)
  }
}

describe('a Times Sq change with no GPS', () => {
  it('reaches the stairs, the platform and the train as the rider does', () => {
    const rider = new Rider(timesSq)
    expect(rider.walk(55).step).toBe('Follow signs for the 7')
    expect(rider.walk(8).step).toBe('Take the stairs down to the mezzanine')
    expect(rider.climb(-5, 10, 0.9).step).toBe('Take the stairs down to the mezzanine')
    expect(rider.walk(6).step).toBe('Walk along the platform')
    expect(rider.walk(30).step).toBe('Walk along the platform')
    expect(rider.walk(12).step).toBe('Board the 7')
    expect(rider.stand(120).state.boarded).toBe(false)
    expect(rider.ride(25).state.boarded).toBe(true)
  })

  it('finds the platform at the foot of the stairs when the stride undercounts the corridor', () => {
    const rider = new Rider(timesSq, { barometer: true, stride: 0.5 })
    rider.walk(62)
    expect(rider.step).toBe('Follow signs for the 7')
    expect(rider.climb(-5, 10, 0.9).walk(6).step).toBe('Walk along the platform')
  })

  it('walks the stairs by stride without a barometer', () => {
    const rider = new Rider(timesSq, { barometer: false })
    expect(rider.walk(62).step).toBe('Take the stairs down to the mezzanine')
    expect(rider.climb(-5, 12, 0.9).step).toBe('Walk along the platform')
    expect(rider.walk(42).step).toBe('Board the 7')
  })

  it('says how far is left on a step it is pacing out', () => {
    const view = new Rider(timesSq).walk(20).view
    expect(view.confidence).toBe('sensed')
    expect(view.advancesInMs).toBeNull()
    expect(view.metresLeft).toBeGreaterThan(35)
    expect(view.metresLeft).toBeLessThan(45)
  })

  it('holds on a corridor while the rider stands in it', () => {
    expect(new Rider(timesSq).walk(20).stand(120).step).toBe('Follow signs for the 7')
  })
})

describe('a Fulton St change with no GPS', () => {
  it('rides the escalator up, walks the passage and takes the stairs down to the platform', () => {
    const rider = new Rider(fulton)
    expect(rider.climb(9, 40).step).toBe('Take the escalator up')
    expect(rider.stand(4).step).toBe('Walk through the passage to the A C')
    expect(rider.walk(100).step).toBe('Walk through the passage to the A C')
    expect(rider.walk(22).step).toBe('Take the stairs down to the platform')
    expect(rider.climb(-6, 12, 0.9).walk(5).step).toBe('Walk to the middle of the platform')
    expect(rider.walk(28).step).toBe('Board the A')
  })

  it('never takes a standing escalator ride for a train', () => {
    expect(new Rider(fulton).climb(30, 90).state.boarded).toBe(false)
  })

  it('times a standing escalator ride without a barometer, and says it is guessing', () => {
    const rider = new Rider(fulton, { barometer: false })
    rider.climb(9, 20)
    expect(rider.view).toMatchObject({ confidence: 'timed', index: 0 })
    expect(rider.climb(9, 50).step).toBe('Walk through the passage to the A C')
    expect(rider.view.confidence).toBe('sensed')
  })
})

describe('without sensors', () => {
  const plain = guideFor([step('walk', 'Follow signs for the 7', 30, 30), step('stairs', 'Take the stairs down', 10, 10, -1), step('board', 'Board the 7', 0, 0)])
  const read = (state: StationProgress, nowMs: number, guide = plain) =>
    updateProgress(state, guide, { nowMs, steps: null, stride: DEFAULT_STRIDE, still: null })

  it('moves on by itself once a step has had half again its time, holding at the last', () => {
    const state = startProgress(plain, 0)
    expect(progressView(state, plain, 0)).toMatchObject({ advancesInMs: 45_000, confidence: 'timed' })
    expect(read(state, 44_000).step).toBe(0)
    expect(read(state, 45_000).step).toBe(1)
    const held = read(state, 600_000)
    expect(held.step).toBe(2)
    expect(progressView(held, plain, 600_000).advancesInMs).toBeNull()
  })

  it('tightens the slack so the steps are done by the departure, never below the expected pace', () => {
    const tight = guideFor(plain.walk.steps, 50_000)
    expect(progressView(startProgress(tight, 0), tight, 0).advancesInMs).toBe(30_000 * (50 / 40))
    const missed = guideFor(plain.walk.steps, 10_000)
    expect(progressView(startProgress(missed, 0), missed, 0).advancesInMs).toBe(30_000)
  })

  it('moves on by hand and finishes after the last step', () => {
    let state = advanceProgress(startProgress(plain, 0), plain, 1000)!
    expect(progressView(state, plain, 1000)).toMatchObject({ index: 1, total: 3, next: { instruction: 'Board the 7' } })
    state = advanceProgress(state, plain, 2000)!
    expect(advanceProgress(state, plain, 3000)).toBeNull()
  })
})
