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
import { BUILDING_TINT } from './map-style/building-color.mjs'
import { sunPosition } from './sun-position'

const RAD_PER_DEG = Math.PI / 180
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/**
 * Where the sun is, as a ground-plane offset for the cast shadows. Fixed rather
 * than astronomical: a real sun would rake shadows across half the city at
 * dawn and cast none at all at night, and the point of the effect is to read
 * building shape, not to tell the time.
 */
export const SHADOW_OFFSET: [number, number] = [0.6, -0.6]

/**
 * The levers that read the same in daylight and at night — shape rather than
 * weight. Tuned by eye in the settings panel; see `BuildingShadeTuner.vue`.
 */
const SHAPE = {
  /** How far up the wall the contact shading reaches, as a fraction of it. */
  band: 0.24,
  shadowBlur: 2,
  /** Zoom levels the ground effects ramp over, so they arrive with the buildings. */
  fadeZoom: 1.2,
  /** What the cast shadow drops to looking straight down, where it reads as a stain. */
  topDownOpacity: 0.5,
  aoRadiusMin: 26,
  aoRadiusMax: 58,
  aoOffset: [0, -0.5, -1] as [number, number, number],
}

/**
 * Night keeps the contact shading but nearly drops the cast shadow. Ambient
 * occlusion is what separates one building from the next, and it matters more
 * in the dark flavor, where every roof is a near-identical blue; a hard cast
 * shadow, on the other hand, implies a sun that is not up.
 *
 * Only light was tuned by eye. Dark holds the same ratios against it that it
 * had before, so the night map keeps its weaker shadow and firmer edge rather
 * than inheriting daylight values wholesale.
 */
const TUNING: Record<FlavorId, { shadowAlpha: number; aoIntensity: number; strength: number; edge: number }> = {
  light: { shadowAlpha: 0.32, aoIntensity: 0.47, strength: 0.04, edge: 0.18 },
  dark: { shadowAlpha: 0.135, aoIntensity: 0.35, strength: 0.035, edge: 0.2 },
}

/**
 * How hard the sun is, per flavor — and the single biggest reason a wall looks
 * dark.
 *
 * The building shader's ambient floor is `1 - intensity`: a face the sun does
 * not reach is drawn at exactly that fraction of its lit colour. MapLibre
 * defaults to 0.5, which puts every shaded wall at *half* the roof's
 * brightness — far heavier than a real overcast bounce, and it reads as black
 * against our pale roofs. 0.28 leaves a 72% floor, so a wall stays plainly a
 * wall while the lit faces still separate from it.
 *
 * Night runs softer still: with no sun there is nothing to justify a hard
 * light-and-shade split.
 */
const LIGHT_INTENSITY: Record<FlavorId, number> = { light: 0.28, dark: 0.2 }

/** How near the horizon the *shading* light may fall; see `shadeLight`. */
const MAX_LIGHT_POLAR = 58

/**
 * The live intensity, so the tuning panel can move it without rebuilding the
 * layer. `shadeLight` reads it on every sun update.
 */
let lightIntensity = LIGHT_INTENSITY.light
export function setShadeLightIntensity(value: number) {
  lightIntensity = value
}
export function shadeLightIntensity(flavor: FlavorId) {
  return LIGHT_INTENSITY[flavor]
}

/**
 * How wide the roofline edge is, in CSS pixels.
 *
 * The shader measures in drawing-buffer pixels, which are device pixels, so
 * this is scaled up to match — otherwise the edge would come out half as thick
 * on a retina display as on an ordinary one, which is the opposite of what a
 * border should do.
 */
