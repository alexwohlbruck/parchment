import colors from 'tailwindcss/colors'
import { TravelMode } from '@/types/directions.types'

/**
 * Color mapping for different travel modes
 * Used consistently across trip list UI and map route visualization
 */
export const TRAVEL_MODE_COLORS = {
  [TravelMode.WALKING]: {
    main: colors.blue[400],
    case: colors.blue[600],
    cssClass: 'bg-blue-400 dark:bg-blue-500',
  },
  [TravelMode.DRIVING]: {
    main: colors.purple[400],
    case: colors.purple[600],
    cssClass: 'bg-purple-400 dark:bg-purple-500',
  },
  [TravelMode.CYCLING]: {
    main: colors.green[400],
    case: colors.green[600],
    cssClass: 'bg-green-400 dark:bg-green-500',
  },
  [TravelMode.TRANSIT]: {
    main: colors.gray[400],
    case: colors.gray[600],
    cssClass: 'bg-gray-400 dark:bg-gray-500',
  },
  // Additional modes that might be used
  biking: {
    main: colors.green[400],
    case: colors.green[600],
    cssClass: 'bg-green-400 dark:bg-green-500',
  },
  motorcycle: {
    main: colors.orange[400],
    case: colors.orange[600],
    cssClass: 'bg-orange-400 dark:bg-orange-500',
  },
  truck: {
    main: colors.red[400],
    case: colors.red[600],
    cssClass: 'bg-red-400 dark:bg-red-500',
  },
} as const

/**
 * Get the main color for a travel mode
 */
export function getTravelModeColor(mode: string): string {
  return (
    TRAVEL_MODE_COLORS[mode as keyof typeof TRAVEL_MODE_COLORS]?.main ||
    colors.gray[400]
  )
}

/**
 * Get the case/border color for a travel mode
 */
export function getTravelModeCaseColor(mode: string): string {
  return (
    TRAVEL_MODE_COLORS[mode as keyof typeof TRAVEL_MODE_COLORS]?.case ||
    colors.gray[600]
  )
}

/**
 * Get the CSS class for a travel mode (for UI components)
 */
export function getTravelModeCssClass(mode: string): string {
  return (
    TRAVEL_MODE_COLORS[mode as keyof typeof TRAVEL_MODE_COLORS]?.cssClass ||
    'bg-gray-400 dark:bg-gray-500'
  )
}
