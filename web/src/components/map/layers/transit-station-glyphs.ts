/**
 * Station-navigation POI glyphs.
 *
 * Registers three tintable SDF images used by the station-infrastructure symbol
 * layers (entrances, elevators, stairs). Like `transit-bullet.ts` they are SDF,
 * so `icon-color` can tint them per feature/theme (Apple-orange entrances,
 * accessibility-blue elevators, grey stairs) without a pre-built sprite — and
 * `addImage` works identically on Mapbox GL and MapLibre. Idempotent per map.
 *
 * The glyphs are drawn as thick white strokes on a padded canvas so the SDF
 * edge threshold (which erodes ~1px) doesn't clip them.
 */
export const GLYPH_ENTRANCE = 'transit-glyph-entrance'
export const GLYPH_ELEVATOR = 'transit-glyph-elevator'
export const GLYPH_STAIR = 'transit-glyph-stair'

// Lucide-style stroke paths in a 24-unit box (kept within ~3..21 for padding).
// Entrance: a downward chevron over a floor line — "descend into the station".
const ENTRANCE_PATHS = ['M12 4 v9', 'M7 9 l5 5 l5 -5', 'M5 19 h14']
// Elevator: two vertical arrows (up + down) side by side.
const ELEVATOR_PATHS = [
  'M9 5 v14',
  'M6.5 8 L9 5 L11.5 8',
  'M15 19 v-14',
  'M12.5 16 L15 19 L17.5 16',
]
// Stairs: rising steps.
const STAIR_PATHS = ['M3 20 h4 v-4 h4 v-4 h4 v-4 h4']

/**
 * Rasterise lucide-style stroke paths to a white-on-transparent 2x image and
 * register it as an SDF so `icon-color` can tint it.
 */
function ensureGlyph(map: any, id: string, paths: string[]): void {
  if (!map || typeof map.hasImage !== 'function' || map.hasImage(id)) return
  const r = 2
  const size = 22
  const canvas = document.createElement('canvas')
  canvas.width = size * r
  canvas.height = size * r
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale((size * r) / 24, (size * r) / 24)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2.8 // thick so the SDF edge threshold doesn't erode the glyph
  for (const d of paths) ctx.stroke(new Path2D(d))
  const image = ctx.getImageData(0, 0, size * r, size * r)
  try {
    map.addImage(id, image, { pixelRatio: r, sdf: true })
  } catch {
    // May already exist from a concurrent style load.
  }
}

export function ensureTransitStationGlyphs(map: any): void {
  ensureGlyph(map, GLYPH_ENTRANCE, ENTRANCE_PATHS)
  ensureGlyph(map, GLYPH_ELEVATOR, ELEVATOR_PATHS)
  ensureGlyph(map, GLYPH_STAIR, STAIR_PATHS)
}
