// Ground truth → what a phone reports: correlated position error, wandering
// accuracy, dropouts, bad fixes, noisy speed and course.

import { projectLatLng } from '@/lib/map/movement-interpolation'
import type { GpxPoint } from './gpx-parser'

export interface FixModel {
  intervalMs: number
  /** Steady-state position error, metres (1σ per axis). */
  sigma: number
  /** Correlation time of the error, seconds. */
  correlationSec: number
  latencyMs: number
  dropoutChance: number
  spikeChance: number
}

export const REALISTIC_FIX_MODEL: FixModel = {
  intervalMs: 1000,
  sigma: 4,
  correlationSec: 8,
  latencyMs: 300,
  dropoutChance: 0.03,
  spikeChance: 0.02,
}

export interface NoisyFix {
  lat: number
  lng: number
  accuracy: number
  speed: number | null
  heading: number | null
}

/** Deterministic PRNG (mulberry32) so a seeded run replays exactly. */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(random: () => number): number {
  const u = Math.max(1e-12, random())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())
}

export class FixNoise {
  private east = 0
  private north = 0
  private readonly random: () => number

  constructor(
    private readonly model: FixModel,
    seed = 1,
  ) {
    this.random = createRandom(seed)
  }

  /** null when this fix is dropped. */
  next(truth: GpxPoint, dtSec: number): NoisyFix | null {
    const { sigma, correlationSec, dropoutChance, spikeChance } = this.model
    const rho = Math.exp(-dtSec / correlationSec)
    const drive = Math.sqrt(1 - rho * rho) * sigma
    this.east = rho * this.east + drive * gaussian(this.random)
    this.north = rho * this.north + drive * gaussian(this.random)
    if (this.random() < dropoutChance) return null

    const spike = this.random() < spikeChance ? 4 : 1
    const east = this.east + (spike - 1) * sigma * gaussian(this.random)
    const north = this.north + (spike - 1) * sigma * gaussian(this.random)
    const offset = Math.hypot(east, north)
    const bearing = (Math.atan2(east, north) * 180) / Math.PI
    const position = projectLatLng(truth, offset, bearing, 1)

    const speed = Math.max(0, truth.speed + 0.3 * gaussian(this.random))
    return {
      lat: position.lat,
      lng: position.lng,
      accuracy: Math.max(3, sigma * spike * (1.2 + 0.3 * this.random())),
      speed,
      heading: speed > 1 && truth.heading != null ? (truth.heading + 4 * gaussian(this.random) + 360) % 360 : null,
    }
  }
}
