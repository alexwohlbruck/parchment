import { computed } from 'vue'
import { useWindowSize } from '@vueuse/core'
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import resolveConfig from 'tailwindcss/resolveConfig'
import tailwindConfig from '../../tailwind.config.js'

// import { camelize, getCurrentInstance, toHandlerKey } from 'vue'

const tailwind = resolveConfig(tailwindConfig)

export function getBreakpoints() {
  return tailwind.theme.screens
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
  const isDesktopScreen = computed(
    () => isMediumScreen.value || isLargeScreen.value,
  )

  return {
    isXSmallScreen,
    isSmallScreen,
    isMediumScreen,
    isLargeScreen,
    isMobileScreen,
    isDesktopScreen,
  }
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
