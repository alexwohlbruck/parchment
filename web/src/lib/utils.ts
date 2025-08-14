import { computed } from 'vue'
import { useWindowSize } from '@vueuse/core'
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import * as LucideIcons from 'lucide-vue-next'
import type { LucideIcon } from 'lucide-vue-next'
import fuzzysort from 'fuzzysort'

// import { camelize, getCurrentInstance, toHandlerKey } from 'vue'

// Define type for shadcn UI colors
export type ThemeColor =
  | 'zinc'
  | 'rose'
  | 'blue'
  | 'green'
  | 'orange'
  | 'red'
  | 'slate'
  | 'stone'
  | 'gray'
  | 'neutral'
  | 'yellow'
  | 'violet'

export function getBreakpoints() {
  // Default Tailwind CSS breakpoints - hardcoded since v4 doesn't provide runtime config access
  return {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px',
  }
}

// TODO: Move to composables directory
export function useResponsive() {
  const { width } = useWindowSize()
  const breakpoints = getBreakpoints()

  const isXSmallScreen = computed(() => width.value < parseInt(breakpoints.sm))
  const isSmallScreen = computed(
    () =>
      width.value >= parseInt(breakpoints.sm) &&
      width.value < parseInt(breakpoints.md),
  )
  const isMediumScreen = computed(
    () =>
      width.value >= parseInt(breakpoints.md) &&
      width.value < parseInt(breakpoints.lg),
  )
  const isLargeScreen = computed(() => width.value >= parseInt(breakpoints.lg))

  const isMobileScreen = computed(
    () => isXSmallScreen.value || isSmallScreen.value,
  )
  const isTabletScreen = computed(
    () => isMobileScreen.value || isSmallScreen.value || isMediumScreen.value,
  )
  const isDesktopScreen = computed(
    () => isMediumScreen.value || isLargeScreen.value,
  )

  return {
    isXSmallScreen,
    isSmallScreen,
    isMediumScreen,
    isLargeScreen,
    isMobileScreen,
    isTabletScreen,
    isDesktopScreen,
  }
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Get CSS classes for a theme color that adapt to light/dark mode
 * @param color Theme color name
 * @returns Tailwind CSS classes for that color
 */
export function getThemeColorClasses(color: ThemeColor): string {
  // Map to provide light theme background with dark text or dark theme background with light text
  const colorClasses: Record<ThemeColor, string> = {
    zinc: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200',
    rose: 'bg-rose-200 text-rose-800 dark:bg-rose-800 dark:text-rose-200',
    blue: 'bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-200',
    green: 'bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200',
    orange:
      'bg-orange-200 text-orange-800 dark:bg-orange-800 dark:text-orange-200',
    red: 'bg-red-200 text-red-800 dark:bg-red-800 dark:text-red-200',
    slate: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
    stone: 'bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200',
    gray: 'bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    neutral:
      'bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200',
    yellow:
      'bg-yellow-200 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200',
    violet:
      'bg-violet-200 text-violet-800 dark:bg-violet-800 dark:text-violet-200',
  }

  return colorClasses[color]
}

/**
 * A generic fuzzy search filter function that can work with any array of objects
 * @param items Array of objects to filter
 * @param term Search term to filter by
 * @param options Configuration options for filtering
 * @param options.keys Object keys to search within
 * @param options.preserveOrder Whether to preserve the original order of items (default: false)
 * @param options.threshold Score threshold for results (default: 0)
 * @returns Filtered array of objects
 */
export function fuzzyFilter<T>(
  items: T[],
  term: string,
  options: {
    keys?: (keyof T | string)[]
    preserveOrder?: boolean
    threshold?: number
  } = {},
): T[] {
  const { keys = [], preserveOrder = false, threshold = 0 } = options

  if (!term) return items

  const results = fuzzysort.go(term, items, {
    keys: keys as string[],
    threshold: threshold,
  })

  if (preserveOrder) {
    const matchedItemsSet = new Set(results.map(result => result.obj))
    return items.filter(item => matchedItemsSet.has(item))
  }

  return results.map(result => result.obj)
}

/**
 * Pass-through filter that doesn't filter the array
 * Useful when you want to use a consistent API but delegate filtering to another source
 * @param items Array of items
 * @param term Search term (unused)
 * @returns The original array unmodified
 */
export function noFilter<T>(items: T[], term: string): T[] {
  return items
}

/**
 * Simple string inclusion filter that checks if string properties contain the search term
 * @param items Array of objects to filter
 * @param term Search term to filter by
 * @param keys Object keys to search within
 * @returns Filtered array of objects
 */
export function simpleFilter<T>(
  items: T[],
  term: string,
  keys: (keyof T)[] = [],
): T[] {
  if (!term) return items

  const lowerTerm = term.toLowerCase()

  return items.filter(item => {
    return keys.some(key => {
      const value = item[key]
      if (typeof value === 'string') {
        return value.toLowerCase().includes(lowerTerm)
      }
      return false
    })
  })
}

// https://valhalla.github.io/valhalla/decoding
export function decodeShape(str, precision = 6) {
  var index = 0,
    lat = 0,
    lng = 0,
    coordinates: number[][] = [],
    shift = 0,
    result = 0,
    byte: number | null = null,
    latitude_change,
    longitude_change,
    factor = Math.pow(10, precision)

  while (index < str.length) {
    byte = null
    shift = 0
    result = 0

    do {
      byte = str.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    latitude_change = result & 1 ? ~(result >> 1) : result >> 1

    shift = result = 0

    do {
      byte = str.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    longitude_change = result & 1 ? ~(result >> 1) : result >> 1

    lat += latitude_change
    lng += longitude_change

    coordinates.push([lat / factor, lng / factor])
  }

  return coordinates
}
