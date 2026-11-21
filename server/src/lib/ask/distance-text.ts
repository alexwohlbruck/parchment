import type { AskUnits } from '../../types/ask.types'

const FEET_PER_METER = 3.28084
const METERS_PER_MILE = 1609.344

/** "450 ft", "1.2 mi", "80 m", "3.4 km": what Ask should repeat, in the user's units. */
export function distanceText(meters: number, units: AskUnits): string {
  if (units === 'imperial') {
    return meters < METERS_PER_MILE / 10
      ? `${Math.max(10, Math.round((meters * FEET_PER_METER) / 10) * 10)} ft`
      : `${(meters / METERS_PER_MILE).toFixed(1)} mi`
  }
  return meters < 1000 ? `${Math.max(10, Math.round(meters / 10) * 10)} m` : `${(meters / 1000).toFixed(1)} km`
}

/** "130 ft", "40 m": a climb, in the user's units. */
export function climbText(meters: number, units: AskUnits): string {
  return units === 'imperial' ? `${Math.round(meters * FEET_PER_METER)} ft` : `${Math.round(meters)} m`
}
