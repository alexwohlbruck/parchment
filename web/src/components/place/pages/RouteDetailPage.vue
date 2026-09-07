<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, onUpdated, ref, watch } from 'vue'
import {
  useRouteDetailStore,
  type DepartureContext,
  type VehicleOnRoute,
  type RouteDetailStop,
  type StopTransferRoute,
} from '@/stores/route-detail.store'
import RouteBullet from '@/components/transit/RouteBullet.vue'
import {
  bulletFor,
  ensureBulletsAt,
} from '@/services/layers/features/portolan/portolan-bullets'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import RealtimeIndicator from '@/components/transit/RealtimeIndicator.vue'
import ServiceAlerts from '@/components/transit/ServiceAlerts.vue'
import { Separator } from '@/components/ui/separator'
import { SheetHeader } from '@/components/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTransitClock } from '@/composables/useTransitClock'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { formatDepartureTime, getMinutesUntil } from '@/lib/transit'
import {
  TrainFrontIcon,
  BusIcon,
  ShipIcon,
  TramFrontIcon,
  MapPinIcon,
} from 'lucide-vue-next'
import type { TransitDeparture } from '@/types/place.types'
import { Spinner } from '@/components/ui/spinner'

const props = defineProps<{
  feedId: string
  routeId: string
  originStopName?: string
  headsign?: string
  routeDepartures?: TransitDeparture[]
}>()

const store = useRouteDetailStore()
const { t } = useI18n()
const router = useRouter()
const currentTime = useTransitClock()

const route = computed(() => store.activeRoute)
const isLoading = computed(() => store.isLoading)
const vehicles = computed(() => store.vehicleList)
const vehiclesOnRoute = computed(() => store.vehiclesOnRoute)
const selectedId = computed(() => store.selectedVehicleId)
const stopTimeMap = computed(() => store.stopTimeMap)
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

/** The page's own bullet, curated like every other bullet for this line —
 *  the header must show the same chip the map and the stop rows do. */
const headerBullet = computed(() => {
  const r = route.value
  const first = displayStops.value[0]
  if (!r || !first) return null
  return bulletFor(r.routeId, first.lat, first.lng, r.routeType, r.routeShortName || r.routeLongName)
})

/** A tapped bullet opens that line's own page. */
function openRouteDetail(r: StopTransferRoute) {
  if (r.routeId === props.routeId) return
  router.push({
    name: AppRoute.TRANSIT_ROUTE,
    params: { feedId: props.feedId, routeId: r.routeId },
  })
}

/** Everything the agency has published about this line. */
const alertQuery = computed(() => ({
  feedId: props.feedId,
  routeIds: [props.routeId],
  includeUpcoming: true,
}))

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

