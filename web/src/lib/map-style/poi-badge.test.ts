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
const RING = '#0b2b4b'
const LIFT = 'rgba(0,0,0,0.34)'

/**
 * A disc with a square knocked out of its middle, encoded exactly as
 * `build-sprite.mjs` encodes one.
 *
 * The distance is solved analytically rather than searched for on the pixel
 * grid. That matters for `the plate edge is round`: a grid search can only
 * return distances of the form `hypot(whole, whole)`, which is itself wrong by
 * up to half a pixel and would put a staircase into the fixture that no
 * compositor could remove — the test would then be measuring its own fixture.
 * `alphaToSdf` seeds its transform from an antialiased raster and lands close
 * to the true field, so the true field is the honest stand-in.
 */
function badgeFixture(size = 26) {
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - SDF_BUFFER
  const glyph = r * 0.5

  /** Signed distance to the disc, then the disc with the square subtracted. */
  const distance = (x: number, y: number) => {
    const dx = x + 0.5 - cx
    const dy = y + 0.5 - cy
    const disc = Math.hypot(dx, dy) - r
    const qx = Math.abs(dx) - glyph
    const qy = Math.abs(dy) - glyph
    const box =
      Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0)
    return Math.max(disc, -box)
  }

  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = 255 - 255 * (distance(x, y) / SDF_RADIUS + SDF_CUTOFF)
      data[(y * size + x) * 4 + 3] = Math.max(0, Math.min(255, Math.round(a)))
    }
  }
  return { width: size, height: size, data, pixelRatio: 1, centre: Math.floor(size / 2) }
}

const fixture = badgeFixture()
const composed = composeBadge(fixture, {
  art: 'badge-x',
  plate: PLATE,
  ink: INK,
  ring: RING,
  lift: LIFT,
})

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
    const parts = parseBadgeName(`poi|badge-cafe|${PLATE}|${INK}|${RING}|${LIFT}`)
    expect(parts).toEqual({ art: 'badge-cafe', plate: PLATE, ink: INK, ring: RING, lift: LIFT })
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
  /** Output pixels per pixel of the sprite art, so probes can be sized in art units. */
  const density = composed.pixelRatio / fixture.pixelRatio

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
    const p = pixel(c, c + 8 * density)
    expect(p.a).toBeGreaterThan(0.9)
    near(p, PLATE)
  })

  test('the ring wears its own colour, and sits outside the plate', () => {
    // Walk out along a row to the outermost fully-covered pixel — solid ring —
    // then check it is the ring colour rather than the plate. Fully covered
    // rather than merely opaque, since the rim beyond it is the ring blended
    // into the lift and carries neither colour cleanly.
    let edge = -1
    for (let x = c; x < composed.width; x++) {
      if (pixel(x, c).a > 0.99) edge = x
    }
    expect(edge).toBeGreaterThan(c)
    near(pixel(edge, c), RING)
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

  /**
   * Size is measured in display pixels — `width / pixelRatio`, which is what
   * MapLibre draws — rather than in raw ones. The badge is composited on a
   * finer grid than the sheet and folded back onto it (see `SUPERSAMPLE`), so
   * a fold that went missing, or one that landed on a different ratio than the
   * image it produced, would show up here as a badge of the wrong size while
   * every raw pixel count still looked plausible.
   */
  test('it grows by the room the ring and lift need, and stays centred', () => {
    const display = (image: { width: number; height: number; pixelRatio: number }) => [
      image.width / image.pixelRatio,
      image.height / image.pixelRatio,
    ]
    const [dw, dh] = display(composed)
    const [aw, ah] = display(fixture)
    expect(dw).toBeGreaterThan(aw)
    expect(dw - aw).toBe(dh - ah)
    expect((dw - aw) % 2).toBe(0)
  })

  /**
   * The badge has to be round, and this is the test that says so.
   *
   * A baked badge was an SDF and MapLibre rebuilt its edge per screen pixel; a
   * composed one is a raster and only has the edge it was given. Built at the
   * sprite's own density that edge is a staircase on a 19px disc, which is what
   * made these read as rounded squares. So: walk out from the centre at many
   * angles, find where the alpha crosses half, and require every one of those
   * radii to agree — a staircase does not.
   *
   * Diameters rather than radii, because a radius is measured from an assumed
   * centre and the badge's true centre lands on a half-pixel — which shows up
   * as a smooth 0.5px lean across the disc and swamps the thing being measured.
   * Opposite rays cancel it exactly.
   *
   * The threshold is in display pixels, so it holds whatever the sheet's ratio
   * happens to be. It is measured on the image as MapLibre receives it, which
   * is the image it draws: `composeBadge` folds its working grid back to the
   * sprite's density, so the badge's texels and the screen's pixels line up
   * and nothing downstream resamples the edge. That fold is also the floor on
   * this number — the fixture spreads 0.31 at a supersample of two and 0.29 at
   * four, because what is left is the output grid rather than the working one.
   * A third of a pixel of out-of-round is invisible; a staircase is not, and a
   * staircase measures several times this.
   */
  test('the plate edge is round to well under a drawn pixel', () => {
    // Measured where the plate meets the ring rather than at the badge's outer
    // silhouette: both are fully opaque there, so the lift — which is blurred
    // and deliberately dropped downwards — cannot tilt the reading.
    const [pr, pg, pb] = parseColor(PLATE)
    const [ir, ig, ib] = parseColor(INK)
    const span = (pr - ir) ** 2 + (pg - ig) ** 2 + (pb - ib) ** 2
    /** 0 on the ring, 1 on the plate, projected onto the ink-to-plate axis. */
    const platenessAt = (x: number, y: number) => {
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const fx = x - x0
      const fy = y - y0
      const at = (px: number, py: number) => {
        const p = pixel(px, py)
        return ((p.r - ir) * (pr - ir) + (p.g - ig) * (pg - ig) + (p.b - ib) * (pb - ib)) / span
      }
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx
      const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx
      return top + (bottom - top) * fy
    }

    // Walked inwards from the rim, so the crossing found is the outermost one
    // — the plate's own edge. Walking outwards from the centre would stop at
    // the knockout's corner on the diagonals, which is a different boundary.
    const radii: number[] = []
    const step = 0.05
    for (let i = 0; i < 64; i++) {
      const angle = (i / 64) * Math.PI * 2
      let previous = 0
      for (let r = composed.width / 2 - 1; r > 0; r -= step) {
        const p = platenessAt(c + Math.cos(angle) * r, c + Math.sin(angle) * r)
        if (previous < 0.5 && p >= 0.5) {
          radii.push((r + step * (p - 0.5) / (p - previous)) / composed.pixelRatio)
          break
        }
        previous = p
      }
    }
    expect(radii.length).toBe(64)
    const diameters = radii.slice(0, 32).map((r, i) => r + radii[i + 32])
    const spread = Math.max(...diameters) - Math.min(...diameters)
    expect(spread, `edge diameter varies by ${spread.toFixed(2)} display px`).toBeLessThan(0.4)
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
