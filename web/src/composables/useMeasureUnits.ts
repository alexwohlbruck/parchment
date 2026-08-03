import { ref, computed, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app.store'
import { UnitSystem } from '@/types/map.types'
import {
  DISTANCE_UNITS,
  AREA_UNITS,
  formatMeasureDistance,
  formatMeasureArea,
  formatMeasureDistanceInUnit,
  formatMeasureAreaInUnit,
  getSmartDistanceUnitIndex,
  getSmartAreaUnitIndex,
  type UnitSystem as MeasureUnitSystem,
} from '@/lib/measure.utils'

/**
 * The measure panels' unit behaviour: pick a sensible unit automatically, and
 * let a tap on the readout cycle through the rest.
 *
 * Measure and Radius carried byte-identical copies of this — four refs, two
 * reset watchers, two formatters and two cycle functions each, differing only
 * in the name of the unit-system ref. Isochrone uses the formatting half
 * without the cycling.
 *
 * Values are passed per call rather than held here, because what's being
 * measured differs per tool (path length, radius, circumference) and a tool
 * may format several quantities off the same unit selection.
 */
export function useMeasureUnits(isActive: Ref<boolean>) {
  const appStore = useAppStore()
  const { unitSystem } = storeToRefs(appStore)
  const { locale } = useI18n()

  const preferred = (): MeasureUnitSystem =>
    unitSystem.value === UnitSystem.IMPERIAL ? 'imperial' : 'metric'

  /** Panel-local, so switching units here doesn't change the app setting. */
  const system = ref<MeasureUnitSystem>(preferred())

  const distanceIndex = ref(0)
  const areaIndex = ref(0)
  /** Until the user cycles, the unit is chosen to suit the magnitude. */
  const distanceCycled = ref(false)
  const areaCycled = ref(false)

  function resetCycling() {
    distanceIndex.value = 0
    areaIndex.value = 0
    distanceCycled.value = false
    areaCycled.value = false
  }

  // Re-opening the panel starts from the app's unit system again.
  watch(isActive, active => {
    if (active) {
      system.value = preferred()
      resetCycling()
    }
  })
  watch(system, resetCycling)

  const distanceUnits = computed(() => DISTANCE_UNITS[system.value])
  const areaUnits = computed(() => AREA_UNITS[system.value])

  /** `null` for zero, so callers can render a placeholder instead of "0 m". */
  function formatDistance(meters: number): string | null {
    if (meters === 0) return null
    if (!distanceCycled.value)
      return formatMeasureDistance(meters, system.value, locale.value)
    const units = distanceUnits.value
    const index = Math.min(distanceIndex.value, units.length - 1)
    return formatMeasureDistanceInUnit(meters, units[index], locale.value)
  }

  function formatArea(squareMeters: number): string | null {
    if (squareMeters === 0) return null
    if (!areaCycled.value)
      return formatMeasureArea(squareMeters, system.value, locale.value)
    const units = areaUnits.value
    const index = Math.min(areaIndex.value, units.length - 1)
    return formatMeasureAreaInUnit(squareMeters, units[index], locale.value)
  }

  /**
   * First tap adopts the unit currently being shown, so the value doesn't jump
   * before it steps; subsequent taps advance through the list.
   */
  function cycleDistance(meters: number) {
    if (!distanceCycled.value) {
      distanceCycled.value = true
      distanceIndex.value = getSmartDistanceUnitIndex(meters, system.value)
    }
    distanceIndex.value = (distanceIndex.value + 1) % distanceUnits.value.length
  }

  function cycleArea(squareMeters: number) {
    if (!areaCycled.value) {
      areaCycled.value = true
      areaIndex.value = getSmartAreaUnitIndex(squareMeters, system.value)
    }
    areaIndex.value = (areaIndex.value + 1) % areaUnits.value.length
  }

  return {
    system,
    formatDistance,
    formatArea,
    cycleDistance,
    cycleArea,
  }
}