const EDGE_WIDTH_CSS_PX = 1.55
function edgeWidth(): number {
  return EDGE_WIDTH_CSS_PX * (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)
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

/**
 * The layer currently on the map, for the dev tuning panel to drive.
 *
 * Every lever is a plain mutable field the layer reads each frame, so tuning is
 * a matter of assigning to them — there is no setter and nothing to invalidate.
 * A style swap builds a new layer and reassigns this.
 */
let live: WallShadowLayer | null = null
export function liveBuildingShade(): WallShadowLayer | null {
  return live
}

/**
 * `minZoom` is the zoom the *style's* building layer switches on at, and it has
 * to be passed rather than defaulted.
 *
 * The layer does not decorate MapLibre's building draw, it replaces it — the
 * caller sets the style layer's opacity to 0 — so this threshold is the only
 * thing deciding whether buildings appear in 3D at all. Leave it on the
 * vendored default of 15 while the style says 14 and the buildings simply
 * vanish for a whole zoom level.
 */
export function createBuildingShade(
  buildingsLayerId: string,
  flavor: FlavorId,
  minZoom?: number,
) {
  lightIntensity = LIGHT_INTENSITY[flavor]
  live = new WallShadowLayer({
    id: BUILDING_SHADE_LAYER_ID,
    buildingsLayerId,
    ...(minZoom === undefined ? {} : { minZoom }),
    shadowOffset: [...SHADOW_OFFSET],
    sdfResolution: sdfResolution(),
    edgeWidth: edgeWidth(),
    ...SHAPE,
    ...TUNING[flavor],
  })
  return live
}

/**
 * The map light that matches a shadow direction, so the shading up a wall
 * agrees with the direction its shadow falls. The layer reads the light off the
 * style rather than taking it as an option, which is what keeps the two in step
 * — so moving the sun means setting this again, not just the layer's offset.
 */
export function shadeLight(
  offset: readonly [number, number] = SHADOW_OFFSET,
  altitude?: number,
) {
  const [x, y] = offset
  const azimuth = ((Math.atan2(-x, -y) * 180) / Math.PI + 360) % 360
  // MapLibre's polar angle is measured from straight overhead, so it is the
  // sun's altitude subtracted from 90 — a sun high in the sky is a small polar
  // angle.
  //
  // The upper clamp is the important one, and it is a cartographic choice
  // rather than a physical one. A real sun near the horizon lights the *walls*
  // facing it more strongly than the roofs, because a roof's normal points
  // straight up and away from a low sun. That is correct, and it reads wrong:
  // a map wants the roof to be the top surface, so a dusk view flattens into
  // one grey mass. Holding the light no lower than this keeps roofs the
  // brightest face at every hour, while direction and shadow length still
  // follow the real sun.
  const polar = altitude === undefined
    ? 30
    : clamp(90 - (altitude * 180) / Math.PI, 12, MAX_LIGHT_POLAR)
  return {
    anchor: 'map' as const,
    position: [1.2, azimuth, polar] as [number, number, number],
    intensity: lightIntensity,
  }
}

// ---------------------------------------------------------------------------
// Real sun
// ---------------------------------------------------------------------------

/**
 * Below this the sun is too low to cast a shadow worth drawing: the length runs
 * away toward infinity and the light is doing nothing but grazing. Civil
 * twilight is -6°, but shadows stop reading well long before that.
 */
const MIN_SUN_ALTITUDE = 4 * RAD_PER_DEG

/**
 * How long a shadow may get, as a multiple of building height. Geometry says
 * `1 / tan(altitude)`, which is 14 at 4° and unbounded at the horizon — long
 * enough to smear across the whole viewport and swamp the map.
 */
const MAX_SHADOW_LENGTH = 2.2

/** Ambient occlusion holds steady; only the cast shadow follows the sun. */
export type SunShadow = {
  /** Ground-plane direction the shadow falls, +x east and +y south. */
  offset: [number, number]
  /** Radians above the horizon, for the style light's polar angle. */
  altitude: number
  /** Shadow length as a multiple of building height. */
  heightScale: number
  /** 0 when the sun is down, easing in as it clears the horizon. */
  daylight: number
}

/**
 * A hand-set sun, replacing the computed one. Dev tuning only: the real sun is
 * whatever time it happens to be, which makes it useless for judging how the
 * lighting reads at noon or at dusk without waiting for the day to turn.
 */
let sunOverride: { azimuth: number; altitude: number } | null = null

export function setSunOverride(sun: { azimuth: number; altitude: number } | null) {
  sunOverride = sun
}

export function isSunOverridden(): boolean {
  return sunOverride !== null
}

/**
 * Where this place's shadows actually fall, right now.
 *
 * The sun's compass bearing gives the direction — a shadow points away from the
 * sun — and its altitude gives the length, long at dawn and short at noon, so a
 * morning map and an afternoon map no longer look identical.
 *
 * The layer wants a ground-plane vector with +y pointing *south*, where a
 * compass bearing has north at 0 going clockwise. A sun at bearing `a` sits at
 * `(sin a, -cos a)`; the shadow is the negative of that.
 */
export function sunShadow(date: Date, lat: number, lng: number): SunShadow {
  const { azimuth, altitude } = sunOverride ?? sunPosition(date, lat, lng)

  // Ease in over the few degrees above the cutoff rather than snapping on, so
  // sunrise arrives as a fade instead of a jump.
  const daylight = clamp((altitude - MIN_SUN_ALTITUDE) / (6 * RAD_PER_DEG), 0, 1)

  const length = altitude > MIN_SUN_ALTITUDE
    ? Math.min(1 / Math.tan(altitude), MAX_SHADOW_LENGTH)
    : MAX_SHADOW_LENGTH

  return {
    offset: [-Math.sin(azimuth), Math.cos(azimuth)],
    altitude,
    heightScale: length,
    daylight,
  }
}

/** The tuned defaults, for the settings panel to open on and reset to. */
export function buildingShadeDefaults(flavor: FlavorId) {
  return {
    ...SHAPE,
    ...TUNING[flavor],
    edgeWidth: edgeWidth(),
    shadowOffset: [...SHADOW_OFFSET] as [number, number],
    tint: BUILDING_TINT[flavor],
    intensity: LIGHT_INTENSITY[flavor],
  }
}
