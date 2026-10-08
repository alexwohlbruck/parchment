import type { FlavorId } from '@/lib/map-style/build'
import { palette } from '@/lib/palette'
import type { DeckPalette } from './deck-layer'

const rgb = (hex: string): [number, number, number] =>
  [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]

/** The asphalt and paint match the flat roads' (see `road-markings.ts`), so a deck reads as the same road. */
export const DECK_PALETTE: Record<FlavorId, DeckPalette> = {
  light: {
    surface: [0.78, 0.79, 0.82],
    concrete: [0.84, 0.83, 0.8],
    parapet: [0.91, 0.9, 0.87],
    white: [1, 1, 1],
    yellow: [0.97, 0.78, 0.21],
    route: rgb(palette.forest[400]),
    routeCasing: rgb(palette.forest[600]),
  },
  dark: {
    surface: [0.23, 0.24, 0.28],
    concrete: [0.31, 0.32, 0.34],
    parapet: [0.37, 0.38, 0.4],
    white: [0.85, 0.85, 0.85],
    yellow: [0.82, 0.66, 0.2],
    route: rgb(palette.forest[400]),
    routeCasing: rgb(palette.forest[600]),
  },
}
