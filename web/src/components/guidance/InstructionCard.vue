<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { AppRoute } from '@/router'
import { serializeDirectionsQuery } from '@/lib/directions/directions-url'
import { walkToStopSec } from '@/lib/guidance/transit-progress'
import { rideCertainty } from '@/lib/guidance/ride-estimator'
import { isAboard } from '@/lib/guidance/guidance-layout'
import type { VehicleCandidate } from '@/lib/guidance/vehicle-switch'
import { bannerCue } from '@/lib/guidance/instructions/instruction-text'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useRoutePreviewStore } from '@/stores/route-preview.store'
import { useRunChoices } from '@/composables/guidance/useRunChoices'
import { Button } from '@/components/ui/button'
import ManeuverBanner from './ManeuverBanner.vue'
import TransitStageCard from './transit/TransitStageCard.vue'
import StationStepCard from './transit/StationStepCard.vue'
import TransitApproach from './transit/TransitApproach.vue'
import MissedRecovery from './transit/MissedRecovery.vue'
import RunPicker from './transit/RunPicker.vue'
import { useGuidanceContext } from './context'

defineProps<{ dash?: boolean }>()
const { t } = useI18n()
const router = useRouter()
const guidance = useGuidanceStore()
const { metric, recovery, vehicleSwitch } = useGuidanceContext()

const stage = computed(() => (isAboard(guidance.transit) ? guidance.transit : null))

const approach = computed(() => {
  const current = guidance.transit
  const route = guidance.route
  const puck = guidance.progress?.puck
  if (current?.kind !== 'to-stop' || !route || !puck) return null
  return { stage: current, walkSec: walkToStopSec(route, current, puck.s) }
})

/** The ride whose runs are listed, while the rider can still pick one. */
const picking = ref(false)
const pickable = computed(() => {
  if (approach.value) return { segmentIndex: approach.value.stage.segmentIndex, walkSec: approach.value.walkSec }
  return stage.value?.kind === 'wait' ? { segmentIndex: stage.value.segmentIndex, walkSec: 0 } : null
})
watch(() => pickable.value?.segmentIndex, () => (picking.value = false))
const runs = useRunChoices(
  computed(() => pickable.value?.segmentIndex ?? null),
  computed(() => pickable.value?.walkSec ?? 0),
  picking,
)

async function chooseRun(candidate: VehicleCandidate, known: string[]) {
  const ride = pickable.value
  picking.value = false
  if (ride) await vehicleSwitch.choose(ride.segmentIndex, candidate, known)
}

const LANES_SHOW_METERS = 500
const LANES_SHOW_SECONDS = 30
const lanes = computed(() => {
  const progress = guidance.progress
  const next = progress?.next
  if (!next || progress.distanceToNext == null) return null
  const within = Math.max(LANES_SHOW_METERS, progress.puck.speed * LANES_SHOW_SECONDS)
  return progress.distanceToNext <= within ? guidance.lanePlans.get(next.index) ?? null : null
})

const cue = computed(() => (guidance.nextInstruction ? bannerCue(guidance.nextInstruction, t) : null))

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
  <div class="relative">
    <div class="nav-card overflow-hidden">
      <StationStepCard
        v-if="guidance.stationGuide"
        class="p-4"
        :class="stage && 'border-b'"
        :target="guidance.stationGuide.target"
        :state="guidance.stationGuide.state"
        :now-ms="guidance.clockMs"
        @next="guidance.nextStationStep"
      />
      <TransitStageCard
        v-if="stage"
        :class="guidance.stationGuide ? 'px-4 py-3' : 'p-5'"
        :compact="!!guidance.stationGuide"
        :stage="stage"
        :segments="guidance.segments"
        :now-ms="guidance.clockMs"
        :certainty="rideCertainty(guidance.rideEstimate)"
        :busy="guidance.rebooking"
        :no-later-run="noLaterRun"
        :recovering="!!recovery.view.value"
        :picking="picking"
        @pick-run="picking = !picking"
        @next-run="catchNextRun"
        @another-way="findAnotherWay"
        @alight="guidance.alight(stage.segmentIndex)"
      />
      <template v-else-if="!guidance.stationGuide">
        <ManeuverBanner
          :progress="guidance.progress"
          :status="guidance.status"
          :destination="guidance.destinationLabel"
          :metric="metric"
          :lanes="lanes"
          :instruction="guidance.nextInstruction"
          :cue="cue"
          :dash="dash"
        />
        <div v-if="guidance.status === 'away'" class="px-5 pb-4">
          <Button variant="secondary" class="h-12 rounded-full px-5" @click="previewRoute">
            {{ t('guidance.preview.previewRoute') }}
          </Button>
        </div>
      </template>
      <TransitApproach
        v-if="approach"
        class="border-t px-5 py-3"
        :departure-ms="approach.stage.departureMs"
        :segment="guidance.segments[approach.stage.segmentIndex]"
        :now-ms="guidance.clockMs"
        :walk-sec="approach.walkSec"
        :open="picking"
        @toggle="picking = !picking"
      />
      <MissedRecovery
        v-if="recovery.view.value"
        class="border-t px-5 py-3"
        :view="recovery.view.value"
        :now-ms="guidance.clockMs"
        @take="recovery.take"
        @other-routes="findAnotherWay"
      />
    </div>
    <!-- Out of flow so the banner's measured obstruction, and with it the camera, ignores the list. -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="-translate-y-1 opacity-0"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="-translate-y-1 opacity-0"
    >
      <RunPicker
        v-if="picking && pickable"
        class="nav-card absolute inset-x-0 top-full z-10 mt-2 max-h-[50vh] overflow-y-auto px-5 py-2"
        :choices="runs.choices.value"
        :known="runs.known.value"
        :loading="runs.loading.value"
        :now-ms="guidance.clockMs"
        @choose="chooseRun"
      />
    </Transition>
  </div>
</template>
