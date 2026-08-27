/**
 * The badge compositor.
 *
 * Everything here is invisible when it goes wrong — a badge with no ring, a
 * glyph the same colour as its plate, an image that is not premultiplied — so
 * the pixels are asserted rather than eyeballed. The fixture is built the same
 * way the sprite is: a filled plate with a glyph cut out of it, turned into a
 * distance field.
 */
import { describe, test, expect } from 'vitest'
import { composeBadge, parseBadgeName, parseColor, registerPoiBadges } from './poi-badge'
import { SDF_BUFFER, SDF_CUTOFF, SDF_RADIUS } from './sdf.mjs'

const PLATE = '#cfe0f2'
const INK = '#164c83'
const LIFT = 'rgba(0,0,0,0.34)'

/**
 * A disc with a square knocked out of its middle, encoded exactly as
 * `build-sprite.mjs` encodes one: an exhaustive distance search rather than the
 * builder's two-pass transform, which is far too slow for a sheet and precise
 * enough for a 40px fixture.
 */
function badgeFixture(size = 26) {
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - SDF_BUFFER
  const glyph = r * 0.5

  const inside = (x: number, y: number) => {
    const dx = x + 0.5 - cx
    const dy = y + 0.5 - cy
    const onPlate = Math.hypot(dx, dy) <= r
    const inGlyph = Math.abs(dx) <= glyph && Math.abs(dy) <= glyph
    return onPlate && !inGlyph
  }

  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Distance to the nearest pixel of the opposite class, signed negative
      // inside the shape — the same convention `alphaToSdf` writes.
      let best = SDF_RADIUS
      const here = inside(x, y)
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
          if (inside(i, j) === here) continue
          best = Math.min(best, Math.hypot(i - x, j - y))
        }
      }
      const d = here ? -best : best
      const a = 255 - 255 * (d / SDF_RADIUS + SDF_CUTOFF)
      data[(y * size + x) * 4 + 3] = Math.max(0, Math.min(255, Math.round(a)))
    }
  }
  return { width: size, height: size, data, pixelRatio: 1, centre: Math.floor(size / 2) }
}

const fixture = badgeFixture()
const composed = composeBadge(fixture, { art: 'badge-x', plate: PLATE, ink: INK, lift: LIFT })

/** Straight (un-premultiplied) RGBA at a point, for comparing against a colour. */
function pixel(x: number, y: number) {
  const i = (y * composed.width + x) * 4
  const a = composed.data[i + 3] / 255
  if (!a) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: composed.data[i] / a,
    g: composed.data[i + 1] / a,
    b: composed.data[i + 2] / a,
    a,
  }
}

function near(actual: { r: number; g: number; b: number }, hex: string, tolerance = 12) {
  const [r, g, b] = parseColor(hex)
  expect(Math.abs(actual.r - r), `red ${actual.r} vs ${r}`).toBeLessThan(tolerance)
  expect(Math.abs(actual.g - g), `green ${actual.g} vs ${g}`).toBeLessThan(tolerance)
  expect(Math.abs(actual.b - b), `blue ${actual.b} vs ${b}`).toBeLessThan(tolerance)
}

describe('badge names', () => {
  test('round-trip the colours the style put in them', () => {
    const parts = parseBadgeName(`poi|badge-cafe|${PLATE}|${INK}|${LIFT}`)
    expect(parts).toEqual({ art: 'badge-cafe', plate: PLATE, ink: INK, lift: LIFT })
  })

  test('anything not ours is left alone', () => {
    expect(parseBadgeName('badge-cafe')).toBeNull()
    expect(parseBadgeName('us-interstate-2')).toBeNull()
  })
})

describe('colour parsing', () => {
  test('reads the forms the palette is authored in', () => {
    expect(parseColor('#ff9933')).toEqual([255, 153, 51, 1])
    expect(parseColor('#f93')).toEqual([255, 153, 51, 1])
    expect(parseColor('hsl(210, 100%, 50%)')).toEqual([0, 128, 255, 1])
    expect(parseColor('rgba(0,0,0,0.34)')).toEqual([0, 0, 0, 0.34])
  })

  /** A colour that will not parse must not throw inside MapLibre's resolver. */
  test('an unreadable colour comes back transparent rather than throwing', () => {
    expect(parseColor('rebeccapurple')).toEqual([0, 0, 0, 0])
  })
})

