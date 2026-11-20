/**
 * The basemap's green fills through the year: lawns go straw in winter and vivid in
 * spring, and woods seen from above turn rust in fall and grey-brown once bare.
 * Summer is the style's own colour. The year is the plants' (see `map-objects/seasons`).
 */
import type { FlavorId } from './build'
import lightTokens from './tokens.light.json'
import darkTokens from './tokens.dark.json'

/** The fills that change, by layer id, and the token each one's own colour comes from. */
export const GROUND_LAYERS = {
  Grass: 'grass_fill_color',
  Cemetery: 'cemetery_fill_color',
  Wood: 'wood_fill_color',
} as const

export type GroundLayer = keyof typeof GROUND_LAYERS

/** Day of a northern year, the hue the fill moves toward, its saturation and lightness as a share of its own, and how far it moves. */
type Key = [day: number, hue: number, saturation: number, lightness: number, weight: number]

const LAWN: Key[] = [
  [20, 46, 0.42, 1.12, 0.85],
  [75, 64, 0.55, 1.07, 0.65],
  [120, 98, 1.15, 1.04, 0.6],
  [185, 0, 1, 1, 0],
  [235, 72, 0.85, 1.03, 0.35],
  [295, 56, 0.7, 1.05, 0.55],
  [335, 46, 0.48, 1.1, 0.78],
]

const WOODLAND: Key[] = [
  [20, 28, 0.28, 1.04, 0.78],
  [95, 34, 0.4, 1.03, 0.6],
  [125, 96, 1.1, 1.04, 0.55],
  [185, 0, 1, 1, 0],
  [262, 0, 1, 1, 0],
  [290, 30, 1, 1.02, 0.62],
  [320, 26, 0.5, 1.0, 0.72],
]

const KEYS: Record<GroundLayer, Key[]> = { Grass: LAWN, Cemetery: LAWN, Wood: WOODLAND }

const TOKENS: Record<FlavorId, Record<string, string>> = { light: lightTokens, dark: darkTokens }

function at(keys: Key[], day: number): [hue: number, saturation: number, lightness: number, weight: number] {
  const next = keys.findIndex(k => k[0] > day)
  const b = keys[next === -1 ? 0 : next]
  const a = keys[next <= 0 ? keys.length - 1 : next - 1]
  const span = (b[0] - a[0] + 365) % 365 || 365
  const t = ((day - a[0] + 365) % 365) / span
  // A summer key has no hue to move toward: hold the neighbour's, so weight alone eases in and out.
  const hueA = a[4] ? a[1] : b[1]
  const hueB = b[4] ? b[1] : a[1]
  const lerp = (x: number, y: number) => x + (y - x) * t
  return [lerp(hueA, hueB), lerp(a[2], b[2]), lerp(a[3], b[3]), lerp(a[4], b[4])]
}

const parse = (hsl: string) => (hsl.match(/-?[\d.]+/g) ?? []).map(Number) as [number, number, number]

/** A fill's colour on a point in the plants' year (0-1), as `hsl()`. */
export function groundColor(layer: GroundLayer, flavor: FlavorId, year: number): string {
  const [h, s, l] = parse(TOKENS[flavor][GROUND_LAYERS[layer]])
  const [hue, saturation, lightness, weight] = at(KEYS[layer], (((year % 1) + 1) % 1) * 365)
  const toward = (from: number, to: number) => from + (to - from) * weight
  const sat = Math.min(100, s * toward(1, saturation))
  const light = Math.min(96, l * toward(1, lightness))
  return `hsl(${toward(h, hue).toFixed(1)}, ${sat.toFixed(1)}%, ${light.toFixed(1)}%)`
}

/** A fill's colour as the style has it. */
export function baseGroundColor(layer: GroundLayer, flavor: FlavorId): string {
  return TOKENS[flavor][GROUND_LAYERS[layer]]
}