/** Look up the departure/arrival time for a stop from the selected vehicle's trip. */
function stopTime(stop: { stopId: string }): string | null {
  if (!selectedId.value) return null
  const time = stopTimeMap.value.get(stop.stopId)
  if (!time) return null
  const d = new Date(time)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function isStopInPast(stop: { stopId: string }): boolean {
  if (!selectedId.value) return false
  const time = stopTimeMap.value.get(stop.stopId)
  if (!time) return false
  return new Date(time).getTime() < Date.now()
}

/**
 * Portolan's curated bullet for a line at a stop, or null.
 *
 * The map is usually open beside this panel drawing the same lines, so the
 * glyphs have to agree — a notched square here and a plain circle there for
 * the same route reads as two different routes. Passing the stop's own point
 * picks the pyramid covering it, and the route type keeps a metro 4 from
 * matching a commuter-rail one.
 */
const stopBullet = (route: StopTransferRoute, stop: RouteDetailStop) =>
  bulletFor(route.routeId, stop.lat, stop.lng, route.routeType, route.routeShortName || route.routeLongName)

// Curated styles are fetched per feed and per session. Ask once the stops
// land, using the first one as the point — a route stays inside one city.
watch(
  () => displayStops.value[0],
  (first) => {
    if (first) void ensureBulletsAt(first.lat, first.lng)
  },
  { immediate: true },
)

/**
 * Distance from a row's top to the centre of its stop dot.
 *
 * The dot sits on the middle of the stop name's first line (2px row padding
 * + half a 20px line box), which is where the eye expects it — whatever
 * else that row carries below the name.
 */
const STOP_DOT_CENTER_Y = 12

/**
 * Each row's dot centre, measured, in px from the top of the list.
 *
 * Rows size to their own content: a stop with two rows of transfer bullets
 * is taller than a bare one, and forcing every row to the tallest left the
 * sparse ones swimming in space while a long bullet strip still overflowed
 * into the name below it. Nothing can be placed by index × a fixed height
 * any more, so the spine's ends and the vehicle markers read the real
 * layout instead — re-measured whenever it changes.
 */
const listEl = ref<HTMLElement | null>(null)
const rowEls = ref<HTMLElement[]>([])
const dotCenters = ref<number[]>([])

function measureRows() {
  const list = listEl.value
  if (!list) return
  const top = list.getBoundingClientRect().top
  dotCenters.value = rowEls.value
    .filter(Boolean)
    .map(el => el.getBoundingClientRect().top - top + STOP_DOT_CENTER_Y)
}

let rowObserver: ResizeObserver | null = null
watch(
  () => [listEl.value, displayStops.value.length] as const,
  async () => {
    await nextTick()
    measureRows()
    rowObserver?.disconnect()
    if (!listEl.value || typeof ResizeObserver === 'undefined') return
    // Fires for the container AND every row: bullets arrive asynchronously
    // (portolan's curated set lands after the stops do) and a row grows
    // when they do.
    rowObserver = new ResizeObserver(() => measureRows())
    rowObserver.observe(listEl.value)
    for (const el of rowEls.value) if (el) rowObserver.observe(el)
  },
  { flush: 'post' },
)
// Content changes (a name resolving, bullets arriving) relayout the rows
// without resizing the container, and ResizeObserver is not everywhere.
onUpdated(measureRows)
onUnmounted(() => rowObserver?.disconnect())

/** Where the spine starts and ends: the first and last dot centres. */
const spineTop = computed(() => dotCenters.value[0] ?? STOP_DOT_CENTER_Y)
const spineBottom = computed(
  () => dotCenters.value[dotCenters.value.length - 1] ?? STOP_DOT_CENTER_Y,
)

/**
 * Top offset in px for a vehicle at the given routeFraction.
 *
 * `routeFraction` is a position along the stop SEQUENCE, so it interpolates
 * between the two dots it falls between rather than scaling a total height
 * the rows no longer share.
 */
function vehicleTopPx(vr: VehicleOnRoute): number {
  const centers = dotCenters.value
  if (centers.length < 2) return spineTop.value
  const span = (centers.length - 1) * Math.min(Math.max(vr.routeFraction, 0), 1)
  const i = Math.min(Math.floor(span), centers.length - 2)
  return centers[i] + (centers[i + 1] - centers[i]) * (span - i)
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
    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <Spinner size="sm" />
    </div>

    <div v-else-if="route" class="flex flex-col pb-6">
      <!-- ── Route header ──────────────────────────────── -->
      <!-- Pinned: the stop list is long enough to scroll the line's identity
           away, and "which line is this" is the one thing you still need at
           the bottom of it.

           PanelLayout's inset stays on by default — it is what keeps a view
           without a pinned header out from under the sheet's floating handle.
           This header cancels it and re-adds the line it docks to, so its
           natural position IS that line. Any higher and sticky would shove it
           down without reflowing its siblings, hiding the top of the content
           below; any lower and the panel's unpainted inset shows as a gap
           above the band. -mx-3 lets the backing and rule span the panel. -->
      <SheetHeader
        v-slot="{ stuck }"
        class="-mx-3 mb-3 mt-[calc(var(--sheet-sticky-top,0px)_-_var(--panel-inset-top,0px))]"
      >
        <div
          class="px-3 md:pt-4 pb-3 border-b transition-colors duration-200"
          :class="stuck ? 'border-border/60' : 'border-transparent'"
        >
          <div class="flex items-start gap-3">
            <RouteBullet
              :label="headerBullet?.label || route.routeShortName || route.routeId"
              :color="headerBullet?.color || route.routeColor"
              :shape="headerBullet?.shape"
              :text-color="headerBullet?.color ? null : route.routeTextColor"
              size="lg"
              class="mt-0.5"
            />
            <div class="flex flex-col min-w-0 pt-0.5">
              <span class="font-semibold text-base leading-tight truncate">{{ fullName }}</span>
              <!-- Only when the picker below isn't already naming the
                   direction — otherwise the same string reads twice. -->
              <span
                v-if="activeDirection && directions.length <= 1"
                class="text-sm text-muted-foreground truncate"
              >
                {{ activeDirection }}
              </span>
            </div>
          </div>

          <!-- Pinned with the header: which way the line is running is part of
               reading the stop list, so it stays reachable from the bottom of it. -->
          <div v-if="directions.length > 1" class="mt-3">
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
        </div>
      </SheetHeader>

      <!-- ── Service alerts ────────────────────────────── -->
      <ServiceAlerts
        :query="alertQuery"
        :title="t('place.transit.alerts.onThisLine')"
        class="mb-3"
      />

      <!-- ── Departures ────────────────────────────────── -->
      <div v-if="upcoming.length > 0" class="mb-3">
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
      <div v-if="vehicles.length > 0" class="mb-3">
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
              <span class="truncate">{{ vehicleLabel(vr) }}</span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator class="mb-3" />

      <!-- ── Stop timeline ─────────────────────────────── -->
      <div>
        <div class="text-sm font-semibold mb-2">{{ t('place.transit.stops') }}</div>

        <div ref="listEl" class="relative" style="padding-left: 32px">
          <!-- Vertical route line, from the first dot centre to the last:
               split into passed (grey) and active (coloured) at the selected
               vehicle. Both ends read measured positions, so a row that grew
               to fit its bullets carries the spine with it. -->
          <div
            v-if="selectedVehicleOnRoute"
            class="absolute z-0 rounded-full"
            :style="{
              left: '12px',
              top: `${spineTop}px`,
              width: '3px',
              height: `${Math.max(0, vehicleTopPx(selectedVehicleOnRoute) - spineTop)}px`,
              background: 'hsl(var(--muted-foreground))',
            }"
          />
          <div
            class="absolute z-0 rounded-full"
            :style="{
              left: '12px',
              top: selectedVehicleOnRoute
                ? `${vehicleTopPx(selectedVehicleOnRoute)}px`
                : `${spineTop}px`,
              width: '3px',
              height: `${Math.max(
                0,
                spineBottom - (selectedVehicleOnRoute ? vehicleTopPx(selectedVehicleOnRoute) : spineTop),
              )}px`,
              background: bgColor,
            }"
          />

          <!-- Vehicle indicators (same style as map markers) -->
          <div
            v-for="vr in vehiclesOnRoute"
            :key="'v-' + vr.vehicleId"
            class="absolute z-20 cursor-pointer"
            :style="{
              left: '2px',
              top: `${vehicleTopPx(vr) - 11}px`,
            }"
            @click.stop="onSelectVehicle(vr.vehicleId)"
          >
            <div
              class="w-[22px] h-[22px] rounded-full flex items-center justify-center border-2 border-white transition-all"
              :style="{ background: bgColor, boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }"
              :class="{ 'ring-2 ring-offset-1 ring-offset-background scale-110': vr.vehicleId === selectedId }"
            >
              <component :is="routeTypeIcon" class="h-3 w-3" :style="{ color: textColor }" />
            </div>
          </div>

          <!-- Stop rows -->
          <!-- Rows size to their content. `min-h` keeps a bare stop from
               collapsing tighter than the timeline reads well at; a stop
               with bullets simply takes the room it needs. -->
          <div
            v-for="(stop, i) in displayStops"
            :ref="el => { if (el) rowEls[i] = el as HTMLElement }"
            :key="stop.stopId"
            class="relative flex items-start justify-between gap-2 py-0.5 min-h-[32px]"
          >
            <!-- Stop dot, on this row rather than placed by index -->
            <div
              class="absolute rounded-full border-2 z-10"
              :style="{
                width: (i === 0 || i === displayStops.length - 1) ? '11px' : '9px',
                height: (i === 0 || i === displayStops.length - 1) ? '11px' : '9px',
                left: (i === 0 || i === displayStops.length - 1) ? '-24px' : '-23px',
                top: `${STOP_DOT_CENTER_Y - ((i === 0 || i === displayStops.length - 1) ? 11 : 9) / 2}px`,
                borderColor: isStopPassedBySelected(i) ? 'hsl(var(--muted-foreground))' : bgColor,
                background: isStopPassedBySelected(i) ? 'hsl(var(--muted))' : 'hsl(var(--background))',
              }"
            />

            <div class="min-w-0 flex flex-col gap-1">
              <span
                class="text-sm min-w-0 truncate leading-6"
                :class="{
                  'font-semibold': i === 0 || i === displayStops.length - 1,
                  'text-muted-foreground': isStopPassedBySelected(i),
                }"
              >
                {{ stop.stopName }}
              </span>

              <!-- Other lines here. Transfers are dimmed: they are a walk
                   across the interchange, not a train on this platform. -->
              <div v-if="stop.routes?.length" class="flex items-center gap-1 flex-wrap">
                <button
                  v-for="r in stop.routes"
                  :key="r.routeId"
                  type="button"
                  class="cursor-pointer transition-transform hover:scale-110"
                  :title="r.routeLongName || r.routeShortName || r.routeId"
                  @click="openRouteDetail(r)"
                >
                  <RouteBullet
                    :label="stopBullet(r, stop)?.label || r.routeShortName || r.routeLongName || ''"
                    :color="stopBullet(r, stop)?.color || r.routeColor"
                    :shape="stopBullet(r, stop)?.shape"
                    :text-color="stopBullet(r, stop)?.color ? null : r.routeTextColor"
                    :class="r.via === 'transfer' && 'opacity-60'"
                  />
                </button>
              </div>
            </div>

            <!-- Departure time (when a vehicle is selected) -->
            <span
              v-if="stopTime(stop)"
              class="text-xs tabular-nums shrink-0"
              :class="isStopInPast(stop) ? 'text-muted-foreground' : 'font-medium'"
            >
              {{ stopTime(stop) }}
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
