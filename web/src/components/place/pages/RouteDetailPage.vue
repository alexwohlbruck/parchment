<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRouteDetailStore, type DepartureContext, type VehicleOnRoute } from '@/stores/route-detail.store'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import SheetPageHeader from '@/components/place/SheetPageHeader.vue'
import RealtimeIndicator from '@/components/transit/RealtimeIndicator.vue'
import { Separator } from '@/components/ui/separator'
import { useTransitClock } from '@/composables/useTransitClock'
import {
  formatDepartureTime,
  getMinutesUntil,
} from '@/lib/transit'
import {
  TrainFrontIcon,
  BusIcon,
  ShipIcon,
  TramFrontIcon,
  MapPinIcon,
  ChevronDownIcon,
} from 'lucide-vue-next'
import type { TransitDeparture } from '@/types/place.types'

const props = defineProps<{
  feedId: string
  routeId: string
  originStopName?: string
  headsign?: string
  routeDepartures?: TransitDeparture[]
}>()

const store = useRouteDetailStore()
const currentTime = useTransitClock()

const route = computed(() => store.activeRoute)
const isLoading = computed(() => store.isLoading)
const vehicles = computed(() => store.vehicleList)
const vehiclesOnRoute = computed(() => store.vehiclesOnRoute)
const selectedId = computed(() => store.selectedVehicleId)
const directions = computed(() => store.directions)
const activeDirection = computed(() => store.activeDirection)
const headway = computed(() => store.headwayMinutes)
const upcoming = computed(() => store.upcomingDepartures)

const displayName = computed(() => {
  if (!route.value) return ''
  return route.value.routeShortName || route.value.routeLongName || route.value.routeId
})

const fullName = computed(() =>
  route.value?.routeLongName || route.value?.routeShortName || '',
)

const bgColor = computed(() =>
  route.value?.routeColor ? `#${route.value.routeColor}` : 'hsl(var(--foreground))',
)
const textColor = computed(() =>
  route.value?.routeTextColor ? `#${route.value.routeTextColor}` : 'hsl(var(--background))',
)

const routeTypeIcon = computed(() => {
  switch (route.value?.routeType) {
    case 0: return TramFrontIcon
    case 1: return TrainFrontIcon
    case 2: return TrainFrontIcon
    case 3: return BusIcon
    case 4: return ShipIcon
    default: return BusIcon
  }
})

const routeTypeLabel = computed(() => {
  switch (route.value?.routeType) {
    case 0: return 'tram'
    case 1: return 'train'
    case 2: return 'train'
    case 3: return 'bus'
    case 4: return 'ferry'
    default: return 'vehicle'
  }
})

const nextLabel = computed(() => {
  const dep = upcoming.value[0]
  if (!dep) return null
  const m = getMinutesUntil(dep, currentTime.value)
  if (m === null) return null
  if (m <= 0) return 'Now'
  return `${m} min`
})

const nextIsNow = computed(() => {
  const dep = upcoming.value[0]
  if (!dep) return false
  const m = getMinutesUntil(dep, currentTime.value)
  return m !== null && m <= 0
})

function vehiclesBetween(stopIndex: number): VehicleOnRoute[] {
  return vehiclesOnRoute.value.filter(v => v.nearestStopIndex === stopIndex)
}

function isSelected(vehicleId: string): boolean {
  return selectedId.value === vehicleId
}

function onVehicleClick(vehicleId: string) {
  store.selectVehicle(selectedId.value === vehicleId ? null : vehicleId)
}

function timeAgo(timestamp: string): string {
  const sec = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  return `${Math.floor(sec / 60)}m ago`
}

/** Short label for a vehicle (nearest stop or route name). */
function vehicleLabel(vr: VehicleOnRoute): string {
  const stops = route.value?.stops
  if (!stops) return displayName.value
  const stop = stops[vr.nearestStopIndex]
  return stop ? `Near ${stop.stopName}` : displayName.value
}

onMounted(() => {
  const context: DepartureContext | undefined = props.originStopName
    ? {
        originStopName: props.originStopName,
        headsign: props.headsign || '',
        departures: props.routeDepartures || [],
      }
    : undefined
  store.openRoute(props.feedId, props.routeId, context)
})

onUnmounted(() => {
  store.closeRoute()
})
</script>

