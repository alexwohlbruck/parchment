<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeftIcon, XIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import GuidanceMenu from './GuidanceMenu.vue'
import GuidanceSteps from './GuidanceSteps.vue'
import AheadSearch from './AheadSearch.vue'
import RoutesPanel from './RoutesPanel.vue'
import DestinationSearch from './DestinationSearch.vue'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useGuidanceContext, type GuidancePanelKind } from '../context'

const props = defineProps<{
  kind: GuidancePanelKind
  /** Whether the menu carries its own header; the phone's card already has one. */
  menuHeader?: boolean
}>()
const { t } = useI18n()
const { panelReturnsToMenu, closePanel, camera, alternatives, metric } = useGuidanceContext()
const guidance = useGuidanceStore()

const TITLES = {
  menu: 'guidance.menu.title',
  steps: 'guidance.menu.steps',
  search: 'guidance.ahead.title',
  routes: 'guidance.alternatives.title',
  destination: 'guidance.free.whereTo',
} as const

const title = computed(() => (props.kind === 'search' && guidance.kind === 'free' ? 'guidance.free.ahead.title' : TITLES[props.kind]))

const header = computed(() => props.kind !== 'menu' || props.menuHeader)
</script>

<template>
  <div>
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
      <h2 class="font-sans text-lg font-semibold">{{ t(title) }}</h2>
    </div>
    <GuidanceMenu v-if="kind === 'menu'" />
    <GuidanceSteps v-else-if="kind === 'steps'" />
    <AheadSearch v-else-if="kind === 'search'" :metric="metric" @done="closePanel(true)" @found="camera.overview()" />
    <RoutesPanel v-else-if="kind === 'routes'" :alternatives="alternatives" @done="closePanel(true)" />
    <DestinationSearch v-else-if="kind === 'destination'" @done="closePanel(true)" />
  </div>
</template>
