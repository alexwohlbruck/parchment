/**
 * POI badges, composited at runtime.
 *
 * A badge wants four colours — a soft lift under it, an outline, a tinted
 * plate, and the glyph on top — and a symbol layer can supply exactly two: the
 * icon and its halo. The sprite bakes the plate with the glyph knocked out of
 * it as one SDF, so `icon-color` paints the plate and the knockout shows the
 * map through. That is a one-colour mark, and every attempt to get a second
 * colour onto it runs into the same wall:
 *
 *   - a halo is drawn around *every* edge in the field, so any width that fills
 *     the glyph draws a ring of the same width outside the plate;
 *   - a second symbol layer only shares the first one's placement if its layout
 *     is identical, which pins it to the same image;
 *   - a full-colour sprite cannot be tinted at all, and baking one per category
 *     multiplies the sheet by the palette.
 *
 * So the badge is assembled here instead, from the sprite's own art, when
 * MapLibre asks for an image the style names but the sheet does not carry. The
 * name carries its colours (see `parseBadgeName`), which keeps the palette live
 * — the style still resolves the category tokens against whatever the server
 * serves — and keeps every colour decision in the style rather than in here.
 *
 * MapLibre only. Mapbox draws Standard's own POIs.
 */
import { sdfDistance, SDF_BUFFER } from './sdf.mjs'

/** Marks an image the sprite cannot supply and this module has to build. */
export const POI_BADGE_PREFIX = 'poi|'

/**
 * The outline, in CSS pixels.
 *
 * It used to be an `icon-halo-width` of 1.5 in the flavor's surface colour — a
 * white ring in daylight. Drawn here it can be the glyph's own colour instead,
 * and a shade wider now that it is carrying the badge's edge rather than just
 * separating it from the ground.
 */
const RING_WIDTH = 1.9

/** How far the lift under the badge spreads, and how far it falls, in CSS px. */
const LIFT_BLUR = 2.2
const LIFT_DROP = 0.7

/**
 * Room for the ring and the lift, beyond the padding the sprite already leaves
 * around the field. The badge grows by this much on every side, which also
 * grows its collision box — correct, since the lift is part of the mark.
 */
const PAD = Math.ceil(RING_WIDTH + LIFT_BLUR + LIFT_DROP - SDF_BUFFER)

/** Anything at or below this is outside the plate; see `floodOutside`. */
const SOLID = 0.995

/**
 * How much finer the badge is drawn than the sprite art it is built from.
 *
 * A baked badge was an SDF, and MapLibre's SDF shader reconstructs the edge
 * from the interpolated distance at every screen pixel — so it came out clean
 * wherever it landed. A composed badge is a plain raster, because four colours
 * will not fit in one channel, and a raster only has the edge it was baked
 * with: the coverage ramp here is one texel wide, laid on the sprite's own
 * pixel grid, and at a badge's size that grid is coarse enough to see. It is
 * why a disc started reading as a rounded square.
 *
 * Drawing at twice the density fixes it because the source is still a distance
 * field, which is linear in space and can therefore be resampled between
 * texels and re-thresholded — a genuinely finer edge, not an upscale of a
 * coarse one. The GPU then minifies 2:1 back to the drawn size, which is a
 * 2x2 box filter over that edge.
 *
 * Twice, not four times: the badge is the icon atlas's largest tenant at ~55px
 * a side, and this squares to 4x the texture memory for each one already.
 */
const SUPERSAMPLE = 2

export type BadgeParts = {
  /** Sprite image holding the plate with the glyph knocked out of it. */
  art: string
  /** The plate's fill. */
  plate: string
  /** The glyph, and the ring around the plate. */
  ink: string
  /** The soft lift under the whole badge. */
  lift: string
}

/**
 * `poi|<art>|<plate>|<ink>|<lift>` — the name the style builds per feature.
 *
 * Colours travel in the name rather than being looked up here because the style
 * is where they are decided: `build.ts` has already resolved the live category
 * palette and the flavor by the time an expression is evaluated, and a second
 * copy of that logic in this module is a second thing to keep in step. Pipes
 * separate, since no CSS colour contains one.
 */
