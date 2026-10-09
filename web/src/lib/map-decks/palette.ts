import type { FlavorId } from '@/lib/map-style/build'
import { palette } from '@/lib/palette'
import type { DeckPalette } from './deck-layer'

const rgb = (hex: string): [number, number, number] =>
  [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]

/** The asphalt and paint match the flat roads' (see `road-markings.ts`), so a deck reads as the same road. */
export const DECK_PALETTE: Record<FlavorId, DeckPalette> = {
  light: {
    surface: [0.71, 0.7, 0.69],
    concrete: [0.84, 0.83, 0.8],
    parapet: [0.91, 0.9, 0.87],
    white: [0.99, 0.98, 0.97],
    yellow: [0.89, 0.73, 0.31],
    route: rgb(palette.forest[400]),
    routeCasing: rgb(palette.forest[600]),
  },
  dark: {
    surface: [0.24, 0.25, 0.26],
    concrete: [0.31, 0.32, 0.34],
    parapet: [0.37, 0.38, 0.4],
    white: [0.63, 0.62, 0.61],
    yellow: [0.65, 0.53, 0.26],
    route: rgb(palette.forest[400]),
    routeCasing: rgb(palette.forest[600]),
  },
}
