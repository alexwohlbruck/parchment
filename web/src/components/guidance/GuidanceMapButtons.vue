<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellRingIcon, RouteIcon, Volume2Icon, VolumeXIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { useGuidanceStore } from '@/stores/guidance.store'
import CameraModeButton from './CameraModeButton.vue'
import { useGuidanceContext } from './context'

const props = defineProps<{ large?: boolean }>()
const { t } = useI18n()
const guidance = useGuidanceStore()
const { camera } = useGuidanceContext()

const SOUND_ICONS = { all: Volume2Icon, alerts: BellRingIcon, silent: VolumeXIcon }
const sound = computed(() => guidance.soundModeAt(guidance.progress?.puck.s ?? 0))
const free = computed(() => guidance.kind === 'free')
const overview = computed(() => camera.state.value === 'overview')

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
      :mode="guidance.cameraMode"
      :state="camera.state.value"
      @press="camera.pressCameraButton"
    />
  </div>
</template>
