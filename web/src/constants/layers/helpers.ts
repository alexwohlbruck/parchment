import { cssHslToHex } from '@/lib/utils'
import { useStorage } from '@vueuse/core'
import { DEFAULT_SERVER_URL } from '@/lib/constants'
import { computed } from 'vue'

// Dynamic color functions for reactive theme updates
export function getPlacePolygonFillColor(): string {
  return cssHslToHex('hsl(var(--primary))')
}

export function getPlacePolygonStrokeColor(): string {
  return cssHslToHex('hsl(var(--primary))')
}

// Reactive server URL
export const serverUrl = useStorage(
  'parchment-selected-server',
  DEFAULT_SERVER_URL,
)

// Reactive helper function to build API proxy URLs
export const buildProxyUrl = computed(() => {
  return (endpoint: string): string => {
    const baseUrl = serverUrl.value.endsWith('/')
      ? serverUrl.value.slice(0, -1)
      : serverUrl.value
    return `${baseUrl}/proxy/${endpoint}`
  }
})
