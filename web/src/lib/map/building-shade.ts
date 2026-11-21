/**
 * Sunlight on the 3D buildings — cast shadows on the ground and on each other,
 * ambient occlusion where a wall meets the ground, a darkening band up the
 * base of each wall, and facades.
 *
 * Drawn by MapLibre's own shading (`Map.setShading` in our fork), which lights
 * every extrusion layer marked `fill-extrusion-cast-shadows`; this module
 * holds how it is tuned and where the sun is.
 *
 * MapLibre only. Mapbox has this natively and the strategy adapter keeps the
 * two apart; see `MapStrategy.setBuildingShade`.
 */
import type { Map as MaplibreMap, OcclusionFrame, Shading, ShadingCaster } from 'maplibre-gl'
import type { FlavorId } from '@/lib/map-style/build'
import { BUILDING_TINT } from '@/lib/map-style/building-color.mjs'
import SunCalc from 'suncalc'
import { sunPosition } from './sun-position'
import { FACADE_FLAVOR, facadeWallShader } from './facade-shader'

export type { OcclusionFrame }

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
  band: 0.51,
  /** Zoom levels the ground effects ramp over, so they arrive with the buildings. */
  fadeZoom: 2.4,
  /** What the cast shadow drops to looking straight down, where it reads as a stain. */
  topDownOpacity: 0.5,
  aoRadiusMin: 26,
  aoRadiusMax: 58,
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
  light: { shadowAlpha: 0.25, aoIntensity: 0.33, strength: 0.26, edge: 0.28 },
  dark: { shadowAlpha: 0.25, aoIntensity: 0.57, strength: 0.39, edge: 0.44 },
}

/**
 * Daylight's colour: a warm sun and a cool sky multiplying the lit and shaded
 * sides, umber cast shadows that read as shade on paper rather than a blue stain, walls lightening toward their tops and
 * roofs a step above the walls. Night keeps the neutral defaults.
 */
const SHAPE_BY_FLAVOR: Record<FlavorId, Partial<typeof SHAPE>> = {
  light: { aoRadiusMin: 15, aoRadiusMax: 80 },
  dark: {},
}

export type ThemeShading = Partial<Pick<Shading, 'sunTint' | 'skyTint' | 'shadowColor' | 'wallRise' | 'roofLift'>>

const DAYLIGHT: Record<FlavorId, ThemeShading> = {
  light: {
    sunTint: [1.04, 1.01, 0.95],
    skyTint: [0.95, 0.96, 1.01],
    shadowColor: [0.33, 0.27, 0.25],
    wallRise: 0.14,
    roofLift: 0.07,
  },
  dark: {},
}

/** How much of the lamplight shows: lamps, lit signs and what lit buildings spill on the pavement. Night only. */
const LAMPLIGHT: Record<FlavorId, Partial<Pick<Shading, 'lightIntensity' | 'spillColor' | 'lightBlur'>>> = {
  light: { lightIntensity: 0 },
  dark: { lightIntensity: 0.6, spillColor: [0.5, 0.36, 0.2], lightBlur: 3 },
}

/**
 * How hard the sun is, per flavor — and the single biggest reason a wall looks
 * dark.
 *
 * The building shader's ambient floor is `1 - intensity`: a face the sun does
 * not reach is drawn at exactly that fraction of its lit colour. MapLibre
 * defaults to 0.5, which puts every shaded wall at *half* the roof's
 * brightness — far heavier than a real overcast bounce, and it reads as black
 * against our pale roofs. 0.42 leaves a 58% floor, cooled by the sky tint, so a wall stays plainly a
 * wall while the lit faces still separate from it.
 *
 * Night runs softer still: with no sun there is nothing to justify a hard
 * light-and-shade split.
 */
const LIGHT_INTENSITY: Record<FlavorId, number> = { light: 0.1, dark: 0.19 }

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
const EDGE_WIDTH_CSS_PX: Record<FlavorId, number> = { light: 1.9, dark: 2.55 }
function edgeWidth(flavor: FlavorId): number {
  return EDGE_WIDTH_CSS_PX[flavor] * (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)
}

/** Anything that casts shadows alongside the buildings: a custom layer's models. */
export type ShadowCaster = ShadingCaster

/**
 * Layers casting shadows alongside the buildings — the 3D landmarks, objects,
 * decks and tunnel walls. Module-level and handed to the shading by reference:
 * a layer added before the shading is turned on must not have to find it.
 */
export const shadowCasters = new Set<ShadowCaster>()

/**
 * The shading currently on the map, for the layers that match it and the dev
 * tuning panel. Every lever is a plain field read each frame, so tuning is a
 * matter of assigning to them.
 */
let live: Shading | null = null
export function liveBuildingShade(): Shading | null {
  return live
}

/**
 * Turn the map's shading on, tuned for a flavor. `minZoom` is the zoom the
 * style's building layer switches on at, which the ground effects ramp in from.
 */
