<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ListIcon, MegaphoneIcon, PlusIcon, SearchIcon, SplitIcon } from 'lucide-vue-next'
import { CAMERA_MODES } from '@/lib/guidance/camera-framing'
import { segmentAt } from '@/lib/guidance/nav-route'
import { travelModeAt } from '@/lib/guidance/guidance-display'
import { canSearchAhead } from '@/services/guidance/route-search.service'
import { canReroute } from '@/services/guidance/reroute.service'
import { SOUND_MODES, useGuidanceStore } from '@/stores/guidance.store'
import LiveTransitTimeline from '../transit/LiveTransitTimeline.vue'
import { useGuidanceContext } from '../context'

const { t } = useI18n()
const guidance = useGuidanceStore()
const { camera, openPanel } = useGuidanceContext()

const s = computed(() => guidance.progress?.puck.s ?? 0)
const travelMode = computed(() => (guidance.route ? travelModeAt(guidance.route, s.value) : 'driving'))
const hasTransit = computed(() => guidance.segments.some(segment => segment.mode === 'transit'))
const currentSegment = computed(() => (guidance.route ? segmentAt(guidance.route, s.value)?.index ?? 0 : 0))

const actions = computed(() => [
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

const choices = computed(() => [
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

    <div class="grid grid-cols-5 gap-1">
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
  </div>
</template>
