<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDirectionsStore } from '@/stores/directions.store'
import { useMapService } from '@/services/map.service'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Caption, P } from '@/components/ui/typography'
import {
  AccessibilityIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  ClockIcon,
  FootprintsIcon,
  CarFrontIcon,
  BikeIcon,
  TrainIcon,
  TruckIcon,
} from 'lucide-vue-next'
import { AppRoute } from '@/router'
import type { RouteInstruction } from '@/types/directions.types'
import type { RouteProfileType } from '@/lib/route-profile-colors'
import ElevationChart from '@/components/directions/ElevationChart.vue'
import { useUnits } from '@/composables/useUnits'

const route = useRoute()
const router = useRouter()
const directionsStore = useDirectionsStore()
const mapService = useMapService()
const { formatDistance } = useUnits()

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
  wheelchair: AccessibilityIcon,
} as const

// Mode colors mapping
const modeColors = {
  walking: 'bg-blue-500',
  driving: 'bg-purple-500',
  cycling: 'bg-green-500',
  biking: 'bg-green-500', // Alias for cycling
  transit: 'bg-gray-500',
  truck: 'bg-orange-500',
  wheelchair: 'bg-teal-500',
} as const

// Watch for trip changes and update map visibility (immediate: true covers mount; do not also call in onMounted or we double-call setTrips and the route disappears)
watch(
  trip,
  newTrip => {
    if (newTrip) {
      mapService.setVisibleTrips([newTrip.id])
    }
  },
  { immediate: true },
)

// Restore all trips when leaving the component
function goBack() {
  // Reset map route coloring to default (travel-mode based)
  mapService.setRouteProfile(null)
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

const formatDistanceDisplay = (meters: number | undefined): string => {
  if (!meters) return formatDistance(0)
  return formatDistance(meters)
}

const formatTime = (date: Date): string => {
  return new Date(date).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Sync route profile coloring with the map — scoped to the segment that changed,
// so switching the Road type / Surface / Incline / Speed / Stress / Bike network
// tab on one segment doesn't stomp the other segments' coloring.
function onRouteProfileChange(
  segmentIndex: number,
  profile: RouteProfileType | null,
) {
  if (!trip.value) return
  mapService.setSegmentRouteProfile(trip.value.id, segmentIndex, profile)
}

const formatCurrency = (cost: { currency: string; amount: number }): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: cost.currency,
  }).format(cost.amount)
}

// Collapsible instructions: show this many steps always; the rest collapses
const PREVIEW_COUNT = 3

// ── Route waypoints (origin / via / destination) ────────────────────
// Derives a display list from the trip request's waypoints. Origin gets the
// trip's startTime and destination the trip's endTime; via stops have no
// known time (backend segments don't expose per-waypoint arrival times).
interface RouteWaypointDisplay {
  id: string
  role: 'origin' | 'via' | 'destination'
  displayName: string
  time: Date | null
}

const routeWaypoints = computed<RouteWaypointDisplay[]>(() => {
  const waypoints = directionsStore.trips?.request?.waypoints
  const t = trip.value
  if (!waypoints || waypoints.length === 0 || !t) return []

  let viaCounter = 0
  return waypoints.map((wp, i) => {
    const isOrigin = i === 0
    const isDestination = i === waypoints.length - 1
    const role: 'origin' | 'via' | 'destination' = isOrigin
      ? 'origin'
      : isDestination
        ? 'destination'
        : 'via'

    const fallbackName = isOrigin
      ? 'Origin'
      : isDestination
        ? 'Destination'
        : `Stop ${++viaCounter}`

    return {
      id: wp.id || `wp-${i}`,
      role,
      displayName: wp.name?.trim() || fallbackName,
      time: isOrigin ? t.startTime : isDestination ? t.endTime : null,
    }
  })
})