describe('composed badge', () => {
  const c = Math.floor(composed.width / 2)

  test('the glyph takes the ink colour, not the map behind it', () => {
    // The whole point: the knockout used to be a hole showing the ground, which
    // is what capped the badge at one colour.
    const p = pixel(c, c)
    expect(p.a).toBeGreaterThan(0.9)
    near(p, INK)
  })

  test('the plate takes its tint', () => {
    // Between the glyph and the rim: a quarter of the way out from the centre
    // lands on plate for this fixture.
    const p = pixel(c, c + 8)
    expect(p.a).toBeGreaterThan(0.9)
    near(p, PLATE)
  })

  test('the ring is the glyph colour, and outside the plate', () => {
    // Walk out along a row and find the last opaque run — the ring — then check
    // it is ink rather than plate.
    let edge = -1
    for (let x = c; x < composed.width; x++) {
      if (pixel(x, c).a > 0.85) edge = x
    }
    expect(edge).toBeGreaterThan(c)
    near(pixel(edge, c), INK)
  })

  test('the lift falls below the badge and fades out', () => {
    // Under the ring, where only the blurred plate reaches.
    const below = pixel(c, composed.height - 2)
    expect(below.a).toBeGreaterThan(0)
    expect(below.a).toBeLessThan(0.34)
    // A corner is far enough from the disc that nothing reaches it.
    expect(pixel(0, 0).a).toBe(0)
  })

  test('it is premultiplied, which is how MapLibre samples the atlas', () => {
    // No channel may exceed its own alpha, which is exactly what premultiplied
    // means and what a straight-alpha image would violate on the soft edges.
    for (let i = 0; i < composed.data.length; i += 4) {
      const a = composed.data[i + 3]
      for (let ch = 0; ch < 3; ch++) expect(composed.data[i + ch]).toBeLessThanOrEqual(a + 1)
    }
  })

  test('it grows by the room the ring and lift need, and stays centred', () => {
    expect(composed.width).toBeGreaterThan(fixture.width)
    expect(composed.width - fixture.width).toBe(composed.height - fixture.height)
    expect((composed.width - fixture.width) % 2).toBe(0)
  })
})

describe('resolving a missing image', () => {
  function host(images: Record<string, unknown>) {
    let resolver: ((id: string) => void) | null = null
    const added: Record<string, unknown> = {}
    return {
      added,
      ask: (id: string) => resolver?.(id),
      getImage: (id: string) => images[id] as any,
      hasImage: (id: string) => id in images || id in added,
      addImage: (id: string, image: unknown) => {
        added[id] = image
      },
      setMissingStyleImageResolver: (r: ((id: string) => void) | null) => {
        resolver = r
      },
    }
  }

  test('builds the badge the style named', () => {
    const h = host({ 'badge-cafe': { data: fixture, pixelRatio: 1, sdf: true } })
    registerPoiBadges(h)
    h.ask(`poi|badge-cafe|${PLATE}|${INK}|${LIFT}`)
    expect(Object.keys(h.added)).toEqual([`poi|badge-cafe|${PLATE}|${INK}|${LIFT}`])
  })

  /**
   * A class the sprite has no art for draws nothing, which is what the old
   * `coalesce` did when it fell through. A placeholder would be worse — a blank
   * disc with no glyph reads as a bug rather than as an absence.
   */
  test('a class with no art adds nothing at all', () => {
    const h = host({})
    registerPoiBadges(h)
    h.ask(`poi|badge-nosuchthing|${PLATE}|${INK}|${LIFT}`)
    expect(Object.keys(h.added)).toEqual([])
  })

  test('leaves images that are not badges to the sprite', () => {
    const h = host({ 'us-interstate-2': { data: fixture, pixelRatio: 1 } })
    registerPoiBadges(h)
    h.ask('us-interstate-2')
    expect(Object.keys(h.added)).toEqual([])
  })
})
