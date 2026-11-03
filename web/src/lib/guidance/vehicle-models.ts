// Low-poly vehicles for the navigation puck, generated rather than shipped as
// assets. Metres, x to the right, y forward, z up, wheels on z = 0.

import type { VehicleModel } from './vehicle-indicator'

type Vec3 = [number, number, number]
/** A side-plane point: y forward, z up. */
type Profile = Array<[number, number]>

/** Floats per vertex: position, normal, colour, and whether the colour is the paint. */
export const VERTEX_FLOATS = 10

export interface VehicleMesh {
  vertices: Float32Array
  count: number
  length: number
  width: number
}

const TIRE: Vec3 = [0.05, 0.05, 0.055]
const TRIM: Vec3 = [0.11, 0.115, 0.12]
const GLASS: Vec3 = [0.06, 0.09, 0.13]
const HEADLIGHT: Vec3 = [1, 0.95, 0.8]
const TAILLIGHT: Vec3 = [0.75, 0.04, 0.03]
const SKIN: Vec3 = [0.62, 0.42, 0.3]
const PAINT: Vec3 = [1, 1, 1]

interface Part {
  tris: Vec3[]
  color: Vec3
  paint: boolean
}

class Builder {
  private parts: Part[] = []

  part(color: Vec3, paint = false): Vec3[] {
    const tris: Vec3[] = []
    this.parts.push({ tris, color, paint })
    return tris
  }

  /** Every part is convex, so each face is turned to point away from its part's centre. */
  build(): Float32Array {
    const total = this.parts.reduce((n, p) => n + p.tris.length, 0)
    const out = new Float32Array(total * VERTEX_FLOATS)
    let o = 0
    for (const { tris, color, paint } of this.parts) {
      const centre = [0, 0, 0]
      for (const v of tris) for (let c = 0; c < 3; c++) centre[c] += v[c] / tris.length
      for (let i = 0; i < tris.length; i += 3) {
        let [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]]
        let n = normal(a, b, c)
        const mid = [0, 1, 2].map(k => (a[k] + b[k] + c[k]) / 3 - centre[k])
        if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] < 0) {
          ;[b, c] = [c, b]
          n = [-n[0], -n[1], -n[2]]
        }
        for (const v of [a, b, c]) {
          out.set(v, o)
          out.set(n, o + 3)
          out.set(color, o + 6)
          out[o + 9] = paint ? 1 : 0
          o += VERTEX_FLOATS
        }
      }
    }
    return out
  }
}

function normal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const len = Math.hypot(...n) || 1
  return [n[0] / len, n[1] / len, n[2] / len]
}

function quad(t: Vec3[], a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
  t.push(a, b, c, a, c, d)
}

function fan(t: Vec3[], ring: Vec3[]) {
  const centre = [0, 1, 2].map(k => ring.reduce((s, p) => s + p[k], 0) / ring.length) as Vec3
  for (let i = 0; i < ring.length; i++) t.push(centre, ring[i], ring[(i + 1) % ring.length])
}

/** A convex side profile extruded across the width, narrowing with height as `halfWidth(z)` says. */
function prism(t: Vec3[], profile: Profile, halfWidth: (z: number) => number) {
  span(t, profile, z => -halfWidth(z), halfWidth)
}

function span(t: Vec3[], profile: Profile, x0: (z: number) => number, x1: (z: number) => number) {
  const left = profile.map(([y, z]) => [x0(z), y, z] as Vec3)
  const right = profile.map(([y, z]) => [x1(z), y, z] as Vec3)
  for (let i = 0; i < profile.length; i++) {
    const j = (i + 1) % profile.length
    quad(t, left[i], left[j], right[j], right[i])
  }
  fan(t, left)
  fan(t, right)
}

function box(t: Vec3[], [x0, y0, z0]: Vec3, [x1, y1, z1]: Vec3) {
  span(t, [[y0, z0], [y1, z0], [y1, z1], [y0, z1]], () => x0, () => x1)
}

/** A wheel: a cylinder on the x axis. */
function wheel(t: Vec3[], y: number, radius: number, x0: number, x1: number, sides = 12) {
  const ring = (x: number) =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2
      return [x, y + Math.cos(a) * radius, radius + Math.sin(a) * radius] as Vec3
    })
  const [a, b] = [ring(x0), ring(x1)]
  for (let i = 0; i < sides; i++) quad(t, a[i], a[(i + 1) % sides], b[(i + 1) % sides], b[i])
  fan(t, a)
  fan(t, b)
}

