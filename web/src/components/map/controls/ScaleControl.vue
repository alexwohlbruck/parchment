<script setup lang="ts">
import { useMapCamera } from '@/composables/useMapCamera'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { LngLat } from '@/types/map.types'
import { useMapService } from '@/services/map.service'
import { useResponsive } from '@/lib/utils'

const mapService = useMapService()
const { camera, onCameraMove } = useMapCamera()
const { isMobileScreen, isMediumScreen } = useResponsive()
const useMetric = ref(false) // TODO: Create user setting for this

onMounted(() => {
  mapService.on('move', onCameraMove)
})

onUnmounted(() => {
  mapService.off('move', onCameraMove)
})

// Calculate scale segments based on a pattern of growing and merging
function calculateScaleSegments(width: number, unit: string) {
  // Define the base units we want to use
  const baseUnits = {
    ft: [3, 6, 12, 25, 50, 125, 250, 500, 1000],
    mi: [
      0.125, 0.25, 0.5, 1, 1.25, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500,
      5000, 10000,
    ],
    m: [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000],
    km: [1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  }

  const units = baseUnits[unit]

  // Find the appropriate base unit - the first one larger than 1/4 of the width
  const baseUnitIndex = units.findIndex(u => u > width / 4)
  const baseUnit = units[Math.max(0, baseUnitIndex)]

  // Calculate how many full units fit in our target width
  const fullUnitsFit = width / baseUnit

  let segments: number[]

  // Special cases for nice round numbers
  if (unit === 'km' || unit === 'mi') {
    if (Math.abs(width - 1) < 0.2) {
      segments = [0, 1]
    } else if (Math.abs(width - 2) < 0.3) {
      segments = [0, 1, 2]
    } else if (Math.abs(width - 3) < 0.3) {
      segments = [0, 1, 2, 3]
    } else if (fullUnitsFit < 0.85) {
      // Show just 2 segments
      segments = [0, baseUnit]
    } else if (fullUnitsFit < 1.7) {
      // Show 3 segments
      segments = [0, baseUnit, baseUnit * 2]
    } else if (fullUnitsFit < 2.5) {
      // Show 3 segments with a larger base unit
      const nextBaseUnit = units[Math.min(baseUnitIndex + 1, units.length - 1)]
      segments = [0, nextBaseUnit / 2, nextBaseUnit]
    } else {
      // Show 4 segments
      segments = [0, baseUnit, baseUnit * 2, baseUnit * 3]
    }
  } else {
    // For meters and feet, use the regular segmentation
    if (fullUnitsFit < 0.85) {
      segments = [0, baseUnit]
    } else if (fullUnitsFit < 1.7) {
      segments = [0, baseUnit, baseUnit * 2]
    } else if (fullUnitsFit < 2.5) {
      const nextBaseUnit = units[Math.min(baseUnitIndex + 1, units.length - 1)]
      segments = [0, nextBaseUnit / 2, nextBaseUnit]
    } else {
      segments = [0, baseUnit, baseUnit * 2, baseUnit * 3]
    }
  }

  return segments
}

// Calculate scale based on zoom level and latitude
const scale = computed(() => {
  const center = camera.value.center as LngLat
  const lat = Array.isArray(center) ? center[1] : center.lat
  const zoom = camera.value.zoom

  // At zoom level 0, one pixel represents about 78271.5170 meters at the equator
  // TODO: This gets slightly inaccurate at extreme latitudes. Cross ref with mapbox source code
  const metersPerPixel =
    (78271.517 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)

  // We want to show a scale that's roughly 150px wide
  const targetWidthMeters = metersPerPixel * 150

  if (useMetric.value) {
    let unit = 'm'
    let targetWidth = targetWidthMeters

    // Switch to kilometers if distance is greater than 1000 meters
    if (targetWidth > 1000) {
      unit = 'km'
      targetWidth = targetWidth / 1000
    }

    // Calculate segments using our algorithm
    const segments = calculateScaleSegments(targetWidth, unit)

    // Calculate the pixel width based on the last segment
    const meters =
      unit === 'km'
        ? segments[segments.length - 1] * 1000 // kilometers to meters
        : segments[segments.length - 1] // already in meters
    const width = meters / metersPerPixel

    return {
      width,
      segments,
      unit,
    }
  } else {
    const targetWidthFeet = targetWidthMeters * 3.28084
    let unit = 'ft'
    let targetWidth = targetWidthFeet

    // Switch to miles if distance is greater than 1000 feet
    if (targetWidth > 1000) {
      unit = 'mi'
      targetWidth = targetWidth / 5280
    }

    // Calculate segments using our algorithm
    const segments = calculateScaleSegments(targetWidth, unit)

    // Calculate the pixel width based on the last segment
    const meters =
      unit === 'mi'
        ? segments[segments.length - 1] * 1609.34 // miles to meters
        : segments[segments.length - 1] * 0.3048 // feet to meters
    const width = meters / metersPerPixel

    return {
      width,
      segments,
      unit,
    }
  }
})

const formatDistance = (
  value: number,
  unit: string,
  showUnit: boolean = false,
) => {
  switch (unit) {
    case 'ft':
      return `${Math.round(value)}${showUnit ? ' ft' : ''}`
    case 'mi':
      if (value < 1) {
        const formatted = value.toFixed(3).replace(/\.?0+$/, '')
        return `${formatted}${showUnit ? ' mi' : ''}`
      }
      return `${Math.round(value)}${showUnit ? ' mi' : ''}`
    case 'm':
      return `${Math.round(value)}${showUnit ? ' m' : ''}`
    case 'km':
      if (value < 10) {
        const formatted = value.toFixed(1).replace(/\.?0+$/, '')
        return `${formatted}${showUnit ? ' km' : ''}`
      }
      return `${Math.round(value)}${showUnit ? ' km' : ''}`
    default:
      return value.toString()
  }
}

function toggleUnits() {
  useMetric.value = !useMetric.value
}

const isLowZoom = computed(() => {
  const threshold = isMobileScreen.value ? 1.7 : isMediumScreen.value ? 2.5 : 3
  return camera.value.zoom < threshold
})
</script>

<template>
  <div class="flex flex-col items-start gap-1 pt-4">
    <!-- Scale bar with alternating segments -->
    <div class="relative">
      <!-- Segments with alternating colors -->
      <div
        class="flex h-1.5 rounded overflow-hidden cursor-pointer transition-[background-color,border-color] duration-300"
        :class="[
          isLowZoom
            ? 'ring-1 ring-slate-700'
            : 'ring-1 ring-slate-200 dark:ring-slate-700',
        ]"
        @click="toggleUnits"
      >
        <template
          v-for="(value, index) in scale.segments.slice(0, -1)"
          :key="index"
        >
          <div
            class="h-full transition-colors duration-300"
            :class="[
              isLowZoom
                ? index % 2 === 0
                  ? 'bg-slate-900'
                  : 'bg-slate-500'
                : index % 2 === 0
                ? 'bg-slate-400 dark:bg-slate-900'
                : 'bg-white dark:bg-slate-500',
            ]"
            :style="{
              width: `${
                (scale.width * (scale.segments[index + 1] - value)) /
                scale.segments[scale.segments.length - 1]
              }px`,
            }"
          ></div>
        </template>
      </div>

      <!-- Labels -->
      <div class="absolute -top-4 left-0 w-full flex justify-between">
        <template v-for="(value, index) in scale.segments" :key="index">
          <div class="flex flex-col items-center">
            <span
              class="text-[.65rem] font-bold transition-colors duration-300"
              :class="[
                isLowZoom
                  ? 'text-slate-200'
                  : 'text-slate-500 dark:text-slate-200',
              ]"
              >{{
                formatDistance(
                  value,
                  scale.unit,
                  index === scale.segments.length - 1,
                )
              }}</span
            >
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
