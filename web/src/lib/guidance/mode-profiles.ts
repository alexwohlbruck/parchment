// Everything guidance tunes per way of travelling, in one place.

export interface ModeProfile {
  /** Speed prompts and framing are sized for when the traveller is slower. */
  baseSpeed: number
  /** Distance from the leg's end that counts as arrived. */
  arrivalRadius: number
  /** Distance from a segment's end at which its handoff card shows. */
  handoffRadius: number
  /** Kalman jerk noise: higher follows sharper speed changes. */
  jerkSigma: number
  /** Below this reported speed a fix counts as stationary. */
  stillSpeed: number
  camera: {
    minAhead: number
    maxAhead: number
    minZoom: number
    maxZoom: number
    minManeuverZone: number
    pitchScale: number
  }
  /** Which speed widgets the screen shows. */
  speedometer: boolean
  speedLimit: boolean
}

export const MODE_PROFILES: Record<string, ModeProfile> = {
  driving: {
    baseSpeed: 13.9,
    arrivalRadius: 30,
    handoffRadius: 40,
    jerkSigma: 1.5,
    stillSpeed: 0.7,
    camera: { minAhead: 150, maxAhead: 2000, minZoom: 13, maxZoom: 17.5, minManeuverZone: 180, pitchScale: 1 },
    speedometer: true,
    speedLimit: true,
  },
  cycling: {
    baseSpeed: 5,
    arrivalRadius: 20,
    handoffRadius: 30,
    jerkSigma: 1,
    stillSpeed: 0.5,
    camera: { minAhead: 90, maxAhead: 600, minZoom: 15, maxZoom: 18, minManeuverZone: 80, pitchScale: 0.9 },
    speedometer: true,
    speedLimit: false,
  },
  walking: {
    baseSpeed: 1.4,
    arrivalRadius: 15,
    handoffRadius: 20,
    jerkSigma: 0.5,
    stillSpeed: 0.3,
    camera: { minAhead: 50, maxAhead: 250, minZoom: 16.5, maxZoom: 18.5, minManeuverZone: 40, pitchScale: 0.8 },
    speedometer: false,
    speedLimit: false,
  },
}

/** Server and client spell modes a few ways; bike-share rides are cycling. */
export function modeProfile(mode: string): ModeProfile {
  const key = mode === 'biking' ? 'cycling' : mode
  return MODE_PROFILES[key] ?? MODE_PROFILES.driving
}
