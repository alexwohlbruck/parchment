import convert from 'convert'
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '@/stores/app.store'
import { UnitSystem } from '@/types/map.types'

// TODO: See if we can replace this with a prebuilt library solution

export function useUnits() {
  const { unitSystem } = storeToRefs(useAppStore())
  const isMetric = computed(() => unitSystem.value === UnitSystem.METRIC)

  return {
    /** Format distance (input in meters). */
    formatDistance(meters: number, options?: { precision?: number }): string {
      const precision = options?.precision ?? 1
      if (isMetric.value) {
        if (meters < 1000) return `${Math.round(meters)} m`
        const km = convert(meters, 'm').to('km')
        return `${Number(km).toFixed(precision)} km`
      }
      const feet = convert(meters, 'm').to('ft')
      if (feet < 528) return `${Math.round(feet)} ft`
      const miles = convert(meters, 'm').to('mi')
      return `${Number(miles).toFixed(precision)} mi`
    },

    /** Format speed (input in m/s). */
    formatSpeed(metersPerSecond: number): string {
      if (isMetric.value) {
        const kmh = metersPerSecond * 3.6
        return `${Math.round(kmh)} km/h`
      }
      const mph = metersPerSecond * 2.236936
      return `${Math.round(mph)} mph`
    },

    /** Format temperature (input in Celsius). */
    formatTemperature(celsius: number): string {
      if (isMetric.value) return `${Math.round(celsius)}°C`
      const fahrenheit = convert(celsius, 'celsius').to('fahrenheit')
      return `${Math.round(Number(fahrenheit))}°F`
    },

    /** Format elevation (input in meters). */
    formatElevation(meters: number): string {
      if (isMetric.value) return `${Math.round(meters)} m`
      const feet = convert(meters, 'm').to('ft')
      return `${Math.round(Number(feet))} ft`
    },

    /** Format pressure (input in hPa). */
    formatPressure(hPa: number): string {
      if (isMetric.value) return `${Math.round(hPa)} hPa`
      const inHg = convert(hPa, 'hPa').to('inHg')
      return `${Number(inHg).toFixed(2)} inHg`
    },

    convert,
    unitSystem,
    isMetric,
  }
}
