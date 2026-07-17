/**
 * Shared AQI + wildfire color scales.
 *
 * The weather widget colors an AQI dot by normalized severity (1–6); the map
 * overlay needs the same scale as hex (MapLibre paint can't use Tailwind
 * classes). Single source of truth for both so they never drift.
 */

import { palette } from './palette'

/** Normalized AQI severity (1–6) → hex, for MapLibre paint. */
export const AQI_SEVERITY_HEX = [
  palette.forest[500], // 1 Good
  palette.amber[400], // 2 Fair
  palette.compass[500], // 3 Moderate
  palette.coral[500], // 4 Poor
  palette.violet[600], // 5 Very Poor
  palette.compass[900], // 6 Hazardous (deep red)
] as const

/** Same scale as Tailwind bg-* classes, for DOM dots (the widget). */
export const AQI_SEVERITY_CLASS = [
  'bg-forest-500',
  'bg-amber-400',
  'bg-compass-500',
  'bg-coral-500',
  'bg-violet-600',
  'bg-compass-900',
] as const

const clamp6 = (s: number) => Math.min(Math.max(Math.round(s), 1), 6)
export const aqiSeverityHex = (severity: number) =>
  AQI_SEVERITY_HEX[clamp6(severity) - 1]
export const aqiSeverityClass = (severity: number) =>
  AQI_SEVERITY_CLASS[clamp6(severity) - 1]

/**
 * The descriptive word for an AQI reading. Each standard shows its OWN official
 * category name — US EPA "Unhealthy for Sensitive Groups", EEA "Moderate", UK
 * "High", … — so the word always agrees with the number and its regional scale
 * (the way Apple/AirNow label a reading). Using one worldwide word scale mislabels
 * US readings, whose categories sit a notch above the generic severity words
 * (US AQI 125 is "Unhealthy for Sensitive Groups", not "Moderate"). Falls back
 * to the generic severity word if a standard-specific label is missing.
 *
 * `t`/`te` come from the caller's `useI18n()` (or `$t`/`$te` in a template).
 */
export function aqiCategoryLabel(
  aq: { standard?: string | null; severity?: number } | null | undefined,
  t: (key: string) => string,
  te: (key: string) => boolean,
): string {
  const severity = aq?.severity
  if (!severity) return ''
  const key = `weather.aqi.categories.${aq?.standard}.${severity}`
  return aq?.standard && te(key) ? t(key) : t(`weather.aqi.levels.${severity}`)
}

/** MapLibre expression: feature `severity` prop → hex. */
export const aqiSeverityColorExpression = (): unknown => [
  'match',
  ['get', 'severity'],
  1, AQI_SEVERITY_HEX[0],
  2, AQI_SEVERITY_HEX[1],
  3, AQI_SEVERITY_HEX[2],
  4, AQI_SEVERITY_HEX[3],
  5, AQI_SEVERITY_HEX[4],
  6, AQI_SEVERITY_HEX[5],
  '#9ca3af', // default (muted grey)
]

/** Fire heat gradient for the wildfire hotspot heatmap (density 0→1). */
export const FIRE_HEATMAP_GRADIENT: Array<[number, string]> = [
  [0, 'rgba(0,0,0,0)'],
  [0.2, '#7e0023'], // deep red glow
  [0.4, '#d84a00'], // red-orange
  [0.6, '#e97f00'], // orange
  [0.8, '#ffd000'], // yellow
  [1, '#ffffff'], // white-hot core
]

/** Wildfire vector styling. */
export const FIRE_POINT_COLOR = '#ff5a1f'
export const FIRE_POINT_STROKE = '#ffd000'
export const PERIMETER_FILL = palette.coral[500] // ember
export const PERIMETER_LINE = palette.coral[700]
export const SMOKE_COLOR = '#8a8f98'
