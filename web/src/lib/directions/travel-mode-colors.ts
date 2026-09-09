import { TravelMode } from '@/types/directions.types'
import { palette } from '@/lib/palette'

export const TRAVEL_MODE_COLORS = {
  [TravelMode.WALKING]: {
    main: palette.cobalt[400],
    case: palette.cobalt[600],
    cssClass: 'bg-cobalt-400 dark:bg-cobalt-500',
  },
  [TravelMode.DRIVING]: {
    main: palette.violet[400],
    case: palette.violet[600],
    cssClass: 'bg-violet-400 dark:bg-violet-500',
  },
  [TravelMode.CYCLING]: {
    main: palette.forest[400],
    case: palette.forest[600],
    cssClass: 'bg-forest-400 dark:bg-forest-500',
  },
  [TravelMode.TRANSIT]: {
    main: palette.parchment[400],
    case: palette.parchment[600],
    cssClass: 'bg-parchment-400 dark:bg-parchment-500',
  },
  biking: {
    main: palette.forest[400],
    case: palette.forest[600],
    cssClass: 'bg-forest-400 dark:bg-forest-500',
  },
  motorcycle: {
    main: palette.coral[400],
    case: palette.coral[600],
    cssClass: 'bg-coral-400 dark:bg-coral-500',
  },
  truck: {
    main: palette.compass[400],
    case: palette.compass[600],
    cssClass: 'bg-compass-400 dark:bg-compass-500',
  },
} as const

export function getTravelModeColor(mode: string): string {
  return (
    TRAVEL_MODE_COLORS[mode as keyof typeof TRAVEL_MODE_COLORS]?.main ||
    palette.parchment[400]
  )
}

export function getTravelModeCaseColor(mode: string): string {
  return (
    TRAVEL_MODE_COLORS[mode as keyof typeof TRAVEL_MODE_COLORS]?.case ||
    palette.parchment[600]
  )
}

export function getTravelModeCssClass(mode: string): string {
  return (
    TRAVEL_MODE_COLORS[mode as keyof typeof TRAVEL_MODE_COLORS]?.cssClass ||
    'bg-parchment-400 dark:bg-parchment-500'
  )
}
