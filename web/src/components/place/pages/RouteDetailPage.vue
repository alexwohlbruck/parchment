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
import { useI18n } from 'vue-i18n'
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
const { t } = useI18n()
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

const vehicleTypeKey = computed(() => {
  const rt = route.value?.routeType
  if (rt === 0) return 'tram'
  if (rt === 1) return 'subway'
  if (rt === 2) return 'rail'
  if (rt === 3) return 'bus'
  if (rt === 4) return 'ferry'
  return 'vehicle'
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

      <!-- ── Direction selector ──────────────────────────── -->
      <div v-if="directions.length > 1" class="px-4 mb-3">
        <Select
          :modelValue="activeDirection ?? undefined"
          @update:modelValue="(v) => store.setDirection(String(v))"
        >
          <SelectTrigger class="w-full h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="dir in directions" :key="dir" :value="dir">
              {{ dir }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- ── Departures ────────────────────────────────── -->
      <div v-if="upcoming.length > 0" class="px-4 mb-3">
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm font-semibold">Departures</span>
          <span v-if="headway" class="text-xs text-muted-foreground">{{ t('place.transit.everyNMin', { n: headway }) }}</span>
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
          {{ t('place.transit.activeVehicles', { count: vehicles.length, type: t(`place.transit.vehicleType.${vehicleTypeKey}`, vehicles.length) }) }}
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
              <SelectValue :placeholder="t('place.transit.selectVehicle', { type: t(`place.transit.vehicleType.${vehicleTypeKey}`, 1) })" />
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
        <div class="text-sm font-semibold mb-2">{{ t('place.transit.stops') }}</div>

        <div class="relative" style="padding-left: 32px">
          <!-- Vertical route line: split into passed (grey) and active (colored) segments -->
          <div
            v-if="selectedVehicleOnRoute"
            class="absolute z-0 rounded-full"
            :style="{
              left: '12px',
              top: `${STOP_ROW_HEIGHT / 2}px`,
              width: '3px',
              height: `${vehicleTopPx(selectedVehicleOnRoute)}px`,
              background: 'hsl(var(--muted-foreground))',
            }"
          />
          <div
            class="absolute z-0 rounded-full"
            :style="{
              left: '12px',
              top: selectedVehicleOnRoute
                ? `${STOP_ROW_HEIGHT / 2 + vehicleTopPx(selectedVehicleOnRoute)}px`
                : `${STOP_ROW_HEIGHT / 2}px`,
              width: '3px',
              height: selectedVehicleOnRoute
                ? `${(displayStops.length - 1) * STOP_ROW_HEIGHT - vehicleTopPx(selectedVehicleOnRoute)}px`
                : `${(displayStops.length - 1) * STOP_ROW_HEIGHT}px`,
              background: bgColor,
            }"
          />

          <!-- Vehicle indicators (absolutely positioned, centered at 13.5px) -->
          <div
            v-for="vr in vehiclesOnRoute"
            :key="'v-' + vr.vehicleId"
            class="absolute z-20 cursor-pointer"
            :style="{
              left: '1px',
              top: `${vehicleTopPx(vr) + STOP_ROW_HEIGHT / 2 - 12}px`,
              width: '25px',
              height: '25px',
            }"
            @click.stop="onSelectVehicle(vr.vehicleId)"
          >
            <div
              class="w-full h-full rounded-full flex items-center justify-center transition-all"
              :style="{ background: bgColor }"
              :class="{ 'ring-2 ring-offset-2 ring-offset-background scale-110': vr.vehicleId === selectedId }"
            >
              <component :is="routeTypeIcon" class="h-3 w-3" :style="{ color: textColor }" />
            </div>
          </div>

          <!-- Stop rows -->
          <div
            v-for="(stop, i) in displayStops"
            :key="stop.stopId"
            class="flex items-center"
            :style="{ height: `${STOP_ROW_HEIGHT}px` }"
          >
            <!-- Stop dot (inline-positioned before the name) -->
            <div
              class="absolute rounded-full border-2 z-10"
              :style="{
                width: (i === 0 || i === displayStops.length - 1) ? '11px' : '9px',
                height: (i === 0 || i === displayStops.length - 1) ? '11px' : '9px',
                left: (i === 0 || i === displayStops.length - 1) ? '8px' : '9px',
                borderColor: isStopPassedBySelected(i) ? 'hsl(var(--muted-foreground))' : bgColor,
                background: isStopPassedBySelected(i) ? 'hsl(var(--muted))' : 'hsl(var(--background))',
              }"
            />

            <span
              class="text-sm"
              :class="{
                'font-semibold': i === 0 || i === displayStops.length - 1,
                'text-muted-foreground': isStopPassedBySelected(i),
              }"
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
