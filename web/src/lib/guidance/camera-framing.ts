// Decides where the navigation camera wants to be: how much road ahead to
// show, how tilted, and which way up. Springs in the camera smooth the result.

import { pointAt, edgeAt, type NavRoute } from './nav-route'
import type { PuckState } from './guidance-engine'
import { bearingDeg } from '@/lib/map/movement-interpolation'
import { angleDelta, normalizeDeg } from './spring'
import { modeProfile } from './mode-profiles'

export type CameraMode = 'north-up' | 'heading-up' | 'follow-3d'
export type BearingMode = 'straight' | 'look-ahead'

export const CAMERA_MODES: CameraMode[] = ['follow-3d', 'heading-up', 'north-up']

export interface CameraTuning {
  /** Seconds of travel the cruising view shows ahead of the puck. */
  aheadSeconds: number
  /** A maneuver closer than this many seconds takes over the framing. */
  maneuverSeconds: number
  /** Road shown past a maneuver, metres. */
  pastManeuver: number
  cruisePitch: number
  maneuverPitch: number
  /** Puck position as a fraction of the visible map height, from the top. */
  focal: number
  /** Look-ahead bearing: seconds of travel to aim at, and the clamp. */
  lookAheadSeconds: number
  lookAheadMaxDeg: number
}

export const DEFAULT_CAMERA_TUNING: CameraTuning = {
  aheadSeconds: 25,
  maneuverSeconds: 12,
  pastManeuver: 100,
  cruisePitch: 55,
  maneuverPitch: 35,
  focal: 0.86,
  lookAheadSeconds: 4,
  lookAheadMaxDeg: 45,
}


/** Room kept under the puck for the road-name pill, in CSS pixels. */
export const PUCK_FOOTROOM = 84
/** Zoom is sized to this share of the map, so a lower puck shows more road ahead rather than zooming in. */
const FRAMED_SHARE = 0.72

/** Where the puck sits, 0 (top) … 1 (bottom) of the visible map; low on screen, but never so low the road name is cut off. */
export function puckFocal(mode: CameraMode, tuning: CameraTuning, visibleHeight: number): number {
  if (mode === 'north-up') return 0.5
  return Math.max(0.5, Math.min(tuning.focal, 1 - PUCK_FOOTROOM / Math.max(1, visibleHeight)))
}

const FRAMED_TYPE = /turn|roundabout|destination|arrive/

const EARTH_CIRCUMFERENCE = 40075016.686
const TILE_SIZE = 512

export function modeRange(mode: string) {
  return modeProfile(mode).camera
}

export function metersPerPixel(zoom: number, lat: number): number {
  return (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * 2 ** zoom)
}

/** Zoom at which `meters` of ground spans `pixels` of screen, foreshortened by pitch. */
export function zoomForGroundSpan(meters: number, pixels: number, lat: number, pitch: number): number {
  const stretch = 1 / Math.max(0.35, Math.cos((pitch * Math.PI) / 180))
  const mpp = (meters / Math.max(1, pixels)) / stretch
  return Math.log2((EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * mpp))
}

export interface FramingInput {
  route: NavRoute
  puck: PuckState
  mode: CameraMode
  bearingMode: BearingMode
  travelMode: string
  /** Height of the unobstructed map, px. */
  visibleHeight: number
  /** Speed to size the view for, m/s; defaults to the puck's, floored by `framingSpeed`. */
  speed?: number
  tuning?: CameraTuning
}

export interface CameraTarget {
  zoom: number
  pitch: number
  bearing: number
  /** 0 (top) … 1 (bottom) of the visible map where the puck sits. */
  focal: number
  /** Seconds until the next framed maneuver; Infinity when none is near. */
  secondsToManeuver: number
  /** A maneuver is close enough to be sizing the view instead of speed. */
  framingManeuver: boolean
}

/** Continue, keep, merge and ramps don't change which road you're on; framing ignores them. */
function isFramedManeuver(step: NavRoute['steps'][number]): boolean {
  const { type, modifier } = step.instruction
  return modifier !== 'straight' && FRAMED_TYPE.test(type) && !/keep|merge/.test(type)
}

