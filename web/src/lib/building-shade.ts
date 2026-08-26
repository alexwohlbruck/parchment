/**
 * Sunlight on the 3D buildings — cast shadows on the ground, ambient occlusion
 * where a wall meets it, and a darkening band up the base of each wall.
 *
 * MapLibre has no lighting model beyond a flat directional tint: there is no
 * `fill-extrusion-ambient-occlusion-*` the way Mapbox Standard has, and no
 * shadow of any kind. Everything here is drawn by a `CustomLayerInterface` that
 * borrows MapLibre's own fill-extrusion vertex buffers and re-draws them across
 * four GPU passes, so no geometry is uploaded twice. The layer is vendored from
 * wallabyway/maplibre-building-shadows; see `vendor/ao-shadow.mjs` for the two
 * lines we changed to run it on MapLibre 4.
 *
 * It *replaces* MapLibre's building draw rather than adding to it — the caller
 * hides `Building 3D` by setting its opacity to 0, which early-outs the built-in
 * draw while leaving its tiles and buckets alive for us to read.
 *
 * MapLibre only. Mapbox has this natively and the strategy adapter keeps the
 * two apart; see `MapStrategy.setBuildingShade`.
 */
import { WallShadowLayer } from './vendor/ao-shadow.mjs'
import type { FlavorId } from './map-style/build'

/**
 * Where the sun is, as a ground-plane offset for the cast shadows. Fixed rather
 * than astronomical: a real sun would rake shadows across half the city at
 * dawn and cast none at all at night, and the point of the effect is to read
 * building shape, not to tell the time.
 */
export const SHADOW_OFFSET: [number, number] = [-0.5, 0.5]

/**
 * Night keeps the contact shading but nearly drops the cast shadow. Ambient
 * occlusion is what separates one building from the next, and it matters more
 * in the dark flavor, where every roof is a near-identical blue; a hard cast
 * shadow, on the other hand, implies a sun that is not up.
 */
const TUNING: Record<FlavorId, { shadowAlpha: number; aoIntensity: number; strength: number }> = {
  light: { shadowAlpha: 0.33, aoIntensity: 0.8, strength: 0.5 },
  dark: { shadowAlpha: 0.14, aoIntensity: 0.6, strength: 0.42 },
}

/**
 * The SDF the ground AO is computed in. 1024 costs ~40MB of VRAM; half that
 * costs a quarter of it and is not far off visually, which is the better trade
 * on a phone.
 */
function sdfResolution(): number {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  return coarse ? 512 : 1024
}

export const BUILDING_SHADE_LAYER_ID = 'building-shade'

export function createBuildingShade(buildingsLayerId: string, flavor: FlavorId) {
  return new WallShadowLayer({
    id: BUILDING_SHADE_LAYER_ID,
    buildingsLayerId,
    shadowOffset: SHADOW_OFFSET,
    sdfResolution: sdfResolution(),
    ...TUNING[flavor],
  })
}

/**
 * The map light that matches {@link SHADOW_OFFSET}, so the shading up a wall
 * agrees with the direction its shadow falls. The layer reads the light off the
 * style rather than taking it as an option, which is what keeps the two in step.
 */
export function shadeLight() {
  const [x, y] = SHADOW_OFFSET
  const azimuth = ((Math.atan2(-x, -y) * 180) / Math.PI + 360) % 360
  return { anchor: 'map' as const, position: [1.2, azimuth, 30] as [number, number, number], intensity: 0.5 }
}
