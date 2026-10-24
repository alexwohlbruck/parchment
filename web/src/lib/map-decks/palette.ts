import type { FlavorId } from '@/lib/map-style/build'
import lightTokens from '@/lib/map-style/tokens.light.json'
import darkTokens from '@/lib/map-style/tokens.dark.json'
import { palette } from '@/lib/palette'
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

const TOKENS: Record<FlavorId, Record<string, string>> = { light: lightTokens, dark: darkTokens }

/** The basemap's own road and path colours, which a deck takes below street zoom, for the walkways it carries and for a street deck's top beside its carriageway. */
const basemap = (flavor: FlavorId) => {
  const t = TOKENS[flavor]
  return { lowRoad: hsl(t.road_minor), lowMajor: hsl(t.road_major), lowHighway: hsl(t.road_highway), lowPath: hsl(t.path_surface), walkway: hsl(t.path_surface), deck: hsl(t.path_surface) }
}

/** The asphalt and paint match the flat roads' (see `road-markings.ts`), so a deck reads as the same road. */
export const DECK_PALETTE: Record<FlavorId, DeckPalette> = {
  light: {
    surface: [0.56, 0.57, 0.58],
    concrete: [0.84, 0.83, 0.8],
    parapet: [0.91, 0.9, 0.87],
    track: [0.78, 0.77, 0.75],
    rail: [0.5, 0.5, 0.5],
    white: [0.98, 0.97, 0.96],
    yellow: [0.95, 0.84, 0.17],
    green: [0.45, 0.71, 0.58],
    red: [0.8, 0.49, 0.44],
    route: rgb(palette.forest[400]),
    routeCasing: rgb(palette.forest[600]),
    ...basemap('light'),
  },
  dark: {
    surface: [0.24, 0.25, 0.26],
    concrete: [0.31, 0.32, 0.34],
    parapet: [0.37, 0.38, 0.4],
    track: [0.3, 0.31, 0.32],
    rail: [0.46, 0.46, 0.47],
    white: [0.64, 0.64, 0.62],
    yellow: [0.74, 0.66, 0.24],
    green: [0.26, 0.4, 0.33],
    red: [0.42, 0.27, 0.24],
    route: rgb(palette.forest[400]),
    routeCasing: rgb(palette.forest[600]),
    ...basemap('dark'),
  },
}
