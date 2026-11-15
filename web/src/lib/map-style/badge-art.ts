/**
 * Badge art for an icon the sprite does not carry, baked at runtime the way
 * `build-sprite.mjs` bakes the sheet's own: the glyph knocked out of a disc, as
 * a distance field. `poi-badge.ts` then composites it like any sprite badge, so
 * a lucide icon gets the same lift, ring, plate and ink as a basemap POI.
 */
import { MARKER_GLYPH_RATIO, MARKER_PLATE_SIZE } from '@/lib/map-marker/marker-metrics.mjs'
import { glyphBitmap } from '@/lib/map-marker/marker-image'
import type { MapIconPack } from '@/lib/map/map-icon-images'
import { SDF_BUFFER, alphaToSdf } from './sdf.mjs'

const BADGE_PREFIX = 'badge-'

/** The slice of MapLibre's `Map` this needs. */
export interface BadgeArtHost {
  hasImage(id: string): boolean
  addImage(
    id: string,
    image: { width: number; height: number; data: Uint8Array },
    options: { pixelRatio: number; sdf: boolean },
  ): unknown
}

/** The density MapLibre picks its sprite sheet at, so baked art matches the sheet's. */
function spriteRatio(): number {
  return typeof window !== 'undefined' && window.devicePixelRatio > 1 ? 2 : 1
}

async function bakeArt(pack: MapIconPack, name: string, ratio: number) {
  const size = Math.round(MARKER_PLATE_SIZE * ratio)
  const glyphSize = Math.round(size * MARKER_GLYPH_RATIO)
  const glyph = await glyphBitmap(pack, name, '#000', glyphSize)
  if (!glyph) return null

  const pad = SDF_BUFFER * ratio
  const side = size + pad * 2
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.beginPath()
  ctx.arc(side / 2, side / 2, size / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'destination-out'
  const at = pad + Math.round((size - glyphSize) / 2)
  ctx.drawImage(glyph, at, at, glyphSize, glyphSize)

  const rgba = ctx.getImageData(0, 0, side, side).data
  const alpha = new Uint8Array(side * side)
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]
  const sdf = alphaToSdf(alpha, side, side)

  // White with the field in alpha, as the sheet stores an SDF.
  const data = new Uint8Array(side * side * 4).fill(255)
  for (let i = 0; i < sdf.length; i++) data[i * 4 + 3] = sdf[i]
  return { width: side, height: side, data, pixelRatio: ratio }
}

/** Whether the sprite sheet is in yet; until it is, every maki icon looks missing. */
export function spriteLoaded(map: Pick<BadgeArtHost, 'hasImage'>): boolean {
  return map.hasImage('dot')
}

const pending = new Map<string, Promise<string | null>>()

/**
 * The art id a badge for this icon composites from: the sheet's own for a maki
 * icon it carries, otherwise one baked here. Null when the icon cannot be drawn.
 */
export function ensureBadgeArt(
  map: BadgeArtHost,
  pack: MapIconPack,
  name: string,
): Promise<string | null> {
  const sprite = `${BADGE_PREFIX}${name}`
  if (pack === 'maki' && map.hasImage(sprite)) return Promise.resolve(sprite)

  const id = `${BADGE_PREFIX}${pack}:${name}`
  if (map.hasImage(id)) return Promise.resolve(id)
  const inFlight = pending.get(id)
  if (inFlight) return inFlight

  const task = (async () => {
    try {
      const art = await bakeArt(pack, name, spriteRatio())
      if (!art) return null
      // The style may have been replaced, and this re-added, while decoding.
      if (!map.hasImage(id)) {
        map.addImage(id, art, { pixelRatio: art.pixelRatio, sdf: true })
      }
      return id
    } catch (e) {
      console.warn(`[badge-art] failed to bake ${id}:`, e)
      return null
    } finally {
      pending.delete(id)
    }
  })()
  pending.set(id, task)
  return task
}
