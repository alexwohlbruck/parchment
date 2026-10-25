<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellRingIcon, RouteIcon, Volume2Icon, VolumeXIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useObstructingComponent } from '@/composables/sheet/useObstructingComponent'
import { roadLabel, travelModeAt } from '@/lib/guidance/guidance-display'
import { modeProfile } from '@/lib/guidance/mode-profiles'
import { toContainerRect } from '@/lib/map/map-padding'
import type { useGuidanceCamera } from '@/composables/guidance/useGuidanceCamera'
import type { useAlternativeRoutes } from '@/composables/guidance/useAlternativeRoutes'
import AlternativeOffer from './AlternativeOffer.vue'
import ManeuverBanner from './ManeuverBanner.vue'
import SpeedPanel from './SpeedPanel.vue'
import RoadNameLabel from './RoadNameLabel.vue'
import CameraModeButton from './CameraModeButton.vue'
import HazardChip from './HazardChip.vue'
import { upcomingHazard } from '@/lib/guidance/hazards'

const props = defineProps<{
  camera: ReturnType<typeof useGuidanceCamera>
  metric: boolean
  alternatives: ReturnType<typeof useAlternativeRoutes>
}>()

const { t } = useI18n()
const appStore = useAppStore()
const guidance = useGuidanceStore()

const banner = ref<HTMLElement | null>(null)
useObstructingComponent(banner, 'guidance-banner')

const root = ref<HTMLElement | null>(null)
// visibleMapArea is in viewport space; the overlay is laid out in the map container's.
const visible = computed(() => {
  const area = appStore.visibleMapArea
  const origin = root.value?.getBoundingClientRect()
  return origin ? toContainerRect(area, origin) : area
})
const bottomInset = computed(() => {
  const height = root.value?.clientHeight ?? window.innerHeight
  return Math.max(0, height - (visible.value.y + visible.value.height))
})

const mode = computed(() => {
  const route = guidance.route
  const puck = guidance.progress?.puck
  return route && puck ? travelModeAt(route, puck.s) : 'driving'
})

// Waiting for or riding a vehicle has no turns to show.
const onTransit = computed(() => {
  const kind = guidance.transit?.kind
  return kind != null && kind !== 'to-stop'
})

const hazardAhead = computed(() => {
  const route = guidance.route
  const puck = guidance.progress?.puck
  return route && puck?.snapped && guidance.status === 'navigating' ? upcomingHazard(route, puck.s, puck.speed) : null
})

const SOUND_ICONS = { all: Volume2Icon, alerts: BellRingIcon, silent: VolumeXIcon }
const sound = computed(() => guidance.soundModeAt(guidance.progress?.puck.s ?? 0))

const label = computed(() => {
  const route = guidance.route
  const puck = guidance.progress?.puck
  if (!route || !puck || !puck.snapped) return null
  const road = roadLabel(route, puck.s)
  return road.kind === 'named'
    ? { name: road.name, ref: road.ref }
    : { name: t(`guidance.roads.${road.key}`) }
})

// The puck is pinned to the camera's focal point while following, so the
// label can sit there without tracking the marker frame by frame.
const labelStyle = computed(() => {
  const focal = guidance.preferences.cameraMode === 'north-up' ? 0.5 : guidance.cameraTuning.focal
  return {
    left: `${visible.value.x + visible.value.width / 2}px`,
    top: `${visible.value.y + visible.value.height * focal + 30}px`,
  }
})
</script>

<template>
  <div ref="root" class="pointer-events-none absolute inset-0 z-30">
    <div ref="banner" class="absolute inset-x-0 top-0 px-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
      <ManeuverBanner
        v-if="!onTransit"
        :progress="guidance.progress"
        :status="guidance.status"
        :destination="guidance.destinationLabel"
        :metric="metric"
        class="mx-auto max-w-xl"
      />
      <AlternativeOffer
        v-if="alternatives.offer.value"
        :key="alternatives.offer.value.segmentIndex + ':' + alternatives.offer.value.route.duration"
        class="mx-auto mt-2 max-w-xl"
        :offer="alternatives.offer.value"
        :seconds="alternatives.offerSeconds"
        @accept="alternatives.accept()"
        @dismiss="alternatives.dismiss()"
      />
      <HazardChip v-else-if="hazardAhead" :hazard="hazardAhead.hazard" :distance="hazardAhead.distance" :metric="metric" />
    </div>

    <div
      v-if="label && camera.following.value && !onTransit"
      class="absolute -translate-x-1/2"
      :style="labelStyle"
    >
      <RoadNameLabel :name="label.name" :ref-name="label.ref" />
    </div>

    <div class="absolute left-2 transition-[bottom] duration-150" :style="{ bottom: `${bottomInset + 12}px` }">
      <SpeedPanel
        v-if="modeProfile(mode).speedometer && guidance.progress"
        :speed="guidance.progress.puck.speed"
        :limit-kmh="guidance.progress.speedLimitKmh"
        :metric="metric"
        :show-limit="modeProfile(mode).speedLimit"
      />
    </div>

    <div
      class="pointer-events-auto absolute right-2 flex flex-col gap-2 transition-[bottom] duration-150"
      :style="{ bottom: `${bottomInset + 12}px` }"
    >
      <Button
        size="icon"
        variant="secondary"
        class="size-11 rounded-full shadow-md"
        :title="t(`guidance.sound.${sound}`)"
        :aria-label="t(`guidance.sound.${sound}`)"
        @click="guidance.cycleSound()"
      >
        <component :is="SOUND_ICONS[sound]" class="size-5" />
      </Button>
      <Button
        size="icon"
        class="size-11 rounded-full shadow-md"
        :variant="props.camera.state.value === 'overview' ? 'default' : 'secondary'"
        :title="t('guidance.camera.overview')"
        :aria-label="t('guidance.camera.overview')"
        @click="props.camera.state.value === 'overview' ? props.camera.follow() : props.camera.overview()"
      >
        <RouteIcon class="size-5" />
      </Button>
      <CameraModeButton
        class="size-11 rounded-full shadow-md"
        :mode="guidance.preferences.cameraMode"
        :state="props.camera.state.value"
        @press="props.camera.pressCameraButton"
      />
    </div>
  </div>
</template>
