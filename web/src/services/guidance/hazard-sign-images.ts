// Registers the route's hazard signs as map images for a symbol layer.

import type { Map as MaplibreMap } from 'maplibre-gl'
import { HAZARD_SIGNS } from '@/lib/guidance/hazard-signs'
import type { HazardSignKind } from '@/lib/guidance/hazard-callouts'

const PIXEL_RATIO = 2
const PREFIX = 'guidance-sign-'

/** The `icon-image` expression for a feature carrying its hazard `kind`. */
export const HAZARD_SIGN_IMAGE = ['concat', PREFIX, ['get', 'kind']]

export function ensureHazardSignImages(map: MaplibreMap): void {
  for (const [kind, sign] of Object.entries(HAZARD_SIGNS) as [HazardSignKind, (typeof HAZARD_SIGNS)[HazardSignKind]][]) {
    const id = PREFIX + kind
    if (map.hasImage(id)) continue
    const canvas = document.createElement('canvas')
    canvas.width = sign.width * PIXEL_RATIO
    canvas.height = sign.height * PIXEL_RATIO
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(PIXEL_RATIO, PIXEL_RATIO)
    ctx.lineJoin = 'round'
    for (const { d, fill, stroke, width } of sign.strokes) {
      const path = new Path2D(d)
      if (fill) {
        ctx.fillStyle = fill
        ctx.fill(path)
      }
      if (stroke) {
        ctx.strokeStyle = stroke
        ctx.lineWidth = width ?? 1
        ctx.stroke(path)
      }
    }
    map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: PIXEL_RATIO })
  }
}
