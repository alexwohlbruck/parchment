import colors from 'tailwindcss/colors'
import { TravelMode } from '@/types/directions.types'
import convert from 'color-convert'


// TODO: This conversion is imprecise and needs to be replaced
/**
 * Convert OKLCH string to hex
 * Tailwind v4 returns colors in OKLCH format like "oklch(98.7% 0.032 95.277)"
 */
export function oklchToHex(oklchString: string): string {
  // Check if it's already a hex color or regular color
  if (typeof oklchString !== 'string') return oklchString
  if (oklchString.startsWith('#')) return oklchString
  
  // Parse OKLCH string like "oklch(98.7% 0.032 95.277)"
  const match = oklchString.match(/oklch\(([^)]+)\)/)
  if (!match) return oklchString // Return original if not OKLCH format
  
  const parts = match[1].trim().split(/\s+/)
  if (parts.length !== 3) return oklchString
  
  // Parse lightness (remove % and convert to 0-100 scale)
  const l = parseFloat(parts[0].replace('%', ''))
  // Parse chroma - OKLCH chroma needs much higher scaling for LCH
  const c = parseFloat(parts[1]) * 300 // Increased from 100 to preserve saturation
  // Parse hue (already in degrees)
  const h = parseFloat(parts[2])
  
  try {
    // Convert LCH to RGB to hex
    // OKLCH is very similar to LCH, so this should work well
    const rgb = convert.lch.rgb([l, c, h])
    return `#${convert.rgb.hex(rgb)}`
  } catch (error) {
    console.error('Color conversion failed for:', oklchString, error)
    
    // Better fallback colors that match Tailwind's intended saturation
    // Based on the hue value to get more accurate colors
    const hue = parseFloat(parts[2])
    
    // Blue range (roughly 240-270 degrees)
    if (hue >= 240 && hue <= 270) return '#3b82f6' // blue-500
    // Purple range (roughly 280-320 degrees) 
    if (hue >= 280 && hue <= 320) return '#8b5cf6' // purple-500
    // Green range (roughly 120-180 degrees)
    if (hue >= 120 && hue <= 180) return '#10b981' // green-500
    // Orange range (roughly 20-60 degrees)
    if (hue >= 20 && hue <= 60) return '#f59e0b' // orange-500
    // Red range (roughly 0-20 or 340-360 degrees)
    if (hue <= 20 || hue >= 340) return '#ef4444' // red-500
    
    // Fallback for gray or unknown colors
    return '#6b7280' // gray-500
  }
}

/**
 * Color mapping for different travel modes
 * Used consistently across trip list UI and map route visualization
 */
export const TRAVEL_MODE_COLORS = {
  [TravelMode.WALKING]: {
    main: oklchToHex(colors.blue[400]),
    case: oklchToHex(colors.blue[600]),
    cssClass: 'bg-blue-400 dark:bg-blue-500',
  },
  [TravelMode.DRIVING]: {
    main: oklchToHex(colors.purple[400]),
    case: oklchToHex(colors.purple[600]),
    cssClass: 'bg-purple-400 dark:bg-purple-500',
  },
  [TravelMode.CYCLING]: {
    main: oklchToHex(colors.green[400]),
    case: oklchToHex(colors.green[600]),
    cssClass: 'bg-green-400 dark:bg-green-500',
  },
  [TravelMode.TRANSIT]: {
    main: oklchToHex(colors.gray[400]),
    case: oklchToHex(colors.gray[600]),
    cssClass: 'bg-gray-400 dark:bg-gray-500',
  },
  // Additional modes that might be used
  biking: {
    main: oklchToHex(colors.green[400]),
    case: oklchToHex(colors.green[600]),
    cssClass: 'bg-green-400 dark:bg-green-500',
  },
  motorcycle: {
    main: oklchToHex(colors.orange[400]),
    case: oklchToHex(colors.orange[600]),
    cssClass: 'bg-orange-400 dark:bg-orange-500',
  },
  truck: {
    main: oklchToHex(colors.red[400]),
    case: oklchToHex(colors.red[600]),
    cssClass: 'bg-red-400 dark:bg-red-500',
  },
} as const

/**
 * Get the main color for a travel mode
 */
export function getTravelModeColor(mode: string): string {
  return (
    TRAVEL_MODE_COLORS[mode as keyof typeof TRAVEL_MODE_COLORS]?.main ||
    oklchToHex(colors.gray[400])
  )
}

/**
 * Get the case/border color for a travel mode
 */
export function getTravelModeCaseColor(mode: string): string {
  return (
    TRAVEL_MODE_COLORS[mode as keyof typeof TRAVEL_MODE_COLORS]?.case ||
    oklchToHex(colors.gray[600])
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
