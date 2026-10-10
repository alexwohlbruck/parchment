import { describe, expect, test } from 'vitest'
import { powerInstance, powerNetwork, type PowerPlacement } from './power'
import { project, unproject, type ObjectInstance } from './object-layer'
import { METRES_PER_DEGREE, measure } from './tile-lines'
import STRUCTURES from './power-structures.json'

const ORIGIN = [-80.84, 35.2]
const LNG_METRES = METRES_PER_DEGREE * Math.cos((ORIGIN[1] * Math.PI) / 180)
const at = (east: number, north: number) => [ORIGIN[0] + east / LNG_METRES, ORIGIN[1] + north / METRES_PER_DEGREE]

const line = (coordinates: number[][], kind = 'power_line', tile = {}) =>
  ({ id: 7, properties: { kind }, geometry: { type: 'LineString', coordinates }, ...tile })

const placed = (features: any[]) => [...powerNetwork(features).values()].flat()
const isConductor = (p: PowerPlacement) => 'length' in p

/** Where the layer draws a point `along` its model's x and `side` across it, in metres, as lng/lat. */
function drawn(instance: ObjectInstance, along: number, side: number): number[] {
  const o = { x: 0, y: 0, z: 0, perMetre: 0 }
  project(instance.lng, instance.lat, 0, o)
  const [c, s] = [Math.cos(instance.heading), Math.sin(instance.heading)]
  return unproject(o.x + (along * c + side * s) * o.perMetre, o.y + (along * s - side * c) * o.perMetre)
}

describe('power lines', () => {
  const bend = line([at(0, 0), at(300, 0), at(300, 300), at(300, 340)])

  test('every conductor ends on a crossarm of the structure it hangs from', () => {
    const all = placed([bend]).map(powerInstance)
    const tips = all
      .filter(i => i.length === undefined)
      .flatMap(i => STRUCTURES[i.model as keyof typeof STRUCTURES].phases.map(([height, side]) => ({ at: drawn(i, 0, side), height })))
    const conductors = all.filter(i => i.length !== undefined)
    expect(conductors.length).toBeGreaterThan(0)
    for (const c of conductors)
      for (const end of [-1, 1]) {
        const point = drawn(c, (end * c.length!) / 2, 0)
        const height = c.height + (end * c.rise!) / 2
        const tip = tips.find(t => measure(t.at, point).length < 0.05 && Math.abs(t.height - height) < 0.01)
        expect(tip, `${c.model} end ${end}`).toBeDefined()
      }
  })

  test('a tower at a bend turns halfway between its spans', () => {
    const corner = placed([bend]).find(p => !isConductor(p) && measure([p.lng, p.lat], at(300, 0)).length < 0.01)!
    expect(corner.model).toBe('power-tower')
    expect(corner.bearing).toBeCloseTo(45, 6)
  })

  test('spans as short as a substation\'s are held by gantries and strung taut', () => {
    const yard = placed([line([at(0, 0), at(30, 0), at(60, 10)])])
    expect(new Set(yard.filter(p => !isConductor(p)).map(p => p.model))).toEqual(new Set(['power-portal']))
    expect(new Set(yard.filter(isConductor).map(p => p.model))).toEqual(new Set(['power-busbar']))
  })

  test('a minor line stands on poles', () => {
    const street = placed([line([at(0, 0), at(40, 0)], 'power_minor_line')])
    expect(new Set(street.map(p => p.model))).toEqual(new Set(['power-pole', 'pole-conductor']))
  })

  test('a span cut by a tile edge is strung once, whole, by the tile its first tower is in', () => {
    const n = 2 ** 16
    const x = Math.floor(((ORIGIN[0] + 180) / 360) * n)
    const y = Math.floor(((1 - Math.log(Math.tan(Math.PI / 4 + (ORIGIN[1] * Math.PI) / 360)) / Math.PI) / 2) * n)
    const edge = ((x + 1) / n) * 360 - 180
    const past = (metres: number) => [edge + metres / LNG_METRES, ORIGIN[1]]
    const west = line([past(-400), past(-100), past(8)], 'power_line', { _z: 16, _x: x, _y: y })
    const east = line([past(-8), past(150)], 'power_line', { _z: 16, _x: x + 1, _y: y })

    const network = powerNetwork([west, east])
    const conductors = [...network.values()].flat().filter(isConductor)
    const phases = STRUCTURES['power-tower'].phases.length
    expect(conductors).toHaveLength(2 * phases)
    for (const c of conductors) expect(c.length).toBeGreaterThan(249)
    expect(network.get(`7/16/${x}/${y}`)!.filter(isConductor)).toHaveLength(2 * phases)
    expect(network.get(`7/16/${x + 1}/${y}`)!.map(p => p.model)).toEqual(['power-tower'])
  })

})
