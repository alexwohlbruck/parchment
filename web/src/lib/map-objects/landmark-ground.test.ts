import { describe, expect, it } from 'vitest'
import { groundContacts, groundLifts, MAX_CONTACTS, modelGround, type Contact } from './landmark-ground'

/** A sloping site: the raw DEM rises 0.1 m per metre east, from 190 m. */
const dem = (x: number) => 190 + x * 0.1

/**
 * A coaster built the way Barrelman's kit builds one: a column every 4 m
 * along a track 30 m up, each standing on the terrain at its own bent — so
 * 1 m under the DEM less the datum — and track cells between with nothing
 * under them.
 */
function coaster(): { contacts: Contact[]; raw: number[] } {
  const contacts: Contact[] = []
  for (let x = 0; x <= 200; x += 4) {
    contacts.push([x, dem(x) - 190 - 1, 0])
    contacts.push([x + 2, 30, 0])
  }
  return { contacts, raw: contacts.map(([x]) => dem(x)) }
}

/** A building with a flat base at y = 0 on the same slope, and its roof. */
function building(): { contacts: Contact[]; raw: number[] } {
  const contacts: Contact[] = []
  for (let x = 0; x <= 60; x += 2) contacts.push([x, 0, 0], [x, 0, 40])
  for (let x = 10; x <= 50; x += 2) contacts.push([x, 25, 20])
  return { contacts, raw: contacts.map(([x]) => dem(x)) }
}

describe('modelGround', () => {
  it('finds a coaster built over the terrain', () => {
    const { contacts, raw } = coaster()
    const ground = modelGround(contacts, raw, 1)
    expect(ground.follows).toBe(true)
    // Its feet stand 1 m into the ground the kit measured from 190 m.
    if (ground.follows) expect(ground.offset).toBeCloseTo(-191, 6)
  })

  it('keeps a flat-based building flat, slope or no slope', () => {
    const { contacts, raw } = building()
    expect(modelGround(contacts, raw, 1)).toEqual({ follows: false })
    // On level ground both readings fit, and the documented frame stands.
    expect(modelGround(contacts, contacts.map(() => 190), 1)).toEqual({ follows: false })
  })

  it('does not let a tunnel or a footing sunk deeper decide', () => {
    const { contacts, raw } = coaster()
    contacts.push([100, -12, 0], [104, -12, 0])
    raw.push(dem(100), dem(104))
    const ground = modelGround(contacts, raw, 1)
    expect(ground.follows && ground.offset).toBeCloseTo(-191, 6)
  })

  it('stays flat on too little evidence', () => {
    const { contacts, raw } = coaster()
    // Terrain not loaded under most of it.
    const partial = raw.map((h, i) => (i < 8 ? h : NaN))
    expect(modelGround(contacts, partial, 1)).toEqual({ follows: false })
  })

  it('reads a scaled model in its own units', () => {
    const { contacts, raw } = coaster()
    // The same coaster drawn at half size: half the model units per metre.
    const halved = contacts.map(([x, y, z]): Contact => [x * 2, y * 2, z * 2])
    const ground = modelGround(halved, raw, 0.5)
    expect(ground.follows && ground.offset).toBeCloseTo(-382, 6)
  })
})

describe('groundLifts', () => {
  // Exaggerated heights, as the map samples them, on a 2 × 2 grid.
  const exaggeration = 1.2
  const raw = [190, 194, 190, 198]
  const heights = raw.map(h => h * exaggeration)

  it('is the drape it always was for a flat model', () => {
    const { lifts, mean, lowest } = groundLifts(heights, exaggeration, { follows: false }, 1)
    expect(lowest).toBeCloseTo(228, 6)
    const rise = [0, 4.8, 0, 9.6]
    rise.forEach((r, i) => {
      expect(lifts[i * 2]).toBeCloseTo(r, 4)
      expect(lifts[i * 2 + 1]).toBe(0)
    })
    expect(mean).toBeCloseTo((4.8 + 9.6) / 4, 4)
  })

  it('lifts a terrain model only by what the map adds to its own ground', () => {
    const offset = -191
    const { lifts, lowest } = groundLifts(heights, exaggeration, { follows: true, offset }, 1)
    // A foot the model stands on its ground at each point lands on the
    // map's ground there: the base (`lowest`), plus its own y, plus the lift.
    raw.forEach((h, i) => {
      const foot = h + offset
      const lift = lifts[i * 2] - lifts[i * 2 + 1]
      expect(lowest + foot + lift).toBeCloseTo(h * exaggeration, 4)
    })
  })

  it('reads an unloaded sample as the lowest ground, and no terrain as flat', () => {
    const partial = groundLifts([0, heights[1], heights[2], heights[3]], exaggeration, { follows: true, offset: -191 }, 1)
    expect(partial.lowest).toBeCloseTo(228, 6)
    expect(partial.lifts[0]).toBe(0)
    // Nothing loaded: a terrain model is not lifted 190 m to meet a DEM of 0.
    const none = groundLifts([0, 0, 0, 0], exaggeration, { follows: true, offset: -191 }, 1)
    expect([...none.lifts].every(v => v === 0)).toBe(true)
    expect(none.mean).toBe(0)
  })
})

describe('groundContacts', () => {
  const footprint = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }

  it('keeps the lowest vertex in each cell, and none of the moving parts', () => {
    const position = new Float32Array([1, 5, 1, 1.5, 0.2, 1.5, 9, 3, 9])
    const contacts = groundContacts([
      { position, node: -1 },
      { position: new Float32Array([1, -50, 1]), node: 2 },
    ], footprint)
    expect(contacts).toHaveLength(2)
    expect(contacts[0][1]).toBeCloseTo(0.2, 6)
    expect(contacts[1]).toEqual([9, 3, 9])
  })

  it('reads a big model all over, within budget', () => {
    const big = { minX: 0, maxX: 480, minZ: 0, maxZ: 480 }
    const position: number[] = []
    for (let x = 0; x < 480; x += 5) for (let z = 0; z < 480; z += 5) position.push(x, 0, z)
    const contacts = groundContacts([{ position: new Float32Array(position), node: -1 }], big)
    expect(contacts).toHaveLength(MAX_CONTACTS)
    // From one corner of the plan to the other, not just the first rows.
    expect(Math.max(...contacts.map(c => c[2]))).toBeGreaterThan(400)
  })
})