export function createBuildingShade(map: MaplibreMap, flavor: FlavorId, minZoom?: number, theme?: ThemeShading): Shading {
  lightIntensity = LIGHT_INTENSITY[flavor]
  live = map.setShading({
    ...(minZoom === undefined ? {} : { minZoom }),
    shadowOffset: [...SHADOW_OFFSET],
    casters: shadowCasters,
    edgeWidth: edgeWidth(flavor),
    wallShader: facadeWallShader(FACADE_FLAVOR[flavor]),
    ...SHAPE,
    ...SHAPE_BY_FLAVOR[flavor],
    ...TUNING[flavor],
    ...DAYLIGHT[flavor],
    ...LAMPLIGHT[flavor],
    ...theme,
  })!
  return live
}

export function removeBuildingShade(map: MaplibreMap) {
  map.setShading(null)
  live = null
}

/**
 * The map light that matches a shadow direction, so the shading up a wall
 * agrees with the direction its shadow falls. The shading reads the light off
 * the style, so moving the sun means setting this again, not just its offset.
 */
export function shadeLight(
  offset: readonly [number, number] = SHADOW_OFFSET,
  altitude?: number,
) {
  const [x, y] = offset
  const azimuth = ((Math.atan2(-x, -y) * 180) / Math.PI + 360) % 360
  // MapLibre's polar angle is measured from straight overhead. The upper clamp
  // is cartographic: a real sun near the horizon lights the walls facing it
  // more than the roofs, and a dusk view flattens into one grey mass. Holding
  // the light no lower keeps roofs the brightest face at every hour.
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
  /** Ground-plane direction the shadow falls, +x east and +y north. */
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
 * The shading wants a ground-plane vector with +y pointing *north*, where a
 * compass bearing has north at 0 going clockwise. A sun at bearing `a` sits at
 * `(sin a, cos a)`; the shadow is the negative of that.
 */
export function sunShadow(date: Date, lat: number, lng: number): SunShadow {
  const { azimuth, altitude } = sunOverride ?? sunPosition(date, lat, lng)

  // Ease in over the few degrees above the cutoff rather than snapping on, so
  // sunrise arrives as a fade instead of a jump.
  const daylight = clamp((altitude - MIN_SUN_ALTITUDE) / (6 * RAD_PER_DEG), 0, 1)

  return { ...shadowFrom(azimuth, altitude), daylight }
}

/**
 * The light at night. A moon well up casts soft shadows, stronger the fuller it is; with none, the sky's glow from
 * nearly overhead still leaves short shadows at the foot of every wall. Shares of the daytime shadow's darkness.
 */
const NIGHT_LIGHT = { moonMin: 0.25, moonFull: 0.5, sky: 0.3, moonAltitude: 10 * RAD_PER_DEG, skyAltitude: 62 * RAD_PER_DEG, skyAzimuth: 300 * RAD_PER_DEG }

/** A cast shadow and how dark it is against the sun's at noon, 0 to 1. */
export type CastShadow = SunShadow & { strength: number }

function shadowFrom(azimuth: number, altitude: number): Pick<SunShadow, 'offset' | 'altitude' | 'heightScale'> {
  return {
    offset: [-Math.sin(azimuth), -Math.cos(azimuth)],
    altitude,
    heightScale: Math.min(1 / Math.tan(Math.max(altitude, MIN_SUN_ALTITUDE)), MAX_SHADOW_LENGTH),
  }
}

/** The night's light: the moon when it is well up, the sky's glow otherwise. */
export function nightShadow(date: Date, lat: number, lng: number): CastShadow {
  const moon = SunCalc.getMoonPosition(date, lat, lng)
  if (moon.altitude > NIGHT_LIGHT.moonAltitude) {
    const { fraction } = SunCalc.getMoonIllumination(date)
    const strength = NIGHT_LIGHT.moonMin + (NIGHT_LIGHT.moonFull - NIGHT_LIGHT.moonMin) * fraction
    return { ...shadowFrom(moon.azimuth + Math.PI, moon.altitude), daylight: 0, strength }
  }
  return { ...shadowFrom(NIGHT_LIGHT.skyAzimuth, NIGHT_LIGHT.skyAltitude), daylight: 0, strength: NIGHT_LIGHT.sky }
}

/** The shadow the map casts now: the sun's by day and through twilight, the night's light once the sun is down. */
export function castShadow(date: Date, lat: number, lng: number): CastShadow {
  const sun = sunShadow(date, lat, lng)
  if (sun.daylight >= 1) return { ...sun, strength: 1 }
  const night = nightShadow(date, lat, lng)
  return sun.daylight > 0 ? { ...sun, strength: Math.max(sun.daylight, night.strength) } : night
}

/** The tuned defaults, for the settings panel to open on and reset to. */
export function buildingShadeDefaults(flavor: FlavorId) {
  return {
    ...SHAPE,
    ...SHAPE_BY_FLAVOR[flavor],
    ...TUNING[flavor],
    edgeWidth: edgeWidth(flavor),
    shadowOffset: [...SHADOW_OFFSET] as [number, number],
    tint: BUILDING_TINT[flavor],
    intensity: LIGHT_INTENSITY[flavor],
  }
}
