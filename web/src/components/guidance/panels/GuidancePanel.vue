<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeftIcon, XIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import GuidanceMenu from './GuidanceMenu.vue'
import GuidanceSteps from './GuidanceSteps.vue'
import AheadSearch from './AheadSearch.vue'
import RoutesPanel from './RoutesPanel.vue'
import DestinationSearch from './DestinationSearch.vue'
import ParkingPanel from './ParkingPanel.vue'
import DockPanel from './DockPanel.vue'
import { useGuidanceStore } from '@/stores/guidance.store'
import { parkingTitle } from '../parking-copy'
import { useGuidanceContext, type GuidancePanelKind } from '../context'
import type { LngLat } from '@/types/map.types'

const props = defineProps<{
  kind: GuidancePanelKind
  /** Whether the menu carries its own header; the phone's card already has one. */
  menuHeader?: boolean
}>()
const { t } = useI18n()
const { panelReturnsToMenu, closePanel, camera, alternatives, metric, parking, docks } = useGuidanceContext()
const guidance = useGuidanceStore()

const TITLES = {
  menu: 'guidance.menu.title',
  steps: 'guidance.menu.steps',
  search: 'guidance.ahead.title',
  routes: 'guidance.alternatives.title',
  destination: 'guidance.free.whereTo',
  parking: 'guidance.menu.parking',
  docks: 'guidance.menu.docks',
} as const

const title = computed(() => {
  if (props.kind === 'search' && guidance.kind === 'free') return t('guidance.free.ahead.title')
  const destination = parking.destination.value
  if (props.kind === 'parking' && destination) return parkingTitle(t, destination)
  if (props.kind === 'docks' && docks.watched.value) return t(`guidance.docks.pick.${docks.watched.value.need}`)
  return t(TITLES[props.kind])
})

const header = computed(() => props.kind !== 'menu' || props.menuHeader)

/** The sheet grows to fit a list as it fills in; frame once it has. */
const SHEET_SETTLE_MS = 350
const root = ref<HTMLElement | null>(null)
async function frame(places: LngLat[]) {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, SHEET_SETTLE_MS))
  const sheet = root.value?.closest('[data-vaul-drawer]') ?? root.value
  camera.overview(places, sheet?.getBoundingClientRect().top)
}
</script>

<template>
  <div ref="root">
    <div v-if="header" class="mb-3 flex items-center gap-1">
      <Button
        size="icon"
        variant="ghost"
        class="-ml-2 size-12 shrink-0 rounded-full"
        :aria-label="panelReturnsToMenu ? t('guidance.menu.back') : t('guidance.menu.close')"
        @click="closePanel()"
      >
        <ChevronLeftIcon v-if="panelReturnsToMenu" class="size-5" />
        <XIcon v-else class="size-5" />
      </Button>
      <h2 class="min-w-0 truncate font-sans text-lg font-semibold">{{ title }}</h2>
    </div>
    <GuidanceMenu v-if="kind === 'menu'" />
    <GuidanceSteps v-else-if="kind === 'steps'" />
    <AheadSearch v-else-if="kind === 'search'" :metric="metric" @done="closePanel(true)" @found="frame" />
    <RoutesPanel v-else-if="kind === 'routes'" :alternatives="alternatives" @done="closePanel(true)" />
    <DestinationSearch v-else-if="kind === 'destination'" @done="closePanel(true)" />
    <ParkingPanel v-else-if="kind === 'parking'" @done="closePanel(true)" @found="frame" />
    <DockPanel v-else-if="kind === 'docks'" @done="closePanel(true)" @found="frame" />
  </div>
</template>
