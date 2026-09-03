/**
 * A place marker baked into a single map image: plate, ring and glyph together.
 *
 * The app already had one way to draw a marker natively — a `circle` layer for
 * the plate with a `symbol` layer of glyphs over it — and it works, but it can
 * only ever draw a circle. A square plate has no `circle-shape` to ask for, and
 * a second symbol layer cannot be used for the plate because two symbol layers
 * only share placement if their layout is identical, which pins them to the
 * same image. So the plate and the glyph become one image here, which is also
 * how the basemap's own POI badges are drawn (`map-style/poi-badge.ts`).
 *
 * The difference from `poi-badge.ts`, and why this is not that: a basemap badge
 * is composited from the sprite's own SDF art, which only covers the basemap's
 * icon set. These are drawn from lucide and maki SVGs, which is what a user
 * actually picks for a pin or a collection. Same idea, different source, so
 * they share the metrics rather than the machinery.
 *
 * One image per (shape, glyph, colour) combination. That sounds like a lot and
 * is not: a canvas has a handful of pin colours, and they are cached for the
 * life of the style.
 */

import {
  MARKER_GLYPH_RATIO,
  MARKER_IMAGE_PIXEL_RATIO,
  MARKER_PLATE_SIZE,
  MARKER_RING_WIDTH,
  MARKER_SQUARE_CORNER,
} from './marker-metrics.mjs'
import type { MarkerShape } from './marker-shape'
import type { MarkerPaint } from './marker-paint'
import { resolveIconSvg, type MapIconPack } from '@/lib/map-icon-images'

/** Marks an image this module builds, so ids cannot collide with the sprite's. */
export const MARKER_IMAGE_PREFIX = 'pm|'

export interface MarkerImageSpec {
  shape: MarkerShape
  pack: MapIconPack
  /** Glyph name, or empty for a plate with nothing in it. */
  name: string
  paint: MarkerPaint
}

/**
 * The image id for a marker, built so a style expression can `concat` one
 * together from feature properties without this module being consulted.
 *
 * Pipes separate, since no CSS colour and no icon name contains one.
 */
export function markerImageId(spec: MarkerImageSpec): string {
  const { shape, pack, name, paint } = spec
  return [
    MARKER_IMAGE_PREFIX + shape,
    pack,
    name,
    paint.plate ?? '',
    paint.ink,
    paint.ring,
  ].join('|')
}

