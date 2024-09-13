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
