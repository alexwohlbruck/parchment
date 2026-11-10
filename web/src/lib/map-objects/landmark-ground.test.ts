import { describe, expect, it } from 'vitest'
import { mercator, type Point } from '@/lib/map-decks/decks'
import { LIFT_BLEND, smoothedGround } from '@/lib/map-decks/lift-field'
import {
  baseSink, deckGround, elevationDrape, GROUND_SINK, groundContacts, groundLifts, MAX_CONTACTS, modelGround, type Contact, type DeckGround,
} from './landmark-ground'
import { GROUND_GRID, groundGrid, modelToLngLat } from './landmarks'

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

  it('stands a terrain model\'s feet on filled ground from the ground it was built on', () => {
    // The map's ground filled 3 m down at one point, under a lidar bump the model draws itself.
    const filled = [heights[0], heights[1], heights[2], heights[3] - 3 * exaggeration]
    const offset = -191
    const { lifts, lowest } = groundLifts(filled, exaggeration, { follows: true, offset }, 1, [NaN, NaN, NaN, raw[3]])
    raw.forEach((h, i) => {
      const lift = lifts[i * 2] - lifts[i * 2 + 1]
      expect(lowest + h + offset + lift).toBeCloseTo(filled[i], 4)
    })
  })
})

describe('baseSink', () => {
  it('pushes only what stands on a flat model\'s ground under the terrain', () => {
    expect(baseSink({ follows: false }, 1, true)).toEqual({ depth: GROUND_SINK, band: 0.05 })
    // In model units: a model drawn at half size is pushed twice as far in its own.
    expect(baseSink({ follows: false }, 0.5, true).depth).toBe(GROUND_SINK * 2)
  })

  it('takes every foot of a terrain model as base, scattered as they are', () => {
    expect(baseSink({ follows: true, offset: -191 }, 1, true).band).toBe(1)
  })

  it('pushes nothing with the terrain off', () => {
    expect(baseSink({ follows: false }, 1, false)).toEqual({ depth: 0, band: 0 })
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

describe('elevationDrape', () => {
  it('leaves a landmark with no elevation exactly as it was drawn before', () => {
    // Every Open Landmarks asset, and every release before elevation was sent.
    expect(elevationDrape(0, 1, true)).toEqual({ rigid: false, groundAt: 0, floor: -1e6 })
    expect(elevationDrape(0, 1, false)).toEqual({ rigid: false, groundAt: 0, floor: -0 })
  })

  it('stands a raised model rigid, so nothing of it stretches to the ground', () => {
    expect(elevationDrape(20, 1, true)).toMatchObject({ rigid: true, groundAt: 0 })
    expect(elevationDrape(20, 1, false)).toMatchObject({ rigid: true, groundAt: 0 })
  })

  it('measures a sunk model\'s drape from the street it meets, in model metres', () => {
    expect(elevationDrape(-7, 1, true)).toMatchObject({ rigid: false, groundAt: 7 })
    // A model drawn at half size meets the street at twice the model depth.
    expect(elevationDrape(-7, 0.5, true).groundAt).toBe(14)
  })

  it('clips at the flat map with the terrain off, and leaves it to the terrain with it on', () => {
    // Map metres up from the anchor, which the elevation has already moved.
    expect(elevationDrape(-5, 1, false).floor).toBe(5)
    expect(elevationDrape(20, 1, false).floor).toBe(-20)
    expect(elevationDrape(-5, 1, true).floor).toBeLessThan(-1000)
  })
})

/** A generator run to its end, as the layer's frame task runs it over several frames. */
function run<T>(steps: Generator<void, T>): T {
  for (;;) {
    const step = steps.next()
    if (step.done) return step.value
  }
}

describe('deckGround', () => {
  // The Cabrillo Bridge's canyon: a floor 41 m up, rims 72 m up 150 m either side.
  const landmark = { lng: -117.1545, lat: 32.73142, bearing: 0, scale: 1 }
  const footprint = { minX: -200, maxX: 200, minZ: -6, maxZ: 6 }
  const unit = 1 / (40075016.686 * Math.cos((landmark.lat * Math.PI) / 180))
  const anchor = mercator([landmark.lng, landmark.lat])
  const bare = ([x]: Point) => 41 + 31 * Math.min(1, ((x - anchor[0]) / unit / 150) ** 2)
  const toMap = (x: number, z: number) => mercator(modelToLngLat(landmark, x, z))
  const groundAt = (x: number, z: number) => bare(toMap(x, z))
  const exaggeration = 1.2
  // Built over the terrain from the canyon floor: its feet on the DEM, its deck level at 75 m.
  const built = 41
  const own = { follows: true as const, offset: -built }
  const deckY = 75 - built

  /** Bilinear over a row-major grid spanning the footprint, as the shader reads it. */
  const bilinear = (values: (k: number) => number, cols: number, rows: number, x: number, z: number) => {
    const gx = Math.min(1, Math.max(0, (x - footprint.minX) / (footprint.maxX - footprint.minX))) * (cols - 1)
    const gz = Math.min(1, Math.max(0, (z - footprint.minZ) / (footprint.maxZ - footprint.minZ))) * (rows - 1)
    const [i, j] = [Math.min(Math.floor(gx), cols - 2), Math.min(Math.floor(gz), rows - 2)]
    const [fx, fz] = [gx - i, gz - j]
    const at = (a: number, b: number) => values((j + b) * cols + i + a)
    return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fz) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fz
  }

  /** Where GROUND draws a vertex, in true metres up: as any landmark without `deck`, as a bridge with it. */
  function drawn([x, y, z]: Contact, deck: DeckGround | null): number {
    const heights = groundGrid(landmark, footprint).map(p => bare(mercator(p)) * exaggeration)
    const { lifts, mean, lowest } = deck
      ? groundLifts(heights.map(h => h / exaggeration), 1, own, 1)
      : groundLifts(heights, exaggeration, own, 1)
    const g = [0, 1].map(c => bilinear(k => lifts[k * 2 + c], GROUND_GRID, GROUND_GRID, x, z))
    const follow = 1 - Math.min(1, Math.max(0, (y - g[1]) / 25))
    const lifted = y + mean + (g[0] - g[1] - mean) * follow
    if (!deck) return lowest + lifted
    const [smooth, ground] = [0, 1].map(c => bilinear(k => deck.heights[k * 2 + c], deck.cols, deck.rows, x, z) - lowest)
    const w = Math.min(1, Math.max(0, 1 - (lifted - ground) / LIFT_BLEND))
    return lowest * exaggeration + lifted + (exaggeration - 1) * (smooth + (ground - smooth) * w)
  }

  /** Where the map draws its own deck at a point `z` metres up: Barrelman's lift. */
  const smoothed = smoothedGround(bare)
  function mapDeck(x: number, z: number, height: number): number {
    const p = toMap(x, z)
    const smooth = smoothed(p)!
    const ground = bare(p)
    return height + (exaggeration - 1) * (smooth + (ground - smooth) * Math.min(1, Math.max(0, 1 - (height - ground) / LIFT_BLEND)))
  }

  it('lifts a bridge\'s deck as the map lifts the road on it', () => {
    const deck = run(deckGround(footprint, toMap, 1, bare))!
    expect(deck.cols).toBe(201)
    let before = 0
    for (let x = -196; x <= 196; x += 7)
      for (const z of [-5, 0, 5]) {
        const vertex: Contact = [x, deckY, z]
        expect(Math.abs(drawn(vertex, deck) - mapDeck(x, z, 75))).toBeLessThan(0.1)
        before = Math.max(before, Math.abs(drawn(vertex, null) - mapDeck(x, z, 75)))
      }
    // Lifted by the mean ground over its whole extent, it was metres off.
    expect(before).toBeGreaterThan(2)
  })

  it('keeps its feet on the exaggerated terrain', () => {
    const deck = run(deckGround(footprint, toMap, 1, bare))!
    for (let x = -150; x <= 150; x += 30) {
      const foot: Contact = [x, groundAt(x, 0) - built, 0]
      expect(drawn(foot, deck)).toBeCloseTo(groundAt(x, 0) * exaggeration, 1)
    }
  })

  it('waits for the ground, and gives up where there is none', () => {
    expect(run(deckGround(footprint, toMap, 1, () => null))).toBeNull()
    expect(run(deckGround(footprint, toMap, 1, () => NaN))).toBeNull()
  })

  it('reads a long bridge no coarser than the grid allows', () => {
    const long = run(deckGround({ minX: -950, maxX: 950, minZ: -700, maxZ: 700 }, toMap, 1, bare))!
    expect([long.cols, long.rows]).toEqual([256, 256])
  })
})
