import { computed } from 'vue'
import { useWindowSize } from '@vueuse/core'
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import * as LucideIcons from 'lucide-vue-next'
import type { LucideIcon } from 'lucide-vue-next'
import fuzzysort from 'fuzzysort'

// import { camelize, getCurrentInstance, toHandlerKey } from 'vue'

// Theme colors usable for collection / bookmark icons. Distinct from the
// shadcn accent color set in `theme.store.ts` (those drive global UI
// chrome). The neutrals are intentionally trimmed: zinc, stone, and gray
// have been dropped because they look too similar in the picker grid;
// `slate` and `neutral` cover the cool / warm-neutral cases. Default is
// `blue`.
export type ThemeColor =
  | 'parchment'
  | 'ink'
  | 'compass'
  | 'coral'
  | 'amber'
  | 'peach'
  | 'citrine'
  | 'olive'
  | 'forest'
  | 'moss'
  | 'teal'
  | 'sky'
  | 'cobalt'
  | 'periwinkle'
  | 'indigo'
  | 'violet'
  | 'iris'
  | 'magenta'
  | 'primary'

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
  // Light theme: tinted background with dark text. Dark theme: tinted
  // background with light text. Tailwind needs the literal class names
  // present in source for its scanner to pick them up — that's why this
  // is a static map rather than a string template. Unknown values fall
  // back to blue so historical rows that stored a removed color (zinc,
  // stone, gray) still render rather than blanking out.
  const colorClasses: Record<ThemeColor, string> = {
    parchment: 'bg-parchment-200 text-parchment-800 dark:bg-parchment-800 dark:text-parchment-200',
    ink: 'bg-ink-200 text-ink-800 dark:bg-ink-800 dark:text-ink-200',
    compass: 'bg-compass-200 text-compass-800 dark:bg-compass-800 dark:text-compass-200',
    coral: 'bg-coral-200 text-coral-800 dark:bg-coral-800 dark:text-coral-200',
    amber: 'bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200',
    peach: 'bg-peach-200 text-peach-800 dark:bg-peach-800 dark:text-peach-200',
    citrine: 'bg-citrine-200 text-citrine-800 dark:bg-citrine-800 dark:text-citrine-200',
    olive: 'bg-olive-200 text-olive-800 dark:bg-olive-800 dark:text-olive-200',
    forest: 'bg-forest-200 text-forest-800 dark:bg-forest-800 dark:text-forest-200',
    moss: 'bg-moss-200 text-moss-800 dark:bg-moss-800 dark:text-moss-200',
    teal: 'bg-teal-200 text-teal-800 dark:bg-teal-800 dark:text-teal-200',
    sky: 'bg-sky-200 text-sky-800 dark:bg-sky-800 dark:text-sky-200',
    cobalt: 'bg-cobalt-200 text-cobalt-800 dark:bg-cobalt-800 dark:text-cobalt-200',
    periwinkle: 'bg-periwinkle-200 text-periwinkle-800 dark:bg-periwinkle-800 dark:text-periwinkle-200',
    indigo: 'bg-indigo-200 text-indigo-800 dark:bg-indigo-800 dark:text-indigo-200',
    violet: 'bg-violet-200 text-violet-800 dark:bg-violet-800 dark:text-violet-200',
    iris: 'bg-iris-200 text-iris-800 dark:bg-iris-800 dark:text-iris-200',
    magenta: 'bg-magenta-200 text-magenta-800 dark:bg-magenta-800 dark:text-magenta-200',
    primary: 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary',
  }

  return colorClasses[color] ?? colorClasses.cobalt
}

/**
 * Ghost (soft-tinted) variant of getThemeColorClasses — lower-contrast
 * background and saturated foreground, with light/dark variants. Use for
 * icon tiles where the colour is decorative rather than primary content
 * (settings nav, place categories, etc.). Static map so Tailwind's
 * scanner picks up every variant.
 */
