<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDirectionsStore } from '@/stores/directions.store'
import { useMapService } from '@/services/map.service'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { H5, H6, Caption, P } from '@/components/ui/typography'
import {
  ArrowLeftIcon,
  ClockIcon,
  FootprintsIcon,
  CarFrontIcon,
  BikeIcon,
  TrainIcon,
  TruckIcon,
} from 'lucide-vue-next'
import { AppRoute } from '@/router'
import type { RouteInstruction } from '@/types/directions.types'
import ElevationChart from '@/components/directions/ElevationChart.vue'

const route = useRoute()
const router = useRouter()
const directionsStore = useDirectionsStore()
const mapService = useMapService()

// State for hover interactions
const hoveredInstructionKey = ref<string | null>(null)

const tripId = computed(() => route.params.id as string)
const isLoading = ref(false)
const error = ref<string | null>(null)

// Get the trip from the directions store
const trip = computed(() => {
  if (!directionsStore.trips?.trips) return null
  return directionsStore.trips.trips.find(t => t.id === tripId.value) || null
})

// If no trip is found after mounting, redirect back to directions
watch(
  trip,
  newTrip => {
    if (newTrip === null && !isLoading.value && directionsStore.trips) {
      router.push({ name: AppRoute.DIRECTIONS })
    }
  },
  { immediate: true },
)

// Mode icons mapping
const modeIcons = {
  walking: FootprintsIcon,
  driving: CarFrontIcon,
  cycling: BikeIcon,
  biking: BikeIcon, // Alias for cycling
  transit: TrainIcon,
  truck: TruckIcon,
} as const

// Mode colors mapping
const modeColors = {
  walking: 'bg-blue-500',
  driving: 'bg-purple-500',
  cycling: 'bg-green-500',
  biking: 'bg-green-500', // Alias for cycling
  transit: 'bg-gray-500',
  truck: 'bg-orange-500',
} as const

// Watch for trip changes and update map visibility
watch(
  trip,
  newTrip => {
    if (newTrip) {
      // Show only this trip on the map
      // Note: setVisibleTrips automatically updates instruction markers via selectedTripId
      mapService.setVisibleTrips([newTrip.id])
    }
  },
  { immediate: true },
)

// Show only the selected trip on the map when component mounts
onMounted(() => {
  if (trip.value) {
    // Note: setVisibleTrips automatically updates instruction markers via selectedTripId
    mapService.setVisibleTrips([trip.value.id])
  }
})

// Restore all trips when leaving the component
function goBack() {
  // Note: showAllTrips automatically clears instruction markers via selectedTripId
  mapService.showAllTrips()
  // Navigate back to directions view, preserving the trips data
  router.push({ name: AppRoute.DIRECTIONS })
}

// Handle hovering instructions
function onInstructionHover(
  segmentIndex: number,
  instrIndex: number,
  instruction: string | RouteInstruction,
) {
  const key = `${segmentIndex}-${instrIndex}`
  hoveredInstructionKey.value = key

  // Highlight the point on the map
  if (typeof instruction === 'object' && instruction.coordinate) {
    mapService.highlightInstructionPoint(segmentIndex, instrIndex)
  }
}

function onInstructionLeave() {
  hoveredInstructionKey.value = null
  mapService.clearHighlightedInstructionPoint()
}

// Generate unique key for instruction
function getInstructionKey(segmentIndex: number, instrIndex: number): string {
  return `${segmentIndex}-${instrIndex}`
}

// Utility functions for formatting
const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

