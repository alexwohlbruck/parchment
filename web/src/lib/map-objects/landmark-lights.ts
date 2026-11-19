/**
 * The light a landmark throws on the ground at night: a pool under each of
 * its lamps and each of its lit signs, for the map's lamplight.
 */
import type { GlbPrimitive } from './glb.mjs'
import { isLamp } from './landmarks'
import type { Halo } from './neon-halos'

export const LANDMARK_LIGHT = {
  /** Metres a lamp's pool reaches, and its linear colour. */
  lampReach: 10,
  lampColor: [0.5, 0.36, 0.19],
  /** Metres apart under which a lamp's bulbs are one lamp. */
  lampGrid: 2,
  /** A sign's pool reaches its own half-width, this, and this share of its height over the ground, within metres [min, max]. */
  signReach: 4, signRise: 0.6, minReach: 6, maxReach: 45,
  /** How bright the pool under a sign a metre across is, the metres across at which it is full, and the metres up at which it is half. */
  signLight: 0.5, signFull: 3, signHalf: 20,
  /** More pools than any model's lamps and signs; the rest go without. */
  max: 512,
}

/** Floats per pool: centre in model space, radius in metres, linear colour. As `POOL_FLOATS`. */
const FLOATS = 7

export function landmarkPools(primitives: GlbPrimitive[], halos: Halo[]): Float32Array {
  const L = LANDMARK_LIGHT
  const pools: number[] = []
  for (const p of primitives) {
    // A moving part's vertices are in its node's frame, which a pool does not follow.
    if (!isLamp(p.material) || p.node >= 0) continue
    const cells = new Map<string, [number, number, number, number]>()
    for (let i = 0; i < p.position.length; i += 3) {
      const key = `${Math.floor(p.position[i] / L.lampGrid)},${Math.floor(p.position[i + 2] / L.lampGrid)}`
      const cell = cells.get(key) ?? [0, 0, 0, 0]
      cell[0] += p.position[i]
      cell[1] += p.position[i + 1]
      cell[2] += p.position[i + 2]
      cell[3]++
      cells.set(key, cell)
    }
    for (const [x, y, z, n] of cells.values()) pools.push(x / n, y / n, z / n, L.lampReach, ...L.lampColor)
  }
  for (const h of halos) {
    const half = Math.hypot(...h.u)
    const height = Math.max(h.centre[1], 0)
    const reach = Math.min(L.maxReach, Math.max(L.minReach, half + L.signReach + height * L.signRise))
    const light = L.signLight * h.strength * Math.min(1, (half * 2) / L.signFull) / (1 + height / L.signHalf)
    pools.push(...h.centre, reach, ...h.color.map(c => Math.pow(c, 2.2) * light))
  }
  return new Float32Array(pools.slice(0, L.max * FLOATS))
}
