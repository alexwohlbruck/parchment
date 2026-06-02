<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRouteDetailStore, type DepartureContext, type VehicleOnRoute } from '@/stores/route-detail.store'
import { useRouter } from 'vue-router'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import RealtimeIndicator from '@/components/transit/RealtimeIndicator.vue'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTransitClock } from '@/composables/useTransitClock'
import { formatDepartureTime, getMinutesUntil } from '@/lib/transit'
import {
  TrainFrontIcon,
  BusIcon,
  ShipIcon,
  TramFrontIcon,
  MapPinIcon,
  ArrowLeftIcon,
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
const router = useRouter()
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
const displayStops = computed(() => store.displayStops)

const displayName = computed(() =>
  route.value?.routeShortName || route.value?.routeLongName || route.value?.routeId || '',
)
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
  const t = route.value?.routeType
  return t === 0 ? 'tram' : t === 1 ? 'train' : t === 2 ? 'train' : t === 3 ? 'bus' : t === 4 ? 'ferry' : 'vehicle'
})

const nextLabel = computed(() => {
  const dep = upcoming.value[0]
  if (!dep) return null
  const m = getMinutesUntil(dep, currentTime.value)
  if (m === null) return null
  return m <= 0 ? 'Now' : `${m} min`
})

const nextIsNow = computed(() => {
  const dep = upcoming.value[0]
  if (!dep) return false
  const m = getMinutesUntil(dep, currentTime.value)
  return m !== null && m <= 0
})

// ── Selected vehicle → grey-out stops behind it ─────────────

const selectedVehicleOnRoute = computed(() =>
  vehiclesOnRoute.value.find(vr => vr.vehicleId === selectedId.value) ?? null,
)

/** Stop index (in displayStops) that the selected vehicle has passed. */
function isStopPassedBySelected(displayIndex: number): boolean {
  const sv = selectedVehicleOnRoute.value
  if (!sv) return false
  // The vehicle is near stop sv.nearestStopIndex in the original stop list.
  // In display order, routeFraction tells us where it is 0→1.
  // Stops before that fraction are "passed".
  const stopFraction = displayIndex / Math.max(1, displayStops.value.length - 1)
  return stopFraction < sv.routeFraction - 0.01
}

// ── Vehicle helpers ──────────────────────────────────────────

function vehicleLabel(vr: VehicleOnRoute): string {
  const stops = displayStops.value
  if (!stops.length) return displayName.value
  const stop = stops[vr.nearestStopIndex]
  return stop ? `Near ${stop.stopName}` : displayName.value
}

function timeAgo(timestamp: string): string {
  const sec = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  return `${Math.floor(sec / 60)}m ago`
}

function onSelectVehicle(value: string) {
  store.selectVehicle(value === selectedId.value ? null : value)
}

/** Height of each stop row in px (must match the CSS). */
const STOP_ROW_HEIGHT = 32

/** Top offset in px for a vehicle at the given routeFraction. */
function vehicleTopPx(vr: VehicleOnRoute): number {
  const totalHeight = (displayStops.value.length - 1) * STOP_ROW_HEIGHT
  return vr.routeFraction * totalHeight
}

