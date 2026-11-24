/**
 * POI badges for overlays: the same art and compositing the basemap's own POIs
 * get, for a map layer (by image name) or a DOM marker (as an image URL).
 *
 * Art comes from the sprite sheet when it carries the icon, and is otherwise
 * baked here the way `build-sprite.mjs` bakes the sheet's: the glyph knocked out
 * of a plate, as a distance field.
 */
import {
  MARKER_GLYPH_RATIO,
  MARKER_PLATE_SIZE,
  MARKER_SQUARE_CORNER,
} from '@/lib/map-marker/marker-metrics.mjs'
import { glyphBitmap } from '@/lib/map-marker/marker-image'
import type { MapIconPack } from '@/lib/map/map-icon-images'
import { SDF_BUFFER, alphaToSdf } from './sdf.mjs'
import { composeBadge, poiBadgeName, type SdfSource } from './poi-badge'
import { SPRITE_PATH, type PoiBadgeColors } from './build'

/** A disc for a place, a rounded square for a transit stop, as the sprite draws them. */
export type BadgePlate = 'disc' | 'tile'

const PLATE_PREFIX: Record<BadgePlate, string> = { disc: 'badge-', tile: 'tile-' }

export interface BadgeIcon {
  /** `number` letters `name` onto the plate in place of an icon. */
  pack: MapIconPack | 'number'
  name: string
  plate?: BadgePlate
}

/** The density MapLibre picks its sprite sheet at, so baked art matches the sheet's. */
function spriteRatio(): number {
  return typeof window !== 'undefined' && window.devicePixelRatio > 1 ? 2 : 1
}

function canvas2d(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  return ctx ? { canvas, ctx } : null
}