/** A square tube from `a` to `b`, `r` from its axis. */
function beam(t: Vec3[], a: Vec3, b: Vec3, r: number) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const len = Math.hypot(...d) || 1
  const axis = d.map(v => v / len)
  const helper = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const u = normal([0, 0, 0], axis as Vec3, helper as Vec3)
  const w = normal([0, 0, 0], axis as Vec3, u)
  const corner = (p: Vec3, su: number, sw: number): Vec3 => [0, 1, 2].map(k => p[k] + (u[k] * su + w[k] * sw) * r) as Vec3
  const signs = [[1, 1], [-1, 1], [-1, -1], [1, -1]]
  const ra = signs.map(([su, sw]) => corner(a, su, sw))
  const rb = signs.map(([su, sw]) => corner(b, su, sw))
  for (let i = 0; i < 4; i++) quad(t, ra[i], ra[(i + 1) % 4], rb[(i + 1) % 4], rb[i])
  fan(t, ra)
  fan(t, rb)
}

interface CarSpec {
  length: number
  width: number
  wheelBase: number
  wheelRadius: number
  /** The painted lower body's side profile. */
  body: Profile
  /** The glasshouse's profile, and how far in its sides lean at the roofline. */
  cabin: Profile
  tumblehome: number
  /** Where the cabin's roof runs, front to back, and its height. */
  roof: [number, number, number]
  bed?: [number, number]
}

function car(spec: CarSpec): Float32Array {
  const b = new Builder()
  const half = spec.width / 2
  const r = spec.wheelRadius
  box(b.part(TRIM), [-half + 0.12, -spec.length / 2 + 0.35, r * 0.55], [half - 0.12, spec.length / 2 - 0.35, r * 1.2])
  prism(b.part(PAINT, true), spec.body, () => half)
  const cabinBase = Math.min(...spec.cabin.map(p => p[1]))
  const cabinTop = Math.max(...spec.cabin.map(p => p[1]))
  const lean = (z: number) => half - 0.05 - (spec.tumblehome * (z - cabinBase)) / (cabinTop - cabinBase)
  prism(b.part(GLASS), spec.cabin, lean)
  const [roofFront, roofBack, roofZ] = spec.roof
  const roofHalf = lean(cabinTop) - 0.02
  box(b.part(PAINT, true), [-roofHalf, roofBack, roofZ - 0.02], [roofHalf, roofFront, roofZ + 0.06])
  if (spec.bed) {
    const [front, back] = spec.bed
    const top = Math.max(...spec.body.map(p => p[1]))
    box(b.part(TRIM), [-half + 0.1, back + 0.1, top - 0.02], [half - 0.1, front - 0.05, top + 0.01])
    for (const side of [-1, 1])
      box(b.part(PAINT, true), [side < 0 ? -half : half - 0.09, back, top], [side < 0 ? -half + 0.09 : half, front, top + 0.12])
    box(b.part(PAINT, true), [-half, back, top], [half, back + 0.09, top + 0.12])
  }
  for (const y of [spec.wheelBase / 2, -spec.wheelBase / 2])
    for (const side of [-1, 1]) wheel(b.part(TIRE), y, r, side * (half - 0.2), side * (half + 0.02))
  const nose = spec.length / 2
  const lampZ = Math.max(...spec.body.filter(p => p[0] > nose - 0.3).map(p => p[1])) - 0.12
  const tailZ = Math.max(...spec.body.filter(p => p[0] < -nose + 0.3).map(p => p[1])) - 0.14
  for (const side of [-1, 1]) {
    const [x0, x1] = side < 0 ? [-half + 0.08, -half + 0.42] : [half - 0.42, half - 0.08]
    box(b.part(HEADLIGHT), [x0, nose - 0.12, lampZ - 0.1], [x1, nose + 0.01, lampZ])
    box(b.part(TAILLIGHT), [x0, -nose - 0.01, tailZ - 0.12], [x1, -nose + 0.1, tailZ])
  }
  return b.build()
}

