<script setup lang="ts">
/**
 * Transit map click-through: route/stop picker.
 *
 * Listens on the map event bus for the transit click events emitted by the
 * transit layer interaction wiring:
 *
 *   - `click:transit-line` — deduped candidates under a canvas click: route
 *     lines and/or stop points. One candidate total → navigate straight to
 *     its detail page (route detail, or the proprietary stop detail keyed by
 *     GTFS feedId+stopId). Several → ResponsivePopover anchored at the click
 *     (popover on desktop, bottom sheet on mobile) listing stops first, then
 *     routes (RouteBullet + name); picking one navigates.
 *   - `click:transit-station` — a rail station DOM marker click. Station
 *     complexes are already deduped per marker, so this always navigates
 *     straight to the station detail (keyed by label point + name — the
 *     clustered transit_stations features carry no GTFS ids).
 *
 * Desktop anchoring uses ResponsivePopover's `reference` — a floating-ui
 * virtual element reading the click's viewport coordinates — so the picker
 * opens exactly at the click with no placeholder trigger element. Any map
 * movement dismisses the picker (the move listener is only registered while
 * it is open).
 */
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { mapEventBus } from '@/lib/eventBus'
import { AppRoute } from '@/router'
import type { MapEvents } from '@/types/map.types'
import type { TransitRouteCandidate } from '@/lib/transit-route-candidates'
import type { TransitStopCandidate } from '@/lib/transit-stop-candidates'
import ResponsivePopover from '@/components/responsive/ResponsivePopover.vue'
import RouteBullet from '@/components/transit/RouteBullet.vue'

const router = useRouter()
const { t } = useI18n()

const open = ref(false)
const position = ref({ x: 0, y: 0 })
const candidates = ref<TransitRouteCandidate[]>([])
const stops = ref<TransitStopCandidate[]>([])

// Stable virtual anchor at the last click's viewport coordinates. The rect is
// read when the popover opens; re-opens (below) re-anchor it to fresh clicks.
const clickAnchor = {
  getBoundingClientRect: () =>
    new DOMRect(position.value.x, position.value.y, 0, 0),
}

function openRoute(candidate: TransitRouteCandidate) {
  open.value = false
  router.push({
    name: AppRoute.TRANSIT_ROUTE,
    params: { feedId: candidate.feedId, routeId: candidate.routeId },
  })
}

function openStop(stop: TransitStopCandidate) {
  open.value = false
  router.push({
    name: AppRoute.TRANSIT_STOP,
    params: { feedId: stop.feedId, stopId: stop.stopId },
    query: stop.name ? { name: stop.name } : undefined,
  })
}

async function onTransitLineClick(event: MapEvents['click:transit-line']) {
  const total = event.stops.length + event.candidates.length
  if (total === 0) return
  if (total === 1) {
    if (event.stops.length === 1) openStop(event.stops[0])
    else openRoute(event.candidates[0])
    return
  }

  position.value = { x: event.point.x, y: event.point.y }
  candidates.value = event.candidates
  stops.value = event.stops
  // Re-open even when already showing so the popover re-anchors to the new
  // click position (floating-ui doesn't observe virtual-rect changes).
  open.value = false
  await nextTick()
  open.value = true
}

function onTransitStationClick(event: MapEvents['click:transit-station']) {
  open.value = false
  router.push({
    name: AppRoute.TRANSIT_STATION,
    params: {
      lat: event.lngLat.lat.toFixed(6),
      lng: event.lngLat.lng.toFixed(6),
    },
    query: event.name ? { name: event.name } : undefined,
  })
}

// Dismiss cleanly on any map interaction — registered only while open so an
// idle picker costs nothing per frame (and isn't exposed to the bus-wide
// off('move') the map service performs on engine swaps).
function onMapMove() {
  open.value = false
}
watch(open, (isOpen, wasOpen) => {
  if (isOpen && !wasOpen) mapEventBus.on('move', onMapMove)
  if (!isOpen && wasOpen) mapEventBus.off('move', onMapMove)
})

onMounted(() => {
  mapEventBus.on('click:transit-line', onTransitLineClick)
  mapEventBus.on('click:transit-station', onTransitStationClick)
})
onUnmounted(() => {
  mapEventBus.off('click:transit-line', onTransitLineClick)
  mapEventBus.off('click:transit-station', onTransitStationClick)
  mapEventBus.off('move', onMapMove)
})
</script>

<template>
  <ResponsivePopover
    :open="open"
    :reference="clickAnchor"
    align="start"
    side="bottom"
    :side-offset="6"
    fit-content
    desktop-content-class="w-64 p-1.5"
    @update:open="value => (open = value)"
  >
    <template #content="{ close }">
      <template v-if="stops.length > 0">
        <div class="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
          {{ t('map.transit.chooseStop') }}
        </div>
        <div class="flex flex-col gap-0.5">
          <button
            v-for="stop in stops"
            :key="`${stop.feedId}:${stop.stopId}`"
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent transition-colors"
            @click="
              () => {
                close()
                openStop(stop)
              }
            "
          >
            <span
              class="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-foreground/20"
              :style="{
                background: stop.routeColor
                  ? `#${stop.routeColor}`
                  : 'hsl(var(--muted-foreground))',
              }"
            />
            <span class="text-sm truncate min-w-0">
              {{ stop.name || t('place.transit.transitStop') }}
            </span>
          </button>
        </div>
      </template>
      <template v-if="candidates.length > 0">
        <div class="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
          {{ t('map.transit.chooseRoute') }}
        </div>
        <div class="flex flex-col gap-0.5">
          <button
            v-for="candidate in candidates"
            :key="`${candidate.feedId}:${candidate.routeId}`"
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent transition-colors"
            @click="
              () => {
                close()
                openRoute(candidate)
              }
            "
          >
            <RouteBullet
              :label="candidate.shortName || candidate.routeId"
              :color="candidate.color"
              :text-color="candidate.textColor"
            />
            <span class="text-sm truncate min-w-0">
              {{ candidate.longName || candidate.shortName || candidate.routeId }}
            </span>
          </button>
        </div>
      </template>
    </template>
  </ResponsivePopover>
</template>
