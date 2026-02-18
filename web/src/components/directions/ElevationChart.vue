<script setup lang="ts">
import { computed } from 'vue'
import { distance } from '@turf/distance'
import { point } from '@turf/helpers'
import type { ChartConfig } from '@/components/ui/chart'
import { useUnits } from '@/composables/useUnits'
import { VisArea, VisAxis, VisLine, VisXYContainer } from '@unovis/vue'
import { Card, CardContent } from '@/components/ui/card'
import {
  ChartContainer,
  ChartCrosshair,
  ChartTooltip,
  componentToString,
  ChartTooltipContent,
} from '@/components/ui/chart'

interface Props {
  geometry: Array<{ lat: number; lng: number; elevation?: number }>
  totalElevationGain?: number
  totalElevationLoss?: number
  maxElevation?: number
  minElevation?: number
}

const props = defineProps<Props>()
const { formatDistance, formatElevation } = useUnits()

interface ChartDataPoint {
  distance: number
  elevation: number
}

// Transform geometry data for chart
const chartData = computed<ChartDataPoint[]>(() => {
  if (!props.geometry || props.geometry.length === 0) return []

  let cumulativeDistance = 0
  const data: ChartDataPoint[] = []

  for (let i = 0; i < props.geometry.length; i++) {
    const point = props.geometry[i]

    // Calculate distance from previous point
    if (i > 0) {
      const prev = props.geometry[i - 1]
      const distance = calculateDistance(
        prev.lat,
        prev.lng,
        point.lat,
        point.lng,
      )
      cumulativeDistance += distance
    }

    if (point.elevation !== undefined) {
      data.push({
        distance: cumulativeDistance,
        elevation: point.elevation,
      })
    }
  }

  return data
})

// Calculate distance between two coordinates using Turf.js
function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const from = point([lng1, lat1])
  const to = point([lng2, lat2])
  return distance(from, to, { units: 'meters' })
}

const chartConfig = {
  elevation: {
    label: 'Elevation',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig

const svgDefs = computed(() => {
  const primaryColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--primary')
    .trim()

  return `
    <linearGradient id="fillElevation" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="hsl(${primaryColor})" stop-opacity="0.4" />
      <stop offset="100%" stop-color="hsl(${primaryColor})" stop-opacity="0" />
    </linearGradient>
  `
})

// Check if we have elevation data
const hasElevationData = computed(() => {
  return (
    chartData.value.length > 0 &&
    chartData.value.some(d => d.elevation !== undefined)
  )
})

// Calculate Y domain with padding
const yDomain = computed(() => {
  if (chartData.value.length === 0) return [0, 100]

  const elevations = chartData.value
    .map(d => d.elevation)
    .filter((e): e is number => e !== undefined)
  if (elevations.length === 0) return [0, 100]

  const min = Math.min(...elevations)
  const max = Math.max(...elevations)
  const padding = (max - min) * 0.1 || 10 // 10% padding or 10m minimum

  return [Math.max(0, min - padding), max + padding]
})

const totalDistance = computed(() => {
  if (chartData.value.length === 0) return 0
  return chartData.value[chartData.value.length - 1].distance
})
</script>

<template>
  <Card v-if="hasElevationData" class="overflow-hidden">
    <CardContent class="p-0">
      <!-- Elevation Stats Header -->
      <div class="flex items-center gap-4 px-4 py-3 bg-muted/30 text-sm">
        <div v-if="totalElevationGain" class="flex items-center gap-1.5">
          <span class="text-muted-foreground">↗</span>
          <span class="font-medium">{{
            formatElevation(totalElevationGain)
          }}</span>
        </div>
        <div v-if="totalElevationLoss" class="flex items-center gap-1.5">
          <span class="text-muted-foreground">↘</span>
          <span class="font-medium">{{
            formatElevation(totalElevationLoss)
          }}</span>
        </div>
      </div>

      <!-- Elevation Chart -->
      <div class="relative -mx-4 px-4">
        <!-- Floating Y-axis label -->
        <div class="absolute left-6 top-3 z-10 pointer-events-none">
          <div
            v-if="maxElevation !== undefined"
            class="px-2 py-0.5 bg-background/90 backdrop-blur-sm rounded-full text-[10px] text-foreground font-medium shadow-sm border"
          >
            {{ formatElevation(maxElevation) }}
          </div>
        </div>

        <!-- Floating X-axis labels -->
        <div
          class="absolute bottom-1 left-6 right-6 flex justify-between pointer-events-none z-10"
        >
          <div
            class="px-2 py-0.5 bg-background/90 backdrop-blur-sm rounded-full text-[10px] text-foreground font-medium shadow-sm border"
          >
            0 m
          </div>
          <div
            v-if="totalDistance > 0"
            class="px-2 py-0.5 bg-background/90 backdrop-blur-sm rounded-full text-[10px] text-foreground font-medium shadow-sm border"
          >
            {{ formatDistance(totalDistance) }}
          </div>
        </div>

        <ChartContainer :config="chartConfig" class="h-[100px] w-full">
          <VisXYContainer
            :data="chartData"
            :svg-defs="svgDefs"
            :margin="{ left: -40, right: -40, top: 0, bottom: 0 }"
            :y-domain="yDomain"
          >
            <VisArea
              :x="(d: ChartDataPoint) => d.distance"
              :y="(d: ChartDataPoint) => d.elevation"
              color="url(#fillElevation)"
            />
            <VisLine
              :x="(d: ChartDataPoint) => d.distance"
              :y="(d: ChartDataPoint) => d.elevation"
              :color="chartConfig.elevation.color"
              :line-width="2"
            />
            <ChartTooltip />
            <ChartCrosshair
              :template="
                componentToString(chartConfig, ChartTooltipContent, {
                  labelFormatter: (d: number | Date) => {
                    const distance = typeof d === 'number' ? d : 0
                    return formatDistance(distance)
                  },
                  hideLabel: false,
                })
              "
              :color="chartConfig.elevation.color"
            />
          </VisXYContainer>
        </ChartContainer>
      </div>
    </CardContent>
  </Card>
</template>
