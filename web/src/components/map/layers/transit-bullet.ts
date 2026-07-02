/**
 * Transit route bullet image.
 *
 * Registers a single SDF circle image ('transit-bullet') on the map. Because it
 * is an SDF, symbol layers can tint it per-feature with `icon-color` (the route
 * colour) and stretch it to fit 1–3 character designations with
 * `icon-text-fit: both` — giving Apple-style coloured route bullets without a
 * pre-built sprite (works on web and the native SDKs). Idempotent per map.
 */
export const TRANSIT_BULLET_IMAGE_ID = 'transit-bullet'

export function ensureTransitBulletImage(map: any): void {
  if (!map || typeof map.hasImage !== 'function') return
  if (map.hasImage(TRANSIT_BULLET_IMAGE_ID)) return

  const r = 2 // retina pixel ratio
  const size = 22
  const w = size * r
  const data = new Uint8ClampedArray(w * w * 4)
  const c = w / 2
  const radius = c - 1.5 * r // leave a little padding for the anti-alias edge
  const spread = 3 * r // SDF anti-alias spread in px

  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      // Signed distance: positive inside the circle, negative outside.
      const sd = radius - Math.hypot(x - c + 0.5, y - c + 0.5)
      // Mapbox/MapLibre SDF convention: the glyph edge sits at alpha 191/255.
      const a = Math.max(0, Math.min(255, Math.round(191 + (sd / spread) * 255)))
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = a
    }
  }

  try {
    map.addImage(
      TRANSIT_BULLET_IMAGE_ID,
      { width: w, height: w, data },
      { pixelRatio: r, sdf: true },
    )
  } catch {
    // Image may already exist from a concurrent style load.
  }
}