export function getThemeColorGhostClasses(color: ThemeColor): string {
  const colorClasses: Record<ThemeColor, string> = {
    parchment: 'bg-parchment-500/10 text-parchment-700 dark:bg-parchment-500/20 dark:text-parchment-300',
    ink: 'bg-ink-500/10 text-ink-700 dark:bg-ink-500/20 dark:text-ink-300',
    compass: 'bg-compass-500/10 text-compass-700 dark:bg-compass-500/20 dark:text-compass-300',
    coral: 'bg-coral-500/10 text-coral-700 dark:bg-coral-500/20 dark:text-coral-300',
    amber: 'bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    peach: 'bg-peach-500/10 text-peach-700 dark:bg-peach-500/20 dark:text-peach-300',
    citrine: 'bg-citrine-500/10 text-citrine-700 dark:bg-citrine-500/20 dark:text-citrine-300',
    olive: 'bg-olive-500/10 text-olive-700 dark:bg-olive-500/20 dark:text-olive-300',
    forest: 'bg-forest-500/10 text-forest-700 dark:bg-forest-500/20 dark:text-forest-300',
    moss: 'bg-moss-500/10 text-moss-700 dark:bg-moss-500/20 dark:text-moss-300',
    teal: 'bg-teal-500/10 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
    sky: 'bg-sky-500/10 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
    cobalt: 'bg-cobalt-500/10 text-cobalt-700 dark:bg-cobalt-500/20 dark:text-cobalt-300',
    periwinkle: 'bg-periwinkle-500/10 text-periwinkle-700 dark:bg-periwinkle-500/20 dark:text-periwinkle-300',
    indigo: 'bg-indigo-500/10 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
    violet: 'bg-violet-500/10 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
    iris: 'bg-iris-500/10 text-iris-700 dark:bg-iris-500/20 dark:text-iris-300',
    magenta: 'bg-magenta-500/10 text-magenta-700 dark:bg-magenta-500/20 dark:text-magenta-300',
    primary: 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary',
  }

  return colorClasses[color] ?? colorClasses.cobalt
}

/**
 * Reference hue (HSL, 0-360) for each ThemeColor that has one. The
 * neutrals (`slate`, `neutral`, `primary`) are intentionally null —
 * they're matched by saturation, not hue, in `closestThemeColor`.
 *
 * Hues are pulled from Tailwind's `*-500` shade so they correspond to
 * the same accent the picker swatches render with. Don't sweat exact
 * matching; we just need enough resolution for "this place is reddish"
 * to land on the rose/red/pink end of the wheel rather than green.
 */
const themeColorHues: Record<Exclude<ThemeColor, 'primary'>, number | null> = {
  compass: 31,
  coral: 40,
  amber: 60,
  peach: 75,
  citrine: 95,
  olive: 120,
  forest: 135,
  moss: 150,
  teal: 195,
  sky: 220,
  cobalt: 240,
  periwinkle: 260,
  indigo: 275,
  violet: 285,
  iris: 320,
  magenta: 340,
  parchment: null,
  ink: null,
}

function parseColorToHsl(
  input: string,
): { h: number; s: number; l: number } | null {
  // hsl(...) / hsla(...). Trim whitespace, optional `%` on s/l.
  const hslMatch = input.match(
    /^hsla?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%?\s*,\s*(\d+(?:\.\d+)?)%?/i,
  )
  if (hslMatch) {
    const h = ((parseFloat(hslMatch[1]) % 360) + 360) % 360
    return { h, s: parseFloat(hslMatch[2]), l: parseFloat(hslMatch[3]) }
  }
  // #rgb or #rrggbb hex
  let hex = input.trim().replace(/^#/, '')
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  if (hex.length !== 6) return null
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  if ([r, g, b].some(Number.isNaN)) return null
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s: s * 100, l: l * 100 }
}

/**
 * Snap an arbitrary CSS color string (hex, hsl, hsla) to the closest
 * `ThemeColor` we offer in the picker. Used when saving a bookmark to
 * convert the place's category color (which the server emits as a hex
 * or hsl string) into one of the discrete theme tokens collections /
 * bookmarks store. Returns `'blue'` when the input is unparseable.
 *
 * Matching rules:
 *   - Saturation < 8% → `neutral` (achromatic).
 *   - 8% ≤ saturation < 20% → `slate` (cool dim).
 *   - Otherwise → the entry in `themeColorHues` whose hue is closest on
 *     the color wheel (treating it as circular).
 */
