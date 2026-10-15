import type { FlavorId } from '@/lib/map-style/build'
import { palette } from '@/lib/palette'
import type { DeckPalette } from './deck-layer'

const rgb = (hex: string): [number, number, number] =>
  [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]

/** The asphalt and paint match the flat roads' (see `road-markings.ts`), so a deck reads as the same road. */
export const DECK_PALETTE: Record<FlavorId, DeckPalette> = {
  light: {
    surface: [0.56, 0.57, 0.58],
    concrete: [0.84, 0.83, 0.8],
    parapet: [0.91, 0.9, 0.87],
    white: [0.98, 0.97, 0.96],
    yellow: [0.95, 0.84, 0.17],
    green: [0.45, 0.71, 0.58],
    red: [0.8, 0.49, 0.44],
    route: rgb(palette.forest[400]),
    routeCasing: rgb(palette.forest[600]),
  },
  dark: {
    surface: [0.24, 0.25, 0.26],
    concrete: [0.31, 0.32, 0.34],
    parapet: [0.37, 0.38, 0.4],
    white: [0.64, 0.64, 0.62],
    yellow: [0.74, 0.66, 0.24],
    green: [0.26, 0.4, 0.33],
    red: [0.42, 0.27, 0.24],
    route: rgb(palette.forest[400]),
    routeCasing: rgb(palette.forest[600]),
  },
}
