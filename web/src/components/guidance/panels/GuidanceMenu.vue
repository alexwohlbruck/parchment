<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ListIcon, MapPinIcon, MegaphoneIcon, PlusIcon, SearchIcon, SplitIcon } from 'lucide-vue-next'
import { CAMERA_MODES } from '@/lib/guidance/camera-framing'
import { segmentAt } from '@/lib/guidance/nav-route'
import { FREE_MODES } from '@/lib/guidance/free-roam'
import { modeProfile } from '@/lib/guidance/mode-profiles'
import { SPEED_DISPLAYS } from '@/lib/guidance/speed-display'
import { canSearchAhead } from '@/services/guidance/route-search.service'
import { canReroute } from '@/services/guidance/reroute.service'
import { SOUND_MODES, useGuidanceStore } from '@/stores/guidance.store'
import { puckMode } from '@/lib/guidance/vehicle-indicator'
import VehiclePicker from '../VehiclePicker.vue'
import LiveTransitTimeline from '../transit/LiveTransitTimeline.vue'
import { useGuidanceContext } from '../context'

const { t } = useI18n()
const guidance = useGuidanceStore()
const { camera, openPanel } = useGuidanceContext()

const s = computed(() => guidance.progress?.puck.s ?? 0)
const travelMode = computed(() => guidance.travelMode)
const hasTransit = computed(() => guidance.segments.some(segment => segment.mode === 'transit'))
const currentSegment = computed(() => (guidance.route ? segmentAt(guidance.route, s.value)?.index ?? 0 : 0))

const actions = computed(() => guidance.kind === 'free' ? [
  { key: 'destination', icon: MapPinIcon, enabled: true, open: () => openPanel('destination') },
  { key: 'alongTheWay', icon: SearchIcon, enabled: canSearchAhead(travelMode.value), open: () => openPanel('search') },
  { key: 'report', icon: MegaphoneIcon, enabled: false, open: () => {} },
] : [
  { key: 'search', icon: SearchIcon, enabled: canSearchAhead(travelMode.value), open: () => openPanel('search') },
  { key: 'addStop', icon: PlusIcon, enabled: canSearchAhead(travelMode.value), open: () => openPanel('search') },
  { key: 'routes', icon: SplitIcon, enabled: canReroute(travelMode.value), open: () => openPanel('routes') },
  { key: 'steps', icon: ListIcon, enabled: !!guidance.route?.steps.length, open: () => openPanel('steps') },
  { key: 'report', icon: MegaphoneIcon, enabled: false, open: () => {} },
])

const sound = computed(() => guidance.soundModeAt(s.value))
function setSound(mode: (typeof SOUND_MODES)[number]) {
  guidance.preferences.sound = { ...guidance.preferences.sound, [travelMode.value]: mode }
}

const freeModeChoice = computed(() => guidance.kind === 'free' ? [{
  key: 'mode',
  title: t('guidance.free.mode'),
  options: FREE_MODES.map(mode => ({
    key: mode,
    label: t(`guidance.free.start.${mode}`),
    active: guidance.freeMode === mode,
    pick: () => guidance.setFreeMode(mode),
  })),
}] : [])

const speedChoice = computed(() => modeProfile(travelMode.value).speedometer ? [{
  key: 'speed',
  title: t('guidance.settings.speedDisplay'),
  options: SPEED_DISPLAYS.map(display => ({
    key: display,
    label: t(`guidance.speed.displaysShort.${display}`),
    active: guidance.preferences.speedDisplay === display,
    pick: () => (guidance.preferences.speedDisplay = display),
  })),
}] : [])

const choices = computed(() => [
  ...freeModeChoice.value,
  {
    key: 'camera',
    title: t('guidance.settings.cameraMode'),
    options: CAMERA_MODES.map(mode => ({
      key: mode,
      label: t(`guidance.camera.modes.${mode}`),
      active: guidance.preferences.cameraMode === mode,
      pick: () => {
        guidance.preferences.cameraMode = mode
        camera.follow()
      },
    })),
  },
  {
    key: 'bearing',
    title: t('guidance.settings.bearingMode'),
    options: (['look-ahead', 'straight'] as const).map(bearing => ({
      key: bearing,
      label: t(`guidance.camera.bearing.${bearing}`),
      active: guidance.preferences.bearingMode === bearing,
      pick: () => (guidance.preferences.bearingMode = bearing),
    })),
  },
  {
    key: 'sound',
    title: t('guidance.sound.title'),
    options: SOUND_MODES.map(mode => ({
      key: mode,
      label: t(`guidance.sound.${mode}`),
      active: sound.value === mode,
      pick: () => setSound(mode),
    })),
  },
  ...speedChoice.value,
])
</script>

<template>
  <div class="space-y-6">
    <LiveTransitTimeline
      v-if="hasTransit"
      :segments="guidance.segments"
      :current="currentSegment"
      :stage="guidance.transit"
    />

    <div class="grid gap-1" :class="actions.length === 5 ? 'grid-cols-5' : 'grid-cols-3'">
      <button
        v-for="action in actions"
        :key="action.key"
        class="flex flex-col items-center gap-1.5 rounded-2xl px-1 py-2 text-center text-xs font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        :disabled="!action.enabled"
        @click="action.open()"
      >
        <span class="flex size-12 items-center justify-center rounded-full bg-muted">
          <component :is="action.icon" class="size-5" />
        </span>
        <span class="leading-tight">{{ t(`guidance.menu.${action.key}`) }}</span>
      </button>
    </div>

    <section v-for="choice in choices" :key="choice.key">
      <div class="mb-2 text-sm text-muted-foreground">{{ choice.title }}</div>
      <div class="flex gap-1 rounded-full bg-muted p-1">
        <button
          v-for="option in choice.options"
          :key="option.key"
          class="min-h-10 flex-1 rounded-full px-2 text-sm transition-colors"
          :class="option.active ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          :aria-pressed="option.active"
          @click="option.pick()"
        >
          {{ option.label }}
        </button>
      </div>
    </section>

    <section>
      <div class="mb-2 text-sm text-muted-foreground">{{ t('guidance.vehicle.title') }}</div>
      <VehiclePicker :mode="puckMode(travelMode)" />
    </section>
  </div>
</template>