function bike(): Float32Array {
  const b = new Builder()
  const r = 0.34
  const rear: Vec3 = [0, -0.52, r]
  const front: Vec3 = [0, 0.52, r]
  for (const hub of [rear, front]) {
    const rim = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2
      return [0, hub[1] + Math.cos(a) * (r - 0.032), r + Math.sin(a) * (r - 0.032)] as Vec3
    })
    rim.forEach((p, i) => beam(b.part(TIRE), p, rim[(i + 1) % rim.length], 0.032))
    beam(b.part(TRIM), [-0.04, hub[1], r], [0.04, hub[1], r], 0.04)
  }
  const crank: Vec3 = [0, -0.04, 0.3]
  const seat: Vec3 = [0, -0.2, 0.86]
  const head: Vec3 = [0, 0.36, 0.86]
  for (const [a, c] of [[crank, seat], [crank, head], [seat, head], [crank, rear], [seat, rear], [head, front]] as Array<[Vec3, Vec3]>)
    beam(b.part(PAINT, true), a, c, 0.025)
  beam(b.part(TRIM), [-0.26, 0.4, 0.96], [0.26, 0.4, 0.96], 0.02)
  beam(b.part(TRIM), head, [0, 0.4, 0.96], 0.022)
  box(b.part(TRIM), [-0.07, -0.33, 0.88], [0.07, -0.12, 0.93])
  const hip: Vec3 = [0, -0.2, 1.0]
  const shoulder: Vec3 = [0, 0.18, 1.42]
  beam(b.part(PAINT, true), hip, shoulder, 0.14)
  box(b.part(TRIM), [-0.11, 0.2, 1.5], [0.11, 0.44, 1.7])
  for (const side of [-1, 1]) {
    beam(b.part(PAINT, true), [side * 0.17, 0.2, 1.4], [side * 0.24, 0.4, 0.98], 0.045)
    beam(b.part(TRIM), [side * 0.09, -0.18, 0.98], [side * 0.12, 0.12, 0.66], 0.06)
    beam(b.part(SKIN), [side * 0.12, 0.12, 0.66], [side * 0.11, -0.04, 0.3], 0.045)
  }
  return b.build()
}

const SPECS: Record<Exclude<VehicleModel, 'bike'>, CarSpec> = {
  hatchback: {
    length: 4.0,
    width: 1.76,
    wheelBase: 2.5,
    wheelRadius: 0.32,
    body: [[-2.0, 0.28], [2.0, 0.28], [2.02, 0.62], [1.8, 0.86], [0.8, 0.96], [-1.94, 0.98], [-2.03, 0.62]],
    cabin: [[0.85, 0.94], [0.05, 1.44], [-1.55, 1.46], [-1.95, 0.96]],
    tumblehome: 0.16,
    roof: [0.02, -1.55, 1.44],
  },
  suv: {
    length: 4.6,
    width: 1.9,
    wheelBase: 2.8,
    wheelRadius: 0.38,
    body: [[-2.28, 0.36], [2.28, 0.36], [2.32, 0.78], [2.1, 1.04], [1.05, 1.14], [-2.25, 1.14], [-2.32, 0.78]],
    cabin: [[1.1, 1.12], [0.35, 1.68], [-2.05, 1.7], [-2.24, 1.14]],
    tumblehome: 0.12,
    roof: [0.3, -2.05, 1.69],
  },
  pickup: {
    length: 5.3,
    width: 2.0,
    wheelBase: 3.4,
    wheelRadius: 0.4,
    body: [[-2.62, 0.4], [2.62, 0.4], [2.66, 0.86], [2.45, 1.1], [1.2, 1.18], [-2.62, 1.18], [-2.66, 0.86]],
    cabin: [[1.25, 1.16], [0.55, 1.78], [-0.75, 1.8], [-0.88, 1.18]],
    tumblehome: 0.1,
    roof: [0.5, -0.75, 1.79],
    bed: [-0.95, -2.64],
  },
}

const cache = new Map<VehicleModel, VehicleMesh>()

export function vehicleMesh(model: VehicleModel): VehicleMesh {
  let mesh = cache.get(model)
  if (!mesh) {
    const vertices = model === 'bike' ? bike() : car(SPECS[model])
    const length = model === 'bike' ? 1.72 : SPECS[model].length
    const width = model === 'bike' ? 0.6 : SPECS[model].width
    mesh = { vertices, count: vertices.length / VERTEX_FLOATS, length, width }
    cache.set(model, mesh)
  }
  return mesh
}
