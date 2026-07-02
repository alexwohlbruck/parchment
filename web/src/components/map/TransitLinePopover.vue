<script setup lang="ts">
/**
 * Transit line click-through: route picker.
 *
 * Listens for `click:transit-line` on the map event bus (emitted by the
 * transit line interaction wiring with the deduped candidates under the
 * click):
 *   - one candidate  → navigate straight to the route detail page
 *   - several        → ResponsivePopover anchored at the click (popover on
 *     desktop, bottom sheet on mobile) listing each candidate as
 *     RouteBullet + name; picking one navigates.
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
import ResponsivePopover from '@/components/responsive/ResponsivePopover.vue'
import RouteBullet from '@/components/transit/RouteBullet.vue'

const router = useRouter()
const { t } = useI18n()

const open = ref(false)
const position = ref({ x: 0, y: 0 })
const candidates = ref<TransitRouteCandidate[]>([])

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

async function onTransitLineClick(event: MapEvents['click:transit-line']) {
  if (event.candidates.length === 0) return
  if (event.candidates.length === 1) {
    openRoute(event.candidates[0])
    return
  }

  position.value = { x: event.point.x, y: event.point.y }
  candidates.value = event.candidates
  // Re-open even when already showing so the popover re-anchors to the new
  // click position (floating-ui doesn't observe virtual-rect changes).
  open.value = false
  await nextTick()
  open.value = true
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
})
onUnmounted(() => {
  mapEventBus.off('click:transit-line', onTransitLineClick)
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
  </ResponsivePopover>
</template>
