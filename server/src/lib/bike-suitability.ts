/**
 * The bike suitability colour ramp, shared by the map layer and the route's
 * bike-friendly profile so a street reads the same colour in both.
 */

/** [score, hue, saturation %, lightness %], red at 0 through green at 100. */
export const BIKE_SUITABILITY_STOPS: [number, number, number, number][] = [
  [0, 358, 78, 46],
  [30, 14, 88, 52],
  [50, 34, 96, 52],
  [65, 50, 96, 50],
  [80, 88, 62, 44],
  [100, 142, 64, 34],
]

const hsl = (h: number, s: number, l: number) => `hsl(${h}, ${s}%, ${l}%)`

/** The ramp as a MapLibre `interpolate` over the feature's `score`. */
export const BIKE_SUITABILITY_COLOR_EXPRESSION = [
  'interpolate', ['linear'], ['get', 'score'],
  ...BIKE_SUITABILITY_STOPS.flatMap(([score, h, s, l]) => [score, hsl(h, s, l)]),
]

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255)) as [number, number, number]
}

/** The colour a score is drawn in, interpolated in RGB as MapLibre does; `darken` (0-1) for a casing. */
export function bikeSuitabilityColor(score: number, darken = 0): string {
  const x = Math.max(0, Math.min(100, score))
  const i = Math.max(0, BIKE_SUITABILITY_STOPS.findIndex(([s]) => s >= x) - 1)
  const [s0, ...a] = BIKE_SUITABILITY_STOPS[i]
  const [s1, ...b] = BIKE_SUITABILITY_STOPS[Math.min(i + 1, BIKE_SUITABILITY_STOPS.length - 1)]
  const t = s1 === s0 ? 0 : (x - s0) / (s1 - s0)
  const ca = hslToRgb(a[0], a[1], a[2])
  const cb = hslToRgb(b[0], b[1], b[2])
  const rgb = ca.map((v, j) => Math.round((v + (cb[j] - v) * t) * (1 - darken)))
  return `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`
}