async function bakeArt({ pack, name, plate = 'disc' }: BadgeIcon, ratio: number): Promise<SdfSource | null> {
  const size = Math.round(MARKER_PLATE_SIZE * ratio)
  const glyphSize = Math.round(size * MARKER_GLYPH_RATIO)
  const glyph = pack === 'number' ? null : await glyphBitmap(pack, name, '#000', glyphSize)
  if (!glyph && pack !== 'number') return null

  const pad = SDF_BUFFER * ratio
  const side = size + pad * 2
  const surface = canvas2d(side, side)
  if (!surface) return null
  const { ctx } = surface

  ctx.beginPath()
  if (plate === 'tile') ctx.roundRect(pad, pad, size, size, size * MARKER_SQUARE_CORNER)
  else ctx.arc(side / 2, side / 2, size / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'destination-out'
  if (glyph) {
    const at = pad + Math.round((size - glyphSize) / 2)
    ctx.drawImage(glyph, at, at, glyphSize, glyphSize)
  } else {
    ctx.font = `700 ${Math.round(glyphSize * 1.05)}px 'Geist Sans', system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(name, side / 2, side / 2 + ratio * 0.5)
  }

  const rgba = ctx.getImageData(0, 0, side, side).data
  const alpha = new Uint8Array(side * side)
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]
  const sdf = alphaToSdf(alpha, side, side)

  // White with the field in alpha, as the sheet stores an SDF.
  const data = new Uint8Array(side * side * 4).fill(255)
  for (let i = 0; i < sdf.length; i++) data[i * 4 + 3] = sdf[i]
  return { width: side, height: side, data, pixelRatio: ratio }
}

// ---------------------------------------------------------------------------
// Map layers
// ---------------------------------------------------------------------------

/** The slice of MapLibre's `Map` this needs. */
export interface BadgeArtHost {
  hasImage(id: string): boolean
  addImage(
    id: string,
    image: { width: number; height: number; data: Uint8Array | Uint8ClampedArray },
    options: { pixelRatio: number; sdf: boolean },
  ): unknown
}

/** Whether the sprite sheet is in yet; until it is, every maki icon looks missing. */
export function spriteLoaded(map: Pick<BadgeArtHost, 'hasImage'>): boolean {
  return map.hasImage('dot')
}

const pendingArt = new Map<string, Promise<string | null>>()

/**
 * The art id a badge for this icon composites from: the sheet's own for a maki
 * icon it carries, otherwise one baked here. Null when the icon cannot be drawn.
 */
export function ensureBadgeArt(map: BadgeArtHost, icon: BadgeIcon): Promise<string | null> {
  const prefix = PLATE_PREFIX[icon.plate ?? 'disc']
  const sprite = `${prefix}${icon.name}`
  if (icon.pack === 'maki' && map.hasImage(sprite)) return Promise.resolve(sprite)

  const id = `${prefix}${icon.pack}:${icon.name}`
  if (map.hasImage(id)) return Promise.resolve(id)
  const inFlight = pendingArt.get(id)
  if (inFlight) return inFlight

  const task = (async () => {
    try {
      const art = await bakeArt(icon, spriteRatio())
      if (!art) return null
      // The style may have been replaced, and this re-added, while decoding.
      if (!map.hasImage(id)) map.addImage(id, art, { pixelRatio: art.pixelRatio, sdf: true })
      return id
    } catch (e) {
      console.warn(`[badge-art] failed to bake ${id}:`, e)
      return null
    } finally {
      pendingArt.delete(id)
    }
  })()
  pendingArt.set(id, task)
  return task
}

/** The image name a symbol layer draws this badge by, or '' when the icon cannot be drawn. */
export async function ensurePoiBadge(
  map: BadgeArtHost,
  icon: BadgeIcon,
  colors: PoiBadgeColors,
): Promise<string> {
  const art = await ensureBadgeArt(map, icon)
  return art ? poiBadgeName({ art, ...colors }) : ''
}

// ---------------------------------------------------------------------------
// DOM markers
// ---------------------------------------------------------------------------

type SpriteSheet = { index: Record<string, { x: number; y: number; width: number; height: number }>; pixels: ImageData }

const sheets = new Map<number, Promise<SpriteSheet | null>>()

function spriteSheet(ratio: number): Promise<SpriteSheet | null> {
  let sheet = sheets.get(ratio)
  if (!sheet) {
    const base = `${SPRITE_PATH}${ratio > 1 ? '@2x' : ''}`
    sheet = (async () => {
      try {
        const [index, png] = await Promise.all([
          fetch(`${base}.json`).then(r => r.json()),
          fetch(`${base}.png`).then(r => r.blob()).then(createImageBitmap),
        ])
        const surface = canvas2d(png.width, png.height)
        if (!surface) return null
        surface.ctx.drawImage(png, 0, 0)
        return { index, pixels: surface.ctx.getImageData(0, 0, png.width, png.height) }
      } catch {
        return null
      }
    })()
    sheets.set(ratio, sheet)
  }
  return sheet
}

async function spriteArt(name: string, ratio: number): Promise<SdfSource | null> {
  const sheet = await spriteSheet(ratio)
  const box = sheet?.index[name]
  if (!sheet || !box) return null
  const data = new Uint8Array(box.width * box.height * 4)
  for (let y = 0; y < box.height; y++) {
    const from = ((box.y + y) * sheet.pixels.width + box.x) * 4
    data.set(sheet.pixels.data.subarray(from, from + box.width * 4), y * box.width * 4)
  }
  return { width: box.width, height: box.height, data, pixelRatio: ratio }
}

export interface PoiBadgeImage {
  url: string
  /** CSS pixels, lift and ring included, so the plate stays `MARKER_PLATE_SIZE` across. */
  width: number
  height: number
}

const images = new Map<string, Promise<PoiBadgeImage | null>>()

async function drawBadge(icon: BadgeIcon, colors: PoiBadgeColors): Promise<PoiBadgeImage | null> {
  const ratio = spriteRatio()
  const art =
    (icon.pack === 'maki' ? await spriteArt(`${PLATE_PREFIX[icon.plate ?? 'disc']}${icon.name}`, ratio) : null) ??
    (await bakeArt(icon, ratio))
  if (!art) return null

  const badge = composeBadge(art, { art: '', ...colors })
  const surface = canvas2d(badge.width, badge.height)
  if (!surface) return null
  // The badge is premultiplied, as MapLibre wants it; a canvas wants it straight.
  const straight = new Uint8ClampedArray(badge.data.length)
  for (let i = 0; i < badge.data.length; i += 4) {
    const a = badge.data[i + 3]
    for (let c = 0; c < 3; c++) straight[i + c] = a ? (badge.data[i + c] * 255) / a : 0
    straight[i + 3] = a
  }
  surface.ctx.putImageData(new ImageData(straight, badge.width, badge.height), 0, 0)
  return {
    url: surface.canvas.toDataURL(),
    width: badge.width / badge.pixelRatio,
    height: badge.height / badge.pixelRatio,
  }
}

/** The badge as an image for a DOM marker, cached per icon and colours. */
export function poiBadgeImage(icon: BadgeIcon, colors: PoiBadgeColors): Promise<PoiBadgeImage | null> {
  const key = poiBadgeName({ art: `${icon.plate ?? 'disc'}:${icon.pack}:${icon.name}`, ...colors })
  let image = images.get(key)
  if (!image) {
    image = drawBadge(icon, colors).catch(() => null)
    images.set(key, image)
  }
  return image
}
