<script setup lang="ts">
import { computed, defineAsyncComponent, inject, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { AppRoute } from '@/router'
import PanelLayout from '@/components/sheet/layouts/PanelLayout.vue'
import { SheetHeader } from '@/components/sheet'
import GuidanceOverlay from '@/components/guidance/GuidanceOverlay.vue'
import GuidanceBottomBar from '@/components/guidance/GuidanceBottomBar.vue'
import GuidanceMenu from '@/components/guidance/GuidanceMenu.vue'
import ArrivalPanel from '@/components/guidance/ArrivalPanel.vue'
import SegmentHandoff from '@/components/guidance/SegmentHandoff.vue'
import TransitStageCard from '@/components/guidance/TransitStageCard.vue'
import TransitApproach from '@/components/guidance/TransitApproach.vue'
import LiveTransitTimeline from '@/components/guidance/LiveTransitTimeline.vue'
import AheadSearch from '@/components/guidance/AheadSearch.vue'
import DockWatchCard from '@/components/guidance/DockWatchCard.vue'
import { useDockWatch } from '@/composables/guidance/useDockWatch'
import { EXPAND_MAP_SHEET } from '@/components/sheet/context'
import { serializeDirectionsQuery } from '@/lib/directions/directions-url'
import { segmentAt } from '@/lib/guidance/nav-route'
import { walkToStopSec } from '@/lib/guidance/transit-progress'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useAppStore } from '@/stores/app.store'
import { useGuidanceCamera } from '@/composables/guidance/useGuidanceCamera'
import { useGuidanceRouteLine } from '@/composables/guidance/useGuidanceRouteLine'
import { UnitSystem } from '@/types/map.types'

const GuidanceDevTools = import.meta.env.DEV
  ? defineAsyncComponent(() => import('@/dev/guidance/GuidanceDevTools.vue'))
  : null

const router = useRouter()
const { t } = useI18n()
const guidance = useGuidanceStore()
const { unitSystem } = storeToRefs(useAppStore())
const metric = computed(() => unitSystem.value === UnitSystem.METRIC)

if (!guidance.isActive) router.replace({ name: AppRoute.DIRECTIONS })

const camera = useGuidanceCamera()
useGuidanceRouteLine()

function exit() {
  guidance.stop()
  router.back()
}

const HEADER_STAGES = new Set(['wait', 'riding', 'missed-vehicle', 'missed-stop'])
const stageCard = computed(() => {
  const stage = guidance.transit
  return stage && HEADER_STAGES.has(stage.kind) ? stage : null
})
const approach = computed(() => {
  const stage = guidance.transit
  const route = guidance.route
  const puck = guidance.progress?.puck
  if (stage?.kind !== 'to-stop' || !route || !puck) return null
  return { stage, walkSec: walkToStopSec(route, stage, puck.s) }
})
const hasTransit = computed(() => guidance.segments.some(s => s.mode === 'transit'))
const currentSegment = computed(() => {
  const route = guidance.route
  const puck = guidance.progress?.puck
  return route && puck ? segmentAt(route, puck.s)?.index ?? 0 : 0
})

const docks = useDockWatch()

const expandSheet = inject(EXPAND_MAP_SHEET, () => {})
const searchingAhead = ref(false)
function openAheadSearch() {
  searchingAhead.value = true
  expandSheet()
}
function closeAheadSearch() {
  searchingAhead.value = false
  camera.follow()
}

const noLaterRun = ref(false)
watch(() => guidance.transit?.kind, () => (noLaterRun.value = false))
async function catchNextRun() {
  noLaterRun.value = !(await guidance.catchNextRun())
}

function findAnotherWay() {
  const from = guidance.progress?.puck.position
  const end = guidance.segments.at(-1)?.end
  if (!from || !end?.location) return
  const query = serializeDirectionsQuery({
    waypoints: [
      { lat: from.lat, lng: from.lng, label: t('directions.currentLocation') },
      { lat: end.location.lat, lng: end.location.lng, label: end.label },
    ],
    mode: 'multi',
  })
  guidance.stop()
  router.replace({ name: AppRoute.DIRECTIONS, query })
}

// With nothing left to navigate, the arrival card closes itself.
const ARRIVAL_DISMISS_MS = 30_000
let dismissTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => guidance.status,
  status => {
    if (dismissTimer) clearTimeout(dismissTimer)
    dismissTimer = status === 'arrived' && guidance.nextLeg == null ? setTimeout(exit, ARRIVAL_DISMISS_MS) : null
  },
)
onBeforeUnmount(() => {
  if (dismissTimer) clearTimeout(dismissTimer)
})

onBeforeUnmount(() => guidance.stop())
</script>

<template>
  <PanelLayout>
    <SheetHeader class="-mx-3 -mt-[var(--panel-inset-top)] px-3 pt-4 pb-3">
      <ArrivalPanel
        v-if="guidance.status === 'arrived'"
        :destination="guidance.destinationLabel"
        :has-next-leg="guidance.nextLeg != null"
        @done="exit"
        @next="guidance.startNextLeg()"
      />
      <TransitStageCard
        v-else-if="stageCard"
        :stage="stageCard"
        :segment="guidance.segments[stageCard.segmentIndex]"
        :now-ms="guidance.clockMs"
        :busy="guidance.rebooking"
        :no-later-run="noLaterRun"
        @next-run="catchNextRun"
        @another-way="findAnotherWay"
      />
      <SegmentHandoff
        v-else-if="guidance.handoff"
        :key="guidance.handoff.from"
        :handoff="guidance.handoff"
        @settle="guidance.settleHandoff()"
      />
      <div v-else class="flex flex-col gap-2">
        <DockWatchCard
          v-if="docks.watched.value"
          :need="docks.watched.value.need"
          :name="docks.watched.value.name"
          :station="docks.station.value"
          :risk="docks.risk.value"
          :alternative="docks.alternative.value"
          :dismissed="docks.dismissed.value"
          :switching="docks.switching.value"
          @accept="docks.accept()"
          @dismiss="docks.dismiss()"
        />
        <TransitApproach
          v-else-if="approach"
          :departure-ms="approach.stage.departureMs"
          :segment="guidance.segments[approach.stage.segmentIndex]"
          :now-ms="guidance.clockMs"
          :walk-sec="approach.walkSec"
        />
        <GuidanceBottomBar :progress="guidance.progress" :metric="metric" @exit="exit" />
      </div>
    </SheetHeader>
    <AheadSearch v-if="searchingAhead" :metric="metric" @done="closeAheadSearch" @found="camera.overview()" />
    <template v-else>
      <LiveTransitTimeline
        v-if="hasTransit"
        class="mb-4"
        :segments="guidance.segments"
        :current="currentSegment"
        :stage="guidance.transit"
      />
      <GuidanceMenu :camera="camera" :metric="metric" @exit="exit" @search-ahead="openAheadSearch" />
    </template>
    <component :is="GuidanceDevTools" v-if="GuidanceDevTools" class="mt-4" />
  </PanelLayout>

  <Teleport to="#mainContent">
    <GuidanceOverlay :camera="camera" :metric="metric" />
  </Teleport>
</template>
