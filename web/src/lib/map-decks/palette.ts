import type { FlavorId } from '@/lib/map-style/build'
import lightTokens from '@/lib/map-style/tokens.light.json'
import darkTokens from '@/lib/map-style/tokens.dark.json'
import { palette } from '@/lib/palette'
import { ROAD_COLORS } from '@/lib/map-style/road-markings'
import { TRAVELLED_CASE_COLOR, TRAVELLED_COLOR } from '@/lib/guidance/route-line'
import type { DeckPalette } from './deck.types'

type Rgb = [number, number, number]

const rgb = (hex: string): Rgb =>
  [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb

/** An `hsl(h, s%, l%)` colour as rgb, 0-1. */
export function hsl(text: string): Rgb {
  const [h, s, l] = (text.match(/-?[\d.]+/g) ?? []).map(Number)
  const [sat, light] = [s / 100, l / 100]
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(light, 1 - light)
  return [0, 8, 4].map(n => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) as Rgb
}

/** A style colour, `#rrggbb` or `hsl(…)`, as rgb. */
const css = (text: string): Rgb => (text.startsWith('#') ? rgb(text) : hsl(text))

/** The flat roads' asphalt and paint, so a deck reads as the same road. */
const paint = (flavor: FlavorId) => {
  const c = ROAD_COLORS[flavor]
  return { surface: css(c.asphalt), white: css(c.white), yellow: css(c.yellow), green: css(c.green), red: css(c.red) }
}

const TOKENS: Record<FlavorId, Record<string, string>> = { light: lightTokens, dark: darkTokens }

/** The basemap's own road and path colours, which a deck takes below street zoom, for the walkways it carries and for a street deck's top beside its carriageway. */
const basemap = (flavor: FlavorId) => {
  const t = TOKENS[flavor]
  return { lowRoad: hsl(t.road_minor), lowMajor: hsl(t.road_major), lowHighway: hsl(t.road_highway), lowPath: hsl(t.path_surface), walkway: hsl(t.path_surface), deck: hsl(t.path_surface) }
}

export const DECK_PALETTE: Record<FlavorId, DeckPalette> = {
  light: {
    concrete: [0.84, 0.83, 0.8],
    parapet: [0.91, 0.9, 0.87],
    track: [0.78, 0.77, 0.75],
    rail: [0.5, 0.5, 0.5],
    route: rgb(palette.forest[400]),
    routeCasing: rgb(palette.forest[600]),
    travelled: rgb(TRAVELLED_COLOR),
    travelledCasing: rgb(TRAVELLED_CASE_COLOR),
    ...paint('light'),
    ...basemap('light'),
  },
  dark: {
    concrete: [0.31, 0.32, 0.34],
    parapet: [0.37, 0.38, 0.4],
    track: [0.3, 0.31, 0.32],
    rail: [0.46, 0.46, 0.47],
    route: rgb(palette.forest[400]),
    routeCasing: rgb(palette.forest[600]),
    travelled: rgb(TRAVELLED_COLOR),
    travelledCasing: rgb(TRAVELLED_CASE_COLOR),
    ...paint('dark'),
    ...basemap('dark'),
  },
}

/** The palette with routes on decks drawn in other colours, as the navigated route's. */
export function withRouteColors(base: DeckPalette, route: string, casing: string): DeckPalette {
  return { ...base, route: rgb(route), routeCasing: rgb(casing) }
}