<template>
  <PanelLayout>
    <SheetPageHeader :title="displayName || 'Route'" />

    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <div class="animate-spin h-6 w-6 border-2 border-foreground/20 border-t-foreground rounded-full" />
    </div>

    <div v-else-if="route" class="flex flex-col pb-6">
      <!-- ── Route header ──────────────────────────────── -->
      <div class="flex items-start gap-3 px-4 mb-3">
        <div
          class="flex items-center justify-center min-w-10 h-10 px-2.5 rounded-lg font-bold text-lg shrink-0"
          :style="{ background: bgColor, color: textColor }"
        >
          {{ route.routeShortName || '' }}
        </div>
        <div class="flex flex-col min-w-0 pt-0.5">
          <span class="font-semibold text-base leading-tight">
            {{ fullName }}
          </span>
          <span v-if="activeDirection" class="text-sm text-muted-foreground">
            {{ activeDirection }}
          </span>
        </div>
      </div>

      <!-- ── Direction selector ────────────────────────── -->
      <div v-if="directions.length > 1" class="flex gap-1.5 px-4 mb-3">
        <button
          v-for="dir in directions"
          :key="dir"
          class="px-3 py-1 rounded-full text-xs font-medium transition-colors"
          :class="[
            dir === activeDirection
              ? 'text-white'
              : 'bg-muted text-muted-foreground hover:bg-muted/80',
          ]"
          :style="dir === activeDirection ? { background: bgColor, color: textColor } : {}"
          @click="store.setDirection(dir)"
        >
          {{ dir }}
        </button>
      </div>

      <!-- ── Departures ────────────────────────────────── -->
      <div v-if="upcoming.length > 0" class="px-4 mb-3">
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm font-semibold">Departures</span>
          <span v-if="headway" class="text-xs text-muted-foreground">
            Every {{ headway }} min
          </span>
        </div>
        <div class="flex items-center gap-1.5 flex-wrap">
          <span
            :class="['text-sm font-medium', nextIsNow ? 'text-green-600 dark:text-green-400' : '']"
          >
            {{ nextLabel }}
          </span>
          <template v-for="(dep, i) in upcoming.slice(1, 4)" :key="i">
            <span class="text-muted-foreground text-xs">,</span>
            <span class="text-sm tabular-nums">{{ formatDepartureTime(dep) }}</span>
            <RealtimeIndicator v-if="dep.realTime" :realTime="true" class="shrink-0" />
          </template>
        </div>
      </div>

      <!-- ── Vehicle selector ──────────────────────────── -->
      <div v-if="vehicles.length > 0" class="px-4 mb-3">
        <div class="text-sm font-semibold mb-1.5">
          {{ vehicles.length }} {{ routeTypeLabel }}{{ vehicles.length !== 1 ? 's' : '' }} active
        </div>
        <div class="flex gap-1.5 flex-wrap">
          <button
            v-for="vr in vehiclesOnRoute"
            :key="vr.vehicleId"
            class="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-all border"
            :class="[
              isSelected(vr.vehicleId)
                ? 'border-foreground/30 bg-accent shadow-sm'
                : 'border-transparent bg-muted/50 hover:bg-muted',
            ]"
            @click="onVehicleClick(vr.vehicleId)"
          >
            <div
              class="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
              :style="{ background: bgColor }"
            >
              <component :is="routeTypeIcon" class="h-3 w-3" :style="{ color: textColor }" />
            </div>
            <span class="truncate max-w-[140px]">{{ vehicleLabel(vr) }}</span>
          </button>
        </div>
      </div>

      <Separator class="mx-4 mb-3" />

      <!-- ── Stop timeline ─────────────────────────────── -->
      <div class="px-4">
        <div class="text-sm font-semibold mb-2">Stops</div>

        <div class="relative pl-7">
          <!-- Route color line -->
          <div
            class="absolute left-[11px] top-2 bottom-2 w-[3px] rounded-full"
            :style="{ background: bgColor }"
          />

          <template v-for="(stop, i) in route.stops" :key="stop.stopId">
            <!-- Vehicles between previous stop and this stop -->
            <div
              v-for="vr in vehiclesBetween(i)"
              :key="vr.vehicleId"
              class="relative flex items-center gap-2 py-0.5 cursor-pointer"
              :class="{
                'opacity-40': selectedId && !isSelected(vr.vehicleId),
              }"
              @click="onVehicleClick(vr.vehicleId)"
            >
              <div
                class="absolute -left-[22px] w-[23px] h-[23px] rounded-full flex items-center justify-center z-20 transition-all"
                :style="{ background: bgColor }"
                :class="{
                  'scale-110 ring-2 ring-offset-1 ring-offset-background': isSelected(vr.vehicleId),
                }"
              >
                <component :is="routeTypeIcon" class="h-3 w-3" :style="{ color: textColor }" />
              </div>
              <span class="text-xs text-muted-foreground">
                {{ vr.vehicle.routeShortName || displayName }}
                <span class="opacity-60">· {{ timeAgo(vr.vehicle.timestamp) }}</span>
              </span>
            </div>

            <!-- Stop dot + name -->
            <div class="relative flex items-center min-h-[28px]">
              <div
                class="absolute rounded-full border-2 bg-background z-10"
                :style="{ borderColor: bgColor }"
                :class="[
                  i === 0 || i === route.stops.length - 1
                    ? 'w-[11px] h-[11px] -left-[16px] top-[8px]'
                    : 'w-[9px] h-[9px] -left-[15px] top-[9px]',
                ]"
              />
              <span
                class="text-sm leading-snug py-1"
                :class="{
                  'font-semibold': i === 0 || i === route.stops.length - 1,
                }"
              >
                {{ stop.stopName }}
              </span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div v-else class="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <MapPinIcon class="h-8 w-8 mb-2 opacity-50" />
      <span class="text-sm">Route not found</span>
    </div>
  </PanelLayout>
</template>