export function closestThemeColor(input: string | null | undefined): ThemeColor {
  if (!input) return 'cobalt'
  const hsl = parseColorToHsl(input)
  if (!hsl) return 'cobalt'
  if (hsl.s < 8) return 'parchment'
  if (hsl.s < 20) return 'ink'

  let best: ThemeColor = 'cobalt'
  let bestDist = Infinity
  for (const [name, hue] of Object.entries(themeColorHues)) {
    if (hue === null) continue
    const diff = Math.abs(hsl.h - hue)
    const dist = Math.min(diff, 360 - diff)
    if (dist < bestDist) {
      bestDist = dist
      best = name as ThemeColor
    }
  }
  return best
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

// Color conversion utilities
export function rgbToHex(rgb: string): string {
  // Match rgb(r g b) or rgba(r g b a) or rgb(r, g, b) (commas optional, CSS Color 4)
  const m =
    rgb.match(/rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)/i) ??
    rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (!m) return '#04CB63'
  const r = Number(m[1]).toString(16).padStart(2, '0')
  const g = Number(m[2]).toString(16).padStart(2, '0')
  const b = Number(m[3]).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

export function hexToHsl(hex: string) {
  hex = hex.replace('#', '')
  // Expand 3-char shorthand (e.g. "abc" → "aabbcc")
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  const bigint = parseInt(hex, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  const rP = r / 255
  const gP = g / 255
  const bP = b / 255
  const max = Math.max(rP, gP, bP)
  const min = Math.min(rP, gP, bP)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rP:
        h = (gP - bP) / d + (gP < bP ? 6 : 0)
        break
      case gP:
        h = (bP - rP) / d + 2
        break
      case bP:
        h = (rP - gP) / d + 4
        break
    }
    h /= 6
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}

export function hslToHex(h: number, s: number, l: number) {
  h /= 360
  s /= 100
  l /= 100
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  let r: number, g: number, b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  const toHex = (x: number) => {
    const v = Math.round(x * 255)
    return v.toString(16).padStart(2, '0')
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function adjustLightness(hex: string, delta: number) {
  const { h, s, l } = hexToHsl(hex)
  const newL = Math.max(0, Math.min(100, l + delta))
  return hslToHex(h, s, newL)
}

/**
 * Parse Tailwind/theme HSL string to hex.
 * Supports "hsl(H S% L%)" (space-separated, no commas) and "hsl(H, S%, L%)".
 */
export function themeHslToHex(hslString: string): string | null {
  if (!hslString || typeof hslString !== 'string') return null
  const trimmed = hslString.trim()
  // Space-separated: hsl(221.2 83.2% 53.3%)
  const spaceMatch = trimmed.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/)
  if (spaceMatch) {
    const h = Number(spaceMatch[1])
    const s = Number(spaceMatch[2])
    const l = Number(spaceMatch[3])
    if (!Number.isNaN(h) && !Number.isNaN(s) && !Number.isNaN(l))
      return hslToHex(h, s, l)
  }
  // Comma-separated: hsl(221.2, 83.2%, 53.3%)
  const commaMatch = trimmed.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/)
  if (commaMatch) {
    const h = Number(commaMatch[1])
    const s = Number(commaMatch[2])
    const l = Number(commaMatch[3])
    if (!Number.isNaN(h) && !Number.isNaN(s) && !Number.isNaN(l))
      return hslToHex(h, s, l)
  }
  return null
}

/** Read theme primary from CSS variable (--primary) and convert to hex. Respects light/dark and accent. */
export function getPrimaryThemeHex(): string {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(
      '--primary',
    ).trim()
    if (!value) return getThemeColorHex('text-primary')
    // Theme stores primary as "H S% L%" (e.g. "221.2 83.2% 53.3%")
    const parts = value.split(/\s+/)
    if (parts.length >= 3) {
      const h = Number(parts[0])
      const s = Number(parts[1].replace('%', ''))
      const l = Number(parts[2].replace('%', ''))
      if (!Number.isNaN(h) && !Number.isNaN(s) && !Number.isNaN(l)) {
        return hslToHex(h, s, l)
      }
    }
  } catch {
    // fallback to span-based resolution
  }
  return getThemeColorHex('text-primary')
}

/** Resolve a Tailwind theme color utility (e.g. text-primary-700) to hex for canvas/MapLibre. */
export function getThemeColorHex(
  utilityClass:
    | 'text-primary'
    | 'text-primary-600'
    | 'text-primary-700'
    | 'text-primary-800'
    | 'text-primary-900',
): string {
  try {
    const span = document.createElement('span')
    span.style.position = 'absolute'
    span.style.left = '-9999px'
    span.className = utilityClass
    document.body.appendChild(span)
    const color = getComputedStyle(span).color
    document.body.removeChild(span)
    return rgbToHex(color)
  } catch {
    return '#04CB63'
  }
}

export function cssHslToHex(cssHsl: string): string {
  // Handle CSS HSL format like "hsl(var(--primary))"
  if (cssHsl.includes('var(--primary)')) {
    return getPrimaryThemeHex()
  }

  // Handle standard HSL format like "hsl(120, 50%, 50%)"
  const hslMatch = cssHsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/)
  if (hslMatch) {
    const h = parseInt(hslMatch[1])
    const s = parseInt(hslMatch[2])
    const l = parseInt(hslMatch[3])
    return hslToHex(h, s, l)
  }

  // Return default if parsing fails
  return '#04CB63'
}