/** The inverse, for the resolver. Returns null for anything not ours. */
export function parseMarkerImageId(id: string): MarkerImageSpec | null {
  if (!id.startsWith(MARKER_IMAGE_PREFIX)) return null
  const [shape, pack, name, plate, ink, ring] = id
    .slice(MARKER_IMAGE_PREFIX.length)
    .split('|')
  if (!shape || !ink) return null
  return {
    shape: shape as MarkerShape,
    pack: (pack || 'lucide') as MapIconPack,
    name: name ?? '',
    paint: { plate: plate || null, ink, ring: ring || ink },
  }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/**
 * The plate's path, in device pixels.
 *
 * `roundRect` covers the square; a disc is an arc rather than a `roundRect`
 * with a half-side radius because the two are not identical at small sizes —
 * the rounded-rect path leaves flat spans between the corner arcs that read as
 * a lozenge once the plate is only 19px across.
 */
function platePath(
  ctx: CanvasRenderingContext2D,
  shape: MarkerShape,
  x: number,
  y: number,
  side: number,
): void {
  ctx.beginPath()
  if (shape === 'square') {
    ctx.roundRect(x, y, side, side, side * MARKER_SQUARE_CORNER)
  } else {
    ctx.arc(x + side / 2, y + side / 2, side / 2, 0, Math.PI * 2)
  }
  ctx.closePath()
}

async function glyphBitmap(
  pack: MapIconPack,
  name: string,
  color: string,
  size: number,
): Promise<HTMLImageElement | null> {
  if (!name) return null
  const svg = await resolveIconSvg(pack, name, color)
  if (!svg) return null

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.width = size
    img.height = size
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface MarkerImageData {
  width: number
  height: number
  data: Uint8ClampedArray
  pixelRatio: number
}

/**
 * Draw one marker.
 *
 * Sized so the ring grows outward from the plate, matching how a CSS border box
 * and a `circle-stroke-width` both behave — a marker is `plateSize` of colour
 * with the ring outside it, not `plateSize` including the ring.
 */
export async function composeMarkerImage(
  spec: MarkerImageSpec,
  size = MARKER_PLATE_SIZE,
): Promise<MarkerImageData | null> {
  const { shape, pack, name, paint } = spec
  const ratio = MARKER_IMAGE_PIXEL_RATIO
  const ring = shape === 'glyph' ? 0 : MARKER_RING_WIDTH
  // A bare glyph gets its halo drawn as a blur, which needs the same room a
  // ring would have taken — so the canvas is the same size either way.
  const side = Math.ceil((size + MARKER_RING_WIDTH * 2) * ratio)

  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const plateSide = size * ratio
  const inset = (side - plateSide) / 2

  if (shape !== 'glyph' && paint.plate) {
    platePath(ctx, shape, inset, inset, plateSide)
    ctx.fillStyle = paint.plate
    ctx.fill()
    if (ring > 0) {
      // Stroked centred on the path, so half of it falls outside the plate —
      // hence the path is inset by the full ring width above and only half of
      // it shows outside, exactly as a CSS border does.
      ctx.lineWidth = ring * ratio
      ctx.strokeStyle = paint.ring
      ctx.stroke()
    }
  }

  const glyphSide = Math.round(size * MARKER_GLYPH_RATIO * ratio)
  const glyph = await glyphBitmap(pack, name, paint.ink, glyphSide)
  if (glyph) {
    const at = (side - glyphSide) / 2
    if (shape === 'glyph') {
      // Two passes of a tight shadow rather than one wide one: a single blur
      // wide enough to read over a busy map is also wide enough to look like
      // fog around the glyph. Two tight ones stack to an opaque edge.
      ctx.shadowColor = paint.ring
      ctx.shadowBlur = MARKER_RING_WIDTH * ratio
      ctx.drawImage(glyph, at, at, glyphSide, glyphSide)
      ctx.drawImage(glyph, at, at, glyphSide, glyphSide)
      ctx.shadowBlur = 0
    }
    ctx.drawImage(glyph, at, at, glyphSide, glyphSide)
  }

  return {
    width: side,
    height: side,
    data: ctx.getImageData(0, 0, side, side).data,
    pixelRatio: ratio,
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** The slice of the map this needs, so the module stays testable. */
export interface MarkerImageHost {
  hasImage(id: string): boolean
  addImage(id: string, image: MarkerImageData, options: { pixelRatio: number }): unknown
}

/**
 * In-flight registrations. Two features sharing a marker would otherwise both
 * miss `hasImage` and race to `addImage`, and the loser throws.
 */
const pending = new Map<string, Promise<void>>()

/** Register one marker image, or resolve immediately if it is already up. */
export function ensureMarkerImage(
  map: MarkerImageHost | undefined,
  spec: MarkerImageSpec,
  size?: number,
): Promise<void> {
  const id = markerImageId(spec)
  if (!map || typeof map.hasImage !== 'function') return Promise.resolve()
  if (map.hasImage(id)) return Promise.resolve()

  const inFlight = pending.get(id)
  if (inFlight) return inFlight

  const task = (async () => {
    try {
      const image = await composeMarkerImage(spec, size)
      // The style can change while we were decoding, which both clears
      // registered images and can re-add this one — re-check before writing.
      if (image && !map.hasImage(id)) {
        map.addImage(id, image, { pixelRatio: image.pixelRatio })
      }
    } catch (e) {
      console.warn(`[marker-image] failed to register ${id}:`, e)
    } finally {
      pending.delete(id)
    }
  })()

  pending.set(id, task)
  return task
}

/** Register a batch, de-duplicated. Never rejects. */
export function ensureMarkerImages(
  map: MarkerImageHost | undefined,
  specs: Iterable<MarkerImageSpec>,
  size?: number,
): Promise<void> {
  const seen = new Set<string>()
  const tasks: Promise<void>[] = []
  for (const spec of specs) {
    const id = markerImageId(spec)
    if (seen.has(id)) continue
    seen.add(id)
    tasks.push(ensureMarkerImage(map, spec, size))
  }
  return Promise.all(tasks).then(() => undefined)
}