const formatDistance = (meters: number | undefined): string => {
  if (!meters) return '0m'

  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)}km`
  }
  return `${Math.round(meters)}m`
}

const formatTime = (date: Date): string => {
  return new Date(date).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatCurrency = (cost: { currency: string; amount: number }): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: cost.currency,
  }).format(cost.amount)
}
</script>

<template>
  <div class="h-full w-full overflow-y-auto">
    <!-- Loading State -->
    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <Caption>Loading trip details...</Caption>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="p-4">
      <Caption class="text-destructive">{{ error }}</Caption>
    </div>

    <!-- Trip Content -->
    <div v-else-if="trip" class="p-4 space-y-4">
      <!-- Trip Overview with Back Button -->
      <div class="flex items-center gap-1">
        <Button variant="ghost" size="sm" @click="goBack">
          <ArrowLeftIcon class="size-4" />
        </Button>

        <div class="flex-1 min-w-0">
          <H5 class="text-muted-foreground mb-1">
            {{ formatDuration(trip.summary.totalDuration) }} •
            {{ formatDistance(trip.summary.totalDistance) }}
          </H5>

          <div class="flex items-center gap-4 text-sm text-muted-foreground">
            <span class="flex items-center gap-1">
              <ClockIcon class="size-3" />
              {{ formatTime(trip.startTime) }} - {{ formatTime(trip.endTime) }}
            </span>
            <span v-if="trip.cost?.total" class="flex items-center gap-1">
              💰 {{ formatCurrency(trip.cost.total) }}
            </span>
            <span v-if="trip.co2Emissions" class="flex items-center gap-1">
              🌱 {{ trip.co2Emissions.toFixed(1) }}kg CO₂
            </span>
          </div>
        </div>
      </div>

      <!-- Instructions -->
      <Card>
        <CardContent class="p-4">
          <div class="space-y-6">
            <div v-for="(segment, index) in trip.segments" :key="segment.id">
              <div class="flex flex-col">
                <!-- Segment Header -->
                <div class="flex items-center gap-3 mb-3">
                  <!-- Segment Icon -->
                  <div
                    :class="[
                      'flex items-center justify-center size-8 rounded-full text-white shrink-0',
                      modeColors[segment.mode] || 'bg-gray-500',
                    ]"
                  >
                    <component
                      :is="modeIcons[segment.mode] || FootprintsIcon"
                      class="size-4"
                    />
                  </div>

                  <!-- Segment Info -->
                  <div class="flex items-center gap-4">
                    <H6 class="capitalize">
                      {{ segment.mode }}
                    </H6>
                    <Caption class="text-muted-foreground">
                      {{ formatDuration(segment.duration) }} •
                      {{ formatDistance(segment.distance) }}
                    </Caption>
                  </div>
                </div>

                <!-- Elevation Chart (only for walking and cycling) -->
                <ElevationChart
                  v-if="
                    segment.geometry &&
                    (segment.totalElevationGain ||
                      segment.totalElevationLoss) &&
                    (segment.mode === 'walking' || segment.mode === 'cycling')
                  "
                  :geometry="segment.geometry"
                  :total-elevation-gain="segment.totalElevationGain"
                  :total-elevation-loss="segment.totalElevationLoss"
                  :max-elevation="segment.maxElevation"
                  :min-elevation="segment.minElevation"
                  class="mb-3"
                />

                <!-- Instructions List - Left aligned under the icon -->
                <div class="flex">
                  <div class="flex-1">
                    <!-- Instructions List -->
                    <div v-if="segment.instructions?.length">
                      <div
                        v-for="(
                          instruction, instrIndex
                        ) in segment.instructions"
                        :key="instrIndex"
                        class="flex items-center text-sm hover:bg-muted/50 rounded-lg p-2 pl-0 transition-colors cursor-pointer"
                        :class="{
                          'bg-muted':
                            hoveredInstructionKey ===
                            getInstructionKey(index, instrIndex),
                        }"
                        @mouseenter="
                          onInstructionHover(index, instrIndex, instruction)
                        "
                        @mouseleave="onInstructionLeave"
                      >
                        <div
                          class="shrink-0 w-6 h-6 mr-2 rounded-full flex items-center justify-center text-xs font-medium"
                        >
                          {{ instrIndex + 1 }}
                        </div>
                        <div class="flex-1">
                          <P class="text-sm text-foreground leading-relaxed">
                            {{
                              typeof instruction === 'string'
                                ? instruction
                                : instruction.text
                            }}
                          </P>
                          <!-- Additional instruction details for full RouteInstruction objects -->
                          <div
                            v-if="
                              typeof instruction === 'object' &&
                              (instruction.distance || instruction.streetName)
                            "
                            class="flex items-center gap-3 mt-1 text-xs text-muted-foreground"
                          >
                            <span
                              v-if="instruction.streetName"
                              class="font-medium"
                            >
                              {{ instruction.streetName }}
                            </span>
                            <span
                              v-if="instruction.distance"
                              class="flex items-center gap-1"
                            >
                              <span>{{
                                formatDistance(instruction.distance)
                              }}</span>
                            </span>
                            <span
                              v-if="instruction.duration"
                              class="flex items-center gap-1"
                            >
                              <span>{{
                                formatDuration(instruction.duration)
                              }}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- No instructions message -->
                    <div v-else class="text-sm text-muted-foreground italic">
                      No detailed instructions available for this segment.
                    </div>
                  </div>
                </div>
              </div>

              <!-- Separator between segments (except last one) -->
              <Separator v-if="index < trip.segments.length - 1" class="my-6" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- No Trip Found -->
    <div v-else class="p-4">
      <Caption>Trip not found</Caption>
    </div>
  </div>
</template>