function framedManeuversAhead(route: NavRoute, puck: PuckState, within: number) {
  const ahead: NavRoute['steps'] = []
  for (let i = puck.stepIndex + 1; i < route.steps.length; i++) {
    const step = route.steps[i]
    if (step.startDistance - puck.s > within) break
    if (step.startDistance > puck.s + 1 && isFramedManeuver(step)) ahead.push(step)
  }
  return ahead
}

/** Speed the view is sized for: not below a share of the limit, so a red light doesn't zoom in. */
export function framingSpeed(route: NavRoute, puck: PuckState, travelMode: string): number {
  if (travelMode !== 'driving') return Math.max(puck.speed, travelMode === 'cycling' ? 4 : 1.3)
  const limitKmh = edgeAt(route, puck.s)?.speedLimit ?? edgeAt(route, puck.s)?.averageSpeed
  const floor = limitKmh ? (limitKmh / 3.6) * 0.7 : 6
  return Math.max(puck.speed, floor)
}

function lookAheadBearing(route: NavRoute, puck: PuckState, tuning: CameraTuning): number {
  const distance = Math.max(50, puck.speed * tuning.lookAheadSeconds)
  const target = pointAt(route, Math.min(route.length, puck.s + distance))
  if (target.lat === puck.position.lat && target.lng === puck.position.lng) return puck.bearing
  const delta = angleDelta(puck.bearing, bearingDeg(puck.position, target))
  const clamped = Math.max(-tuning.lookAheadMaxDeg, Math.min(tuning.lookAheadMaxDeg, delta))
  return normalizeDeg(puck.bearing + clamped)
}

export function frameCamera(input: FramingInput): CameraTarget {
  const tuning = input.tuning ?? DEFAULT_CAMERA_TUNING
  const { route, puck, mode, travelMode } = input
  const range = modeRange(travelMode)
  const speed = input.speed ?? framingSpeed(route, puck, travelMode)

  const cruise = Math.min(range.maxAhead, Math.max(range.minAhead, speed * tuning.aheadSeconds))
  const upcoming = framedManeuversAhead(route, puck, cruise)
  // Dense junctions (downtown) pull the view in; open road lets it out.
  let ahead = Math.max(range.minAhead, cruise / (1 + 0.15 * upcoming.length))
  let pitch = mode === 'follow-3d' ? tuning.cruisePitch * range.pitchScale : 0

  const maneuver = upcoming[0] ?? null
  const toManeuver = maneuver ? maneuver.startDistance - puck.s : Infinity
  const zone = Math.max(range.minManeuverZone, speed * tuning.maneuverSeconds)
  const framingManeuver = maneuver != null && toManeuver < zone
  if (maneuver && framingManeuver) {
    const closeness = 1 - toManeuver / zone
    const framed = Math.max(range.minAhead, toManeuver + tuning.pastManeuver)
    ahead = Math.min(ahead, Math.max(framed, ahead * (1 - closeness)))
    if (mode === 'follow-3d') {
      const turnPitch = tuning.maneuverPitch * range.pitchScale
      pitch = pitch + (turnPitch - pitch) * closeness
    }
  }

  const focal = puckFocal(mode, tuning, input.visibleHeight)
  const aheadPixels = input.visibleHeight * Math.min(focal, FRAMED_SHARE)
  const zoom = Math.min(
    range.maxZoom,
    Math.max(range.minZoom, zoomForGroundSpan(ahead, aheadPixels, puck.position.lat, pitch)),
  )

  const bearing =
    mode === 'north-up'
      ? 0
      : input.bearingMode === 'look-ahead'
        ? lookAheadBearing(route, puck, tuning)
        : puck.bearing

  return {
    zoom,
    pitch,
    bearing,
    focal,
    secondsToManeuver: maneuver ? toManeuver / Math.max(0.5, puck.speed) : Infinity,
    framingManeuver,
  }
}
