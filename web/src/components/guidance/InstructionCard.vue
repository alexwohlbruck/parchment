<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { AppRoute } from '@/router'
import { serializeDirectionsQuery } from '@/lib/directions/directions-url'
import { walkToStopSec } from '@/lib/guidance/transit-progress'
import { isAboard } from '@/lib/guidance/guidance-layout'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useRoutePreviewStore } from '@/stores/route-preview.store'
import { Button } from '@/components/ui/button'
import ManeuverBanner from './ManeuverBanner.vue'
import TransitStageCard from './transit/TransitStageCard.vue'
import TransitApproach from './transit/TransitApproach.vue'
import { useGuidanceContext } from './context'

defineProps<{ dash?: boolean }>()
const { t } = useI18n()
const router = useRouter()
const guidance = useGuidanceStore()
const { metric } = useGuidanceContext()

const stage = computed(() => (isAboard(guidance.transit) ? guidance.transit : null))

const approach = computed(() => {
  const current = guidance.transit
  const route = guidance.route
  const puck = guidance.progress?.puck
  if (current?.kind !== 'to-stop' || !route || !puck) return null
  return { stage: current, walkSec: walkToStopSec(route, current, puck.s) }
})

const LANES_SHOW_METERS = 500
const LANES_SHOW_SECONDS = 30
const lanes = computed(() => {
  const progress = guidance.progress
  const next = progress?.next
  if (!next || progress.distanceToNext == null) return null
  const within = Math.max(LANES_SHOW_METERS, progress.puck.speed * LANES_SHOW_SECONDS)
  return progress.distanceToNext <= within ? guidance.lanePlans.get(next.index) ?? null : null
})

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

const routePreview = useRoutePreviewStore()
function previewRoute() {
  const option = guidance.trip
  if (!option) return
  routePreview.open(option, guidance.legIndex)
  router.replace({ name: AppRoute.ROUTE_PREVIEW })
}
</script>

<template>
  <div class="nav-card overflow-hidden">
    <TransitStageCard
      v-if="stage"
      class="p-5"
      :stage="stage"
      :segment="guidance.segments[stage.segmentIndex]"
      :now-ms="guidance.clockMs"
      :busy="guidance.rebooking"
      :no-later-run="noLaterRun"
      @next-run="catchNextRun"
      @another-way="findAnotherWay"
    />
    <template v-else>
      <ManeuverBanner
        :progress="guidance.progress"
        :status="guidance.status"
        :destination="guidance.destinationLabel"
        :metric="metric"
        :lanes="lanes"
        :dash="dash"
      />
      <TransitApproach
        v-if="approach"
        class="border-t px-5 py-3"
        :departure-ms="approach.stage.departureMs"
        :segment="guidance.segments[approach.stage.segmentIndex]"
        :now-ms="guidance.clockMs"
        :walk-sec="approach.walkSec"
      />
      <div v-if="guidance.status === 'away'" class="px-5 pb-4">
        <Button variant="secondary" class="h-12 rounded-full px-5" @click="previewRoute">
          {{ t('guidance.preview.previewRoute') }}
        </Button>
      </div>
    </template>
  </div>
</template>