// Only skip the timeline for the degenerate 2-waypoint case where BOTH
// waypoints have no user-provided name (nothing to say beyond what the
// main title already shows).
const showItinerary = computed(() => {
  const wps = routeWaypoints.value
  if (wps.length === 0) return false
  if (wps.length > 2) return true
  return wps.some(
    wp => wp.displayName !== 'Origin' && wp.displayName !== 'Destination',
  )
})
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
        <Button
          variant="ghost"
          size="icon"
          class="shrink-0 -ml-2 mt-0.5"
          @click="goBack"
        >
          <ArrowLeftIcon class="size-5" />
        </Button>

        <div class="flex-1 min-w-0">
          <div class="flex items-baseline gap-2 leading-tight">
            <span class="text-3xl font-bold tracking-tight text-foreground">
              {{ formatDuration(trip.summary.totalDuration) }}
            </span>
            <span class="text-sm text-muted-foreground">
              {{ formatDistanceDisplay(trip.summary.totalDistance) }}
            </span>
          </div>

          <div
            v-if="trip.cost?.total || trip.co2Emissions"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
          >
            <span
              v-if="trip.cost?.total"
              class="inline-flex items-center gap-1"
            >
              💰 {{ formatCurrency(trip.cost.total) }}
            </span>
            <span
              v-if="trip.co2Emissions"
              class="inline-flex items-center gap-1"
            >
              🌱 {{ trip.co2Emissions.toFixed(1) }}kg CO₂
            </span>
          </div>
        </div>
      </div>

      <!-- Itinerary timeline: origin → (stops) → destination with timestamps -->
      <Card v-if="showItinerary" class="p-4">
        <div class="flex flex-col">
          <div
            v-for="(wp, i) in routeWaypoints"
            :key="wp.id"
            class="flex items-stretch gap-3"
          >
            <!-- Dot + connector column -->
            <div class="flex flex-col items-center shrink-0 w-3">
              <div
                class="shrink-0 rounded-full mt-1.5"
                :class="
                  wp.role === 'via'
                    ? 'size-2 border-2 border-muted-foreground bg-background'
                    : 'size-3 bg-primary'
                "
              />
              <div
                v-if="i < routeWaypoints.length - 1"
                class="flex-1 w-px bg-border my-1 min-h-3"
              />
            </div>
            <!-- Content -->
            <div
              class="flex-1 min-w-0 flex items-baseline gap-2"
              :class="{ 'pb-4': i < routeWaypoints.length - 1 }"
            >
              <span
                v-if="wp.time"
                class="shrink-0 text-sm font-medium text-foreground tabular-nums"
              >
                {{ formatTime(wp.time) }}
              </span>
              <span
                v-else
                class="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Stop
              </span>
              <span class="truncate text-sm text-foreground">
                {{ wp.displayName }}
              </span>
            </div>
          </div>
        </div>
      </Card>

      <!-- Segments -->
      <div class="space-y-3">
        <Card
          v-for="(segment, index) in trip.segments"
          :key="segment.id"
          class="p-4 space-y-4"
        >
          <!-- Segment Header -->
          <div class="flex items-start gap-2.5">
            <div
              :class="[
                'flex items-center justify-center size-7 rounded-full text-white shrink-0',
                modeColors[segment.mode] || 'bg-gray-500',
              ]"
            >
              <component
                :is="modeIcons[segment.mode] || FootprintsIcon"
                class="size-3.5"
              />
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span class="text-sm font-semibold capitalize text-foreground">
                  {{ segment.mode }}
                </span>
                <span class="text-sm text-muted-foreground">
                  {{ formatDuration(segment.duration) }} ·
                  {{ formatDistanceDisplay(segment.distance) }}
                </span>
              </div>
              <div
                v-if="segment.startTime && segment.endTime"
                class="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums"
              >
                <ClockIcon class="size-3" />
                {{ formatTime(segment.startTime) }} –
                {{ formatTime(segment.endTime) }}
              </div>
            </div>
          </div>

          <!-- Elevation chart + profile dropdown (walking / cycling / wheelchair with edge data) -->
          <ElevationChart
            v-if="
              segment.geometry &&
              (segment.totalElevationGain ||
                segment.totalElevationLoss ||
                segment.edgeSegments?.length) &&
              (segment.mode === 'walking' ||
                segment.mode === 'cycling' ||
                segment.mode === 'wheelchair')
            "
            :segment-index="index"
            :geometry="segment.geometry"
            :max-elevation="segment.maxElevation"
            :min-elevation="segment.minElevation"
            :edge-segments="segment.edgeSegments"
            :mode="segment.mode"
            :total-elevation-gain="segment.totalElevationGain"
            :total-elevation-loss="segment.totalElevationLoss"
            @update:route-profile="onRouteProfileChange"
          />

          <!-- Instructions: preview of first N + collapsible rest + "Show more" -->
          <Collapsible v-if="segment.instructions?.length" v-slot="{ open }">
            <!-- Preview (always visible) with fade when collapsed & more remain -->
            <div class="relative">
              <div class="space-y-0.5">
                <div
                  v-for="(
                    instruction, instrIndex
                  ) in segment.instructions.slice(0, PREVIEW_COUNT)"
                  :key="instrIndex"
                  class="flex items-start gap-3 rounded-lg p-2 -mx-2 transition-colors cursor-pointer"
                  :class="{
                    'bg-muted':
                      hoveredInstructionKey ===
                      getInstructionKey(index, instrIndex),
                    'hover:bg-muted/50':
                      hoveredInstructionKey !==
                      getInstructionKey(index, instrIndex),
                  }"
                  @mouseenter="
                    onInstructionHover(index, instrIndex, instruction)
                  "
                  @mouseleave="onInstructionLeave"
                >
                  <div
                    class="shrink-0 size-6 rounded-full flex items-center justify-center text-xs font-medium text-muted-foreground"
                  >
                    {{ instrIndex + 1 }}
                  </div>
                  <div class="flex-1 min-w-0">
                    <P class="text-sm text-foreground leading-snug">
                      {{
                        typeof instruction === 'string'
                          ? instruction
                          : instruction.text
                      }}
                    </P>
                    <div
                      v-if="
                        typeof instruction === 'object' &&
                        (instruction.distance || instruction.streetName)
                      "
                      class="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground"
                    >
                      <span v-if="instruction.streetName" class="font-medium">
                        {{ instruction.streetName }}
                      </span>
                      <span v-if="instruction.distance">
                        {{ formatDistanceDisplay(instruction.distance) }}
                      </span>
                      <span v-if="instruction.duration">
                        {{ formatDuration(instruction.duration) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <!-- Fade gradient mask over the bottom of the preview when collapsed -->
              <div
                v-if="!open && segment.instructions.length > PREVIEW_COUNT"
                class="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-card to-transparent"
              />
            </div>

            <!-- Remaining steps (collapsible) -->
            <CollapsibleContent
              v-if="segment.instructions.length > PREVIEW_COUNT"
            >
              <div class="space-y-0.5 pt-0.5">
                <div
                  v-for="(instruction, i) in segment.instructions.slice(
                    PREVIEW_COUNT,
                  )"
                  :key="i + PREVIEW_COUNT"
                  class="flex items-start gap-3 rounded-lg p-2 -mx-2 transition-colors cursor-pointer"
                  :class="{
                    'bg-muted':
                      hoveredInstructionKey ===
                      getInstructionKey(index, i + PREVIEW_COUNT),
                    'hover:bg-muted/50':
                      hoveredInstructionKey !==
                      getInstructionKey(index, i + PREVIEW_COUNT),
                  }"
                  @mouseenter="
                    onInstructionHover(index, i + PREVIEW_COUNT, instruction)
                  "
                  @mouseleave="onInstructionLeave"
                >
                  <div
                    class="shrink-0 size-6 rounded-full flex items-center justify-center text-xs font-medium text-muted-foreground"
                  >
                    {{ i + PREVIEW_COUNT + 1 }}
                  </div>
                  <div class="flex-1 min-w-0">
                    <P class="text-sm text-foreground leading-snug">
                      {{
                        typeof instruction === 'string'
                          ? instruction
                          : instruction.text
                      }}
                    </P>
                    <div
                      v-if="
                        typeof instruction === 'object' &&
                        (instruction.distance || instruction.streetName)
                      "
                      class="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground"
                    >
                      <span v-if="instruction.streetName" class="font-medium">
                        {{ instruction.streetName }}
                      </span>
                      <span v-if="instruction.distance">
                        {{ formatDistanceDisplay(instruction.distance) }}
                      </span>
                      <span v-if="instruction.duration">
                        {{ formatDuration(instruction.duration) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </CollapsibleContent>

            <!-- Show more / less trigger -->
            <CollapsibleTrigger
              v-if="segment.instructions.length > PREVIEW_COUNT"
              as-child
            >
              <Button
                variant="ghost"
                size="sm"
                class="w-full mt-1 text-primary hover:text-primary h-8"
              >
                {{
                  open
                    ? 'Show less'
                    : `Show ${segment.instructions.length - PREVIEW_COUNT} more`
                }}
                <ChevronDownIcon
                  class="size-4 ml-1 transition-transform"
                  :class="{ 'rotate-180': open }"
                />
              </Button>
            </CollapsibleTrigger>
          </Collapsible>

          <!-- No instructions message -->
          <div v-else class="text-sm text-muted-foreground italic">
            No detailed instructions available for this segment.
          </div>
        </Card>
      </div>
    </div>

    <!-- No Trip Found -->
    <div v-else class="p-4">
      <Caption>Trip not found</Caption>
    </div>
  </div>
</template>