export function parseBadgeName(name: string): BadgeParts | null {
  if (!name.startsWith(POI_BADGE_PREFIX)) return null
  const [art, plate, ink, lift] = name.slice(POI_BADGE_PREFIX.length).split('|')
  if (!art || !plate || !ink) return null
  return { art, plate, ink, lift: lift ?? 'rgba(0,0,0,0)' }
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

type Rgba = [number, number, number, number]

/**
 * Parse the handful of colour forms the style can hand us — the palette is
 * authored in hex and `hsl()`, and the lift is an `rgba()`.
 *
 * A colour that will not parse comes back fully transparent rather than
 * throwing: a badge missing its lift is a cosmetic loss, a badge that throws
 * inside MapLibre's image resolver stops the whole layer drawing.
 */
export function parseColor(value: string): Rgba {
  const v = value.trim()

  const hex = /^#([0-9a-f]{3,8})$/i.exec(v)
  if (hex) {
    const d = hex[1]
    const wide = d.length > 4
    const part = (i: number) =>
      wide ? parseInt(d.slice(i * 2, i * 2 + 2), 16) : parseInt(d[i] + d[i], 16)
    const alpha = d.length === 4 || d.length === 8 ? part(3) / 255 : 1
    return [part(0), part(1), part(2), alpha]
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(v)
  if (rgb) {
    const n = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    return [n[0] || 0, n[1] || 0, n[2] || 0, n.length > 3 ? n[3] : 1]
  }

  const hsl = /^hsla?\(([^)]+)\)$/i.exec(v)
  if (hsl) {
    const n = hsl[1].split(/[\s,/]+/).filter(Boolean)
    const [h, s, l] = [parseFloat(n[0]), parseFloat(n[1]) / 100, parseFloat(n[2]) / 100]
    const alpha = n.length > 3 ? parseFloat(n[3]) : 1
    const c = (1 - Math.abs(2 * l - 1)) * s
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = l - c / 2
    const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][
      Math.floor(((h % 360) + 360) % 360 / 60)
    ]
    return [
      Math.round((seg[0] + m) * 255),
      Math.round((seg[1] + m) * 255),
      Math.round((seg[2] + m) * 255),
      alpha,
    ]
  }

  return [0, 0, 0, 0]
}

// ---------------------------------------------------------------------------
// Masks
// ---------------------------------------------------------------------------

/**
 * Which pixels lie outside the plate.
 *
 * The badge art is a plate with the glyph cut out of it, and both the ground
 * around the plate and the inside of the glyph read as "not the shape". Telling
 * them apart is what makes a two-tone badge possible, and a flood fill from the
 * border does it without this module having to know whether the plate is a disc
 * or a rounded square: the glyph is enclosed, so the fill cannot reach it.
 *
 * The fill stops only at fully solid pixels, so the plate's own antialiased rim
 * is reached and keeps its soft edge.
 */
function floodOutside(cov: Float32Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h)
  const queue: number[] = []
  const visit = (i: number) => {
    if (outside[i] || cov[i] >= SOLID) return
    outside[i] = 1
    queue.push(i)
  }
  for (let x = 0; x < w; x++) {
    visit(x)
    visit((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    visit(y * w)
    visit(y * w + w - 1)
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]
    const x = i % w
    const y = (i - x) / w
    if (x > 0) visit(i - 1)
    if (x < w - 1) visit(i + 1)
    if (y > 0) visit(i - w)
    if (y < h - 1) visit(i + w)
  }
  return outside
}

/** One separable box pass, horizontal then vertical, clamped at the edges. */
function boxPass(
  src: Float32Array,
  dst: Float32Array,
  scratch: Float32Array,
  w: number,
  h: number,
  r: number,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      let n = 0
      for (let d = -r; d <= r; d++) {
        const xx = x + d
        if (xx < 0 || xx >= w) continue
        sum += src[y * w + xx]
        n++
      }
      scratch[y * w + x] = sum / n
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0
      let n = 0
      for (let d = -r; d <= r; d++) {
        const yy = y + d
        if (yy < 0 || yy >= h) continue
        sum += scratch[yy * w + x]
        n++
      }
      dst[y * w + x] = sum / n
    }
  }
}

/** Two box passes, which is close enough to a Gaussian at this size. */
function blur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius < 0.5) return src
  const r = Math.max(1, Math.round(radius))
  const scratch = new Float32Array(w * h)
  const first = new Float32Array(w * h)
  const second = new Float32Array(w * h)
  boxPass(src, first, scratch, w, h, r)
  boxPass(first, second, scratch, w, h, r)
  return second
}

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

export type SdfSource = {
  width: number
  height: number
  /** RGBA, with the distance field in alpha — how the sprite sheet stores it. */
  data: Uint8Array | Uint8ClampedArray
  pixelRatio: number
}

export type ComposedImage = {
  width: number
  height: number
  data: Uint8Array
  pixelRatio: number
}

/**
 * The distance field, resampled onto the finer grid the badge is drawn on.
 *
 * Bilinear on the *distance* rather than on the coverage, which is the whole
 * reason this works: distance to the shape is linear across a flat edge, so
 * interpolating it and thresholding afterwards recovers where the edge really
 * falls between two texels. Interpolating coverage instead would only blur the
 * edge the sprite already quantised.
 *
 * Returned in output pixels, so a coverage ramp of one unit is one drawn pixel.
 */
function resampleDistance(src: SdfSource, sw: number, sh: number): Float32Array {
  const w = sw * SUPERSAMPLE
  const h = sh * SUPERSAMPLE
  const out = new Float32Array(w * h)
  const at = (x: number, y: number) => sdfDistance(src.data[(y * sw + x) * 4 + 3])

  for (let y = 0; y < h; y++) {
    // Pixel centres, so the finer grid straddles the coarse one evenly.
    const sy = (y + 0.5) / SUPERSAMPLE - 0.5
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)))
    const y1 = Math.min(sh - 1, y0 + 1)
    const fy = Math.max(0, sy - y0)
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) / SUPERSAMPLE - 0.5
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)))
      const x1 = Math.min(sw - 1, x0 + 1)
      const fx = Math.max(0, sx - x0)
      const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * fx
      const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * fx
      out[y * w + x] = (top + (bottom - top) * fy) * SUPERSAMPLE
    }
  }
  return out
}

