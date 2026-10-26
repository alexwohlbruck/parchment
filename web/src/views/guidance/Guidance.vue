<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, provide, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { AppRoute } from '@/router'
import { useResponsive } from '@/lib/utils'
import GuidancePhoneLayout from '@/components/guidance/layouts/GuidancePhoneLayout.vue'
import GuidanceDashLayout from '@/components/guidance/layouts/GuidanceDashLayout.vue'
import { GUIDANCE_CONTEXT, type GuidancePanelKind } from '@/components/guidance/context'
import { useAlternativeRoutes } from '@/composables/guidance/useAlternativeRoutes'
import { useBetterItinerary } from '@/composables/guidance/useBetterItinerary'
import { useLaneGuidance } from '@/composables/guidance/useLaneGuidance'
import { useDockWatch } from '@/composables/guidance/useDockWatch'
import { useGuidanceCamera } from '@/composables/guidance/useGuidanceCamera'
import { useGuidanceRouteLine } from '@/composables/guidance/useGuidanceRouteLine'
import { panelAfterClose } from '@/lib/guidance/guidance-layout'
import { freeModeFor } from '@/lib/guidance/free-roam'
import { getWaypointPlaceRoute } from '@/lib/place/place-route'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useAppStore } from '@/stores/app.store'
import { UnitSystem } from '@/types/map.types'

const GuidanceDevTools = import.meta.env.DEV
  ? defineAsyncComponent(() => import('@/dev/guidance/GuidanceDevTools.vue'))
  : null

const router = useRouter()
const guidance = useGuidanceStore()
const { isMobileScreen } = useResponsive()
const { unitSystem } = storeToRefs(useAppStore())
const metric = computed(() => unitSystem.value === UnitSystem.METRIC)

if (!guidance.isActive) router.replace({ name: AppRoute.DIRECTIONS })

const camera = useGuidanceCamera()
useGuidanceRouteLine()
useLaneGuidance()
const docks = useDockWatch()
const alternatives = useAlternativeRoutes()
const itinerary = useBetterItinerary()

const panel = ref<GuidancePanelKind | null>(null)
const openedFrom = ref<GuidancePanelKind | null>(null)
const MAP_PANELS = new Set<GuidancePanelKind>(['search', 'routes', 'destination'])

function openPanel(next: GuidancePanelKind) {
  openedFrom.value = panel.value
  panel.value = next
  if (next === 'routes') camera.overview()
}

function closePanel(outright = false) {
  const leaving = panel.value
  panel.value = outright ? null : panelAfterClose(leaving, openedFrom.value, 'menu')
  openedFrom.value = null
  if (leaving && MAP_PANELS.has(leaving)) camera.follow()
}

// Away from the route there is nothing to follow; show the whole of it until the traveller joins.
watch(
  () => guidance.status === 'away',
  away => (away ? camera.overview() : camera.follow()),
)

const arrivedForGood = computed(() => guidance.status === 'arrived' && guidance.nextLeg == null)
const keepGoing = computed(() => (arrivedForGood.value ? freeModeFor(guidance.segments.at(-1)?.mode ?? '') : null))

function exit() {
  panel.value = null
  const destination = arrivedForGood.value ? getWaypointPlaceRoute(guidance.segments.at(-1)?.end) : null
  guidance.stop()
  if (destination) router.replace(destination)
  else router.back()
}

// Back closes an open panel before it leaves navigation.
onBeforeRouteLeave(() => {
  if (!panel.value || !guidance.isActive) return true
  closePanel()
  return false
})

provide(GUIDANCE_CONTEXT, {
  camera,
  alternatives,
  itinerary,
  docks,
  metric,
  panel,
  panelReturnsToMenu: computed(() => panel.value !== 'menu' && openedFrom.value === 'menu'),
  openPanel,
  closePanel,
  exit,
  keepGoing,
})

// With nothing left to navigate, the arrival card hands over to the destination's page.
const ARRIVAL_DISMISS_MS = 8_000
let dismissTimer: ReturnType<typeof setTimeout> | null = null
watch(arrivedForGood, arrived => {
  if (dismissTimer) clearTimeout(dismissTimer)
  dismissTimer = arrived ? setTimeout(exit, ARRIVAL_DISMISS_MS) : null
})
onBeforeUnmount(() => {
  if (dismissTimer) clearTimeout(dismissTimer)
  guidance.stop()
})
</script>

<template>
  <component :is="isMobileScreen ? GuidancePhoneLayout : GuidanceDashLayout">
    <template v-if="GuidanceDevTools" #dev="{ placement }">
      <component :is="GuidanceDevTools" :placement="placement" :alternatives="alternatives" :itinerary="itinerary" />
    </template>
  </component>
</template>