// ── Lifecycle ────────────────────────────────────────────────

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
    <!-- Header -->
    <div class="flex items-center gap-2 px-3 py-2">
      <button class="p-1 -ml-1 rounded-md hover:bg-muted" @click="router.back()">
        <ArrowLeftIcon class="h-4 w-4" />
      </button>
      <span class="text-sm font-medium truncate">{{ displayName }}</span>
    </div>

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
          <span class="font-semibold text-base leading-tight">{{ fullName }}</span>
          <span v-if="activeDirection" class="text-sm text-muted-foreground">{{ activeDirection }}</span>
        </div>
      </div>

      <!-- ── Direction pills ───────────────────────────── -->
      <div v-if="directions.length > 1" class="flex gap-1.5 px-4 mb-3">
        <button
          v-for="dir in directions"
          :key="dir"
          class="px-3 py-1 rounded-full text-xs font-medium transition-colors"
          :class="dir === activeDirection ? '' : 'bg-muted text-muted-foreground hover:bg-muted/80'"
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
          <span v-if="headway" class="text-xs text-muted-foreground">Every {{ headway }} min</span>
        </div>
        <div class="flex items-center gap-1.5 flex-wrap">
          <span :class="['text-sm font-medium', nextIsNow ? 'text-green-600 dark:text-green-400' : '']">
            {{ nextLabel }}
          </span>
          <template v-for="(dep, i) in upcoming.slice(1, 4)" :key="i">
            <span class="text-muted-foreground text-xs">,</span>
            <span class="text-sm tabular-nums">{{ formatDepartureTime(dep) }}</span>
            <RealtimeIndicator v-if="dep.realTime" :realTime="true" class="shrink-0" />
          </template>
        </div>
      </div>

      <!-- ── Vehicle dropdown ──────────────────────────── -->
      <div v-if="vehicles.length > 0" class="px-4 mb-3">
        <div class="text-sm font-semibold mb-1.5">
          {{ vehicles.length }} {{ routeTypeLabel }}{{ vehicles.length !== 1 ? 's' : '' }} active
        </div>
        <Select
          :modelValue="selectedId || undefined"
          @update:modelValue="(v) => onSelectVehicle(v as string)"
        >
          <SelectTrigger class="w-full h-9">
            <div class="flex items-center gap-2">
              <div
                class="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                :style="{ background: bgColor }"
              >
                <component :is="routeTypeIcon" class="h-3 w-3" :style="{ color: textColor }" />
              </div>
              <SelectValue :placeholder="`Select a ${routeTypeLabel}`" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="vr in vehiclesOnRoute"
              :key="vr.vehicleId"
              :value="vr.vehicleId"
            >
              <div class="flex items-center justify-between gap-3 w-full">
                <span class="truncate">{{ vehicleLabel(vr) }}</span>
                <span class="text-xs text-muted-foreground shrink-0">{{ timeAgo(vr.vehicle.timestamp) }}</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator class="mx-4 mb-3" />

      <!-- ── Stop timeline ─────────────────────────────── -->
      <div class="px-4">
        <div class="text-sm font-semibold mb-2">Stops</div>

        <!--
          Timeline layout: everything centers on an axis 14px from
          the container's left edge. pl-[34px] gives room for the
          line + dots + vehicle icons to the left of stop names.
        -->
        <div class="relative pl-[34px]">
          <!-- Route color line: 3px wide, centered on axis (14 - 1.5 = 12.5) -->
          <div
            class="absolute left-[12px] top-[16px] w-[3px] rounded-full z-0"
            :style="{
              background: bgColor,
              height: `${(displayStops.length - 1) * STOP_ROW_HEIGHT}px`,
            }"
          />

          <!-- Vehicle indicators (absolute, centered on axis) -->
          <div
            v-for="vr in vehiclesOnRoute"
            :key="'v-' + vr.vehicleId"
            class="absolute z-20 cursor-pointer"
            :style="{
              left: '1px',
              top: `${vehicleTopPx(vr) + 16 - 12}px`,
            }"
            @click.stop="onSelectVehicle(vr.vehicleId)"
          >
            <!-- 25px icon centered on 14px axis: 14 - 12.5 = 1.5 ≈ 1px left -->
            <div
              class="w-[25px] h-[25px] rounded-full flex items-center justify-center transition-all"
              :style="{ background: bgColor }"
              :class="{
                'ring-2 ring-offset-2 ring-offset-background scale-110': vr.vehicleId === selectedId,
              }"
            >
              <component :is="routeTypeIcon" class="h-3 w-3" :style="{ color: textColor }" />
            </div>
          </div>

          <!-- Stop rows -->
          <div
            v-for="(stop, i) in displayStops"
            :key="stop.stopId"
            class="relative flex items-center transition-opacity duration-200"
            :style="{ height: `${STOP_ROW_HEIGHT}px` }"
            :class="{ 'opacity-40': isStopPassedBySelected(i) }"
          >
            <!-- Stop dot: centered on axis (14px from container left) -->
            <!-- Normal 9px dot: 14 - 4.5 = 9.5 from container = 9.5 - 34 = -24.5 from content -->
            <!-- Terminus 11px dot: 14 - 5.5 = 8.5 from container = 8.5 - 34 = -25.5 from content -->
            <div
              class="absolute rounded-full border-2 bg-background z-10"
              :style="{ borderColor: bgColor }"
              :class="[
                i === 0 || i === displayStops.length - 1
                  ? 'w-[11px] h-[11px] -left-[25px]'
                  : 'w-[9px] h-[9px] -left-[24px]',
              ]"
              style="top: 50%; transform: translateY(-50%)"
            />

            <span
              class="text-sm"
              :class="{ 'font-semibold': i === 0 || i === displayStops.length - 1 }"
            >
              {{ stop.stopName }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <MapPinIcon class="h-8 w-8 mb-2 opacity-50" />
      <span class="text-sm">Route not found</span>
    </div>
  </PanelLayout>
</template>