/**
 * Draw one badge: lift, then ring, then plate, then glyph.
 *
 * Premultiplied, because MapLibre copies what it is given straight into the
 * image atlas and samples it premultiplied — the same convention
 * `build-sprite.mjs` writes the sheet's full-colour art in.
 */
export function composeBadge(src: SdfSource, parts: BadgeParts): ComposedImage {
  const ratio = src.pixelRatio || 1
  // Output pixels per CSS pixel. Every length below is in output pixels.
  const scale = ratio * SUPERSAMPLE
  const aw = src.width * SUPERSAMPLE
  const ah = src.height * SUPERSAMPLE
  const pad = Math.round(PAD * scale)
  const w = aw + pad * 2
  const h = ah + pad * 2

  const dist = resampleDistance(src, src.width, src.height)
  const cov = new Float32Array(aw * ah)
  for (let i = 0; i < aw * ah; i++) cov[i] = Math.min(1, Math.max(0, 0.5 - dist[i]))
  const outside = floodOutside(cov, aw, ah)

  // The plate is everything the flood could not reach, so it includes the
  // glyph's hole — which is exactly right: the glyph is painted over it.
  const plate = new Float32Array(w * h)
  const glyph = new Float32Array(w * h)
  const ring = new Float32Array(w * h)
  const ringPx = RING_WIDTH * scale

  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const i = y * aw + x
      const o = (y + pad) * w + (x + pad)
      plate[o] = outside[i] ? cov[i] : 1
      glyph[o] = outside[i] ? 0 : 1 - cov[i]
      // A band of `ringPx` outside the plate. Masked to the outside, or the
      // same band would be drawn around the inside of the knockout as well —
      // which is the muddy rim a wide `icon-halo-width` used to produce.
      ring[o] = outside[i]
        ? Math.min(1, Math.max(0, 0.5 - (dist[i] - ringPx))) - cov[i]
        : 0
    }
  }

  const drop = Math.round(LIFT_DROP * scale)
  const lift = blur(shift(plate, w, h, drop), w, h, LIFT_BLUR * scale)

  const data = new Uint8Array(w * h * 4)
  const layers: Array<[Float32Array, Rgba]> = [
    [lift, parseColor(parts.lift)],
    [ring, parseColor(parts.ink)],
    [plate, parseColor(parts.plate)],
    [glyph, parseColor(parts.ink)],
  ]
  for (let i = 0; i < w * h; i++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (const [mask, color] of layers) {
      const alpha = mask[i] * color[3]
      if (alpha <= 0) continue
      r = color[0] * alpha + r * (1 - alpha)
      g = color[1] * alpha + g * (1 - alpha)
      b = color[2] * alpha + b * (1 - alpha)
      a = alpha + a * (1 - alpha)
    }
    data[i * 4] = Math.round(r * a)
    data[i * 4 + 1] = Math.round(g * a)
    data[i * 4 + 2] = Math.round(b * a)
    data[i * 4 + 3] = Math.round(a * 255)
  }

  return { width: w, height: h, data, pixelRatio: scale }
}

function shift(mask: Float32Array, w: number, h: number, dy: number): Float32Array {
  if (!dy) return mask
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const from = y - dy
    if (from < 0 || from >= h) continue
    out.set(mask.subarray(from * w, from * w + w), y * w)
  }
  return out
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/** The slice of MapLibre's `Map` this needs, so the module stays testable. */
export interface BadgeHost {
  getImage(id: string): { data?: SdfSource; pixelRatio?: number; sdf?: boolean } | undefined
  hasImage(id: string): boolean
  addImage(id: string, image: ComposedImage, options: { pixelRatio: number }): unknown
  setMissingStyleImageResolver(resolver: ((id: string) => void) | null): unknown
}

/**
 * Answer MapLibre when it asks for a badge the sprite does not carry.
 *
 * Lazy on purpose. The names the style can build are the icon set times the
 * palette, which is several hundred; what a viewport actually asks for is a few
 * dozen, and they are cached from then on.
 */
export function registerPoiBadges(map: BadgeHost): void {
  map.setMissingStyleImageResolver(id => {
    if (map.hasImage(id)) return
    const parts = parseBadgeName(id)
    if (!parts) return
    const source = map.getImage(parts.art)
    // No art for this class — nothing to draw, the same as the sprite lookup
    // failing before. Adding a placeholder would be worse than an empty spot.
    if (!source?.data) return
    const badge = composeBadge({ ...source.data, pixelRatio: source.pixelRatio ?? 1 }, parts)
    // The badge's own ratio, not the sprite's: it is drawn finer than the sheet
    // (see `SUPERSAMPLE`), and MapLibre sizes an icon by `width / pixelRatio`,
    // so handing it the sheet's would draw the badge at twice its real size.
    map.addImage(id, badge, { pixelRatio: badge.pixelRatio })
  })
}
