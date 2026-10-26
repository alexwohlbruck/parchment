<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellRingIcon, RouteIcon, SearchIcon, Settings2Icon, SplitIcon, Volume2Icon, VolumeXIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { canSearchAhead } from '@/services/guidance/route-search.service'
import { canReroute } from '@/services/guidance/reroute.service'
import { useGuidanceStore } from '@/stores/guidance.store'
import CameraModeButton from './CameraModeButton.vue'
import { useGuidanceContext, type GuidancePanelKind } from './context'

const props = defineProps<{
  /** Adds the panels to the stack, as car screens do. */
  panels?: boolean
  large?: boolean
}>()
const { t } = useI18n()
const guidance = useGuidanceStore()
const { camera, panel, openPanel, closePanel } = useGuidanceContext()

const SOUND_ICONS = { all: Volume2Icon, alerts: BellRingIcon, silent: VolumeXIcon }
const sound = computed(() => guidance.soundModeAt(guidance.progress?.puck.s ?? 0))
const free = computed(() => guidance.kind === 'free')
const overview = computed(() => camera.state.value === 'overview')

const panelButtons = computed(() =>
  props.panels
    ? [
        { kind: 'search' as const, icon: SearchIcon, label: t(free.value ? 'guidance.menu.alongTheWay' : 'guidance.menu.searchAlongRoute'), enabled: canSearchAhead(guidance.travelMode) },
        { kind: 'routes' as const, icon: SplitIcon, label: t('guidance.menu.routes'), enabled: canReroute(guidance.travelMode) },
        { kind: 'menu' as const, icon: Settings2Icon, label: t('guidance.menu.title'), enabled: true },
      ].filter(item => !free.value || item.kind !== 'routes')
    : [],
)

function toggle(kind: GuidancePanelKind) {
  if (panel.value === kind) closePanel()
  else openPanel(kind)
}

const size = computed(() => (props.large ? 'size-16 [&_svg]:size-6' : 'size-12 [&_svg]:size-5'))
</script>

<template>
  <div class="pointer-events-auto flex flex-col" :class="large ? 'gap-3' : 'gap-2.5'">
    <Button
      size="icon"
      variant="secondary"
      class="rounded-full shadow-lg"
      :class="size"
      :title="t(`guidance.sound.${sound}`)"
      :aria-label="t(`guidance.sound.${sound}`)"
      @click="guidance.cycleSound()"
    >
      <component :is="SOUND_ICONS[sound]" />
    </Button>
    <Button
      v-if="!free"
      size="icon"
      class="rounded-full shadow-lg"
      :class="size"
      :variant="overview ? 'default' : 'secondary'"
      :title="t('guidance.camera.overview')"
      :aria-label="t('guidance.camera.overview')"
      :aria-pressed="overview"
      @click="overview ? camera.follow() : camera.overview()"
    >
      <RouteIcon />
    </Button>
    <CameraModeButton
      class="rounded-full shadow-lg"
      :class="size"
      :mode="guidance.preferences.cameraMode"
      :state="camera.state.value"
      @press="camera.pressCameraButton"
    />
    <Button
      v-for="item in panelButtons"
      :key="item.kind"
      size="icon"
      class="rounded-full shadow-lg"
      :class="size"
      :variant="panel === item.kind ? 'default' : 'secondary'"
      :disabled="!item.enabled"
      :title="item.label"
      :aria-label="item.label"
      :aria-pressed="panel === item.kind"
      @click="toggle(item.kind)"
    >
      <component :is="item.icon" />
    </Button>
  </div>
</template>
