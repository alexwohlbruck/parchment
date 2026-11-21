import { describe, expect, it } from 'vitest'
import {
  elevationGround, GROUND_SINK, groundContacts, groundModel, groundSink, MAX_CONTACTS, modelGround, type Contact,
} from './landmark-ground'

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

  it('keeps a building flat whose floor happens to sit level with a plateau', () => {
    // 1201 Third Avenue in Seattle: a base at y = 0 stepping 10 m down a
    // hill, the lidar's plateau at the top of it, and a ground floor 1.2 m
    // up resting on that plateau. With the buried share set aside, the floor
    // lines up more contacts under the terrain than the base does flat.
    const plateau = (x: number) => (x < 30 ? 200 : 200 - (x - 30) * 0.4)
    const contacts: Contact[] = []
    for (let x = 0; x < 30; x += 2) contacts.push([x, 1.2, 0], [x, 1.2, 10])
    for (let x = 30; x <= 56; x += 2) contacts.push([x, 0, 0])
    for (let x = 0; x <= 56; x += 2) for (let z = 20; z <= 40; z += 4) contacts.push([x, 25 + z, z])
    const raw = contacts.map(([x]) => plateau(x) + 1.2)
    expect(modelGround(contacts, raw, 1)).toEqual({ follows: false })
  })

  it('still finds a building stepped down a slope to the ground under it', () => {
    // Healy Hall: floors at 0 and 1.2 m, each on the ground under it, the
    // lowest ground at y = 0 as Barrelman's frame has it.
    const ground = (x: number) => (x < 30 ? 50 : 51.2)
    const contacts: Contact[] = []
    for (let x = 0; x <= 58; x += 2) contacts.push([x, ground(x) - 50, 0], [x, ground(x) - 50, 10])
    for (let x = 0; x <= 58; x += 2) contacts.push([x, 22, 20])
    const raw = contacts.map(([x]) => ground(x) + (x % 4 ? 0.3 : -0.3))
    const found = modelGround(contacts, raw, 1)
    expect(found.follows).toBe(true)
  })

  it('keeps a coaster read over another DEM than the one it was built on', () => {
    // Its feet at every height, the map's lowest ground metres under its
    // datum: off Barrelman's frame, but never a floor.
    const { contacts, raw } = coaster()
    const ground = modelGround(contacts, raw.map((h, i) => (i === 0 ? h - 4 : h)), 1)
    expect(ground.follows).toBe(true)
  })

  it('reads a scaled model in its own units', () => {
    const { contacts, raw } = coaster()
    // The same coaster drawn at half size: half the model units per metre.
    const halved = contacts.map(([x, y, z]): Contact => [x * 2, y * 2, z * 2])
    const ground = modelGround(halved, raw, 0.5)
    expect(ground.follows && ground.offset).toBeCloseTo(-382, 6)
  })
})

describe('groundModel', () => {
  // The raw DEM on a 2 × 2 grid, and the map's heights as it draws them.
  const raw = [190, 194, 190, 198]

  it('sets a flat model on the lowest ground, whole', () => {
    const { lowest, offset, ground } = groundModel(raw, 1, { follows: false }, 1, 0)
    expect(lowest).toBe(190)
    expect(offset).toBe(0)
    // The ground over its origin, for contact shading: uphill it covers the base.
    expect([...ground]).toEqual([0, 4, 0, 8])
  })

  it('counts the sink in the ground over the origin', () => {
    const { ground } = groundModel(raw, 1, { follows: false }, 0.5, GROUND_SINK)
    // In model units: a model drawn at half size has twice the units per metre.
    expect(ground[0]).toBeCloseTo(GROUND_SINK * 2, 6)
  })

  it('moves a terrain model by one offset that stands its feet on the map\'s ground', () => {
    const own = { follows: true as const, offset: -191 }
    const { lowest, offset, ground } = groundModel(raw, 1, own, 1, 0, raw)
    raw.forEach((h, i) => {
      // A foot on its own ground at each point lands on the map's ground there.
      const foot = h + own.offset
      expect(lowest + foot + offset).toBeCloseTo(h, 6)
      expect(foot - ground[i]).toBeCloseTo(0, 6)
    })
  })

  it('takes the median, so a stray reading does not move the model', () => {
    const own = { follows: true as const, offset: -191 }
    const drawn = [190, 194, 190, 198, 200]
    const bare = [190, 194, 190, 198, 197]
    const { lowest, offset } = groundModel(drawn, 1, own, 1, 0, bare)
    expect(lowest + 190 + own.offset + offset).toBeCloseTo(190, 6)
  })

  it('keeps a terrain model true-sized under exaggeration, its feet on the median ground', () => {
    const own = { follows: true as const, offset: -191 }
    const e = 1.2
    const { lowest, offset } = groundModel(raw.map(h => h * e), e, own, 1, 0, raw)
    // Feet at 190 m and 194 m: the median of where the map draws them.
    const shifts = raw.map(h => h * e - (lowest + h + own.offset)).sort((a, b) => a - b)
    expect(offset).toBeCloseTo((shifts[1] + shifts[2]) / 2, 6)
  })

  it('reads an unloaded sample as the lowest ground, and no terrain as flat', () => {
    const own = { follows: true as const, offset: -191 }
    const partial = groundModel([0, 194, 190, 198], 1, own, 1, 0, [NaN, 194, 190, 198])
    expect(partial.lowest).toBe(190)
    expect(partial.ground[0]).toBeCloseTo(partial.ground[2], 6)
    // Nothing loaded: a terrain model is not lifted 190 m to meet a DEM of 0.
    const none = groundModel([0, 0, 0, 0], 1, own, 1, 0)
    expect(none.offset).toBe(0)
    expect([...none.ground].every(v => v === 0)).toBe(true)
  })
})

describe('groundSink', () => {
  it('pushes a flat model under the terrain, and nothing else', () => {
    expect(groundSink({ follows: false }, true)).toBe(GROUND_SINK)
    // A terrain model's feet are in the ground already, and a bridge meets the map's roads.
    expect(groundSink({ follows: true, offset: -191 }, true)).toBe(0)
    expect(groundSink({ follows: false }, false)).toBe(0)
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

describe('elevationGround', () => {
  it('leaves a landmark with no elevation on its ground', () => {
    expect(elevationGround(0, 1, true)).toEqual({ groundAt: 0, floor: -1e6 })
    expect(elevationGround(0, 1, false)).toEqual({ groundAt: 0, floor: -0 })
    expect(elevationGround(20, 1, true)).toMatchObject({ groundAt: 0 })
  })

  it('puts a sunk model\'s ground at the street it meets, in model metres', () => {
    expect(elevationGround(-7, 1, true)).toMatchObject({ groundAt: 7 })
    // A model drawn at half size meets the street at twice the model depth.
    expect(elevationGround(-7, 0.5, true).groundAt).toBe(14)
  })

  it('clips at the flat map with the terrain off, and leaves it to the terrain with it on', () => {
    // Map metres up from the anchor, which the elevation has already moved.
    expect(elevationGround(-5, 1, false).floor).toBe(5)
    expect(elevationGround(20, 1, false).floor).toBe(-20)
    expect(elevationGround(-5, 1, true).floor).toBeLessThan(-1000)
  })
})
