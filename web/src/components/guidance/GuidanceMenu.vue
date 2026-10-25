<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FlagIcon, MegaphoneIcon, PlusIcon, RouteIcon, SearchIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import ManeuverIcon from '@/components/directions/ManeuverIcon.vue'
import { maneuverKind } from '@/lib/directions/maneuver'
import { bannerDistance } from '@/lib/guidance/guidance-display'
import { CAMERA_MODES } from '@/lib/guidance/camera-framing'
import { SOUND_MODES, useGuidanceStore } from '@/stores/guidance.store'
import { travelModeAt } from '@/lib/guidance/guidance-display'
import type { useGuidanceCamera } from '@/composables/guidance/useGuidanceCamera'

const props = defineProps<{ camera: ReturnType<typeof useGuidanceCamera>; metric: boolean }>()
defineEmits<{ exit: [] }>()
const { t } = useI18n()
const guidance = useGuidanceStore()

const upcoming = computed(() => {
  const route = guidance.route
  const s = guidance.progress?.puck.s ?? 0
  if (!route) return []
  return route.steps
    .filter(step => step.startDistance > s)
    .map(step => ({ step, distance: bannerDistance(step.startDistance - s, props.metric) }))
})

// Wired up as their steps land; shown now so the menu's shape is settled.
const travelMode = computed(() =>
  guidance.route ? travelModeAt(guidance.route, guidance.progress?.puck.s ?? 0) : 'driving',
)

function setSound(mode: (typeof SOUND_MODES)[number]) {
  guidance.preferences.sound = { ...guidance.preferences.sound, [travelMode.value]: mode }
}

const COMING = [
  { key: 'searchAlongRoute', icon: SearchIcon },
  { key: 'addStop', icon: PlusIcon },
  { key: 'report', icon: MegaphoneIcon },
]
</script>

<template>
  <div class="mt-4 space-y-5">
    <section>
      <h3 class="mb-2 text-sm font-medium text-muted-foreground">{{ t('guidance.settings.cameraMode') }}</h3>
      <div class="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        <button
          v-for="mode in CAMERA_MODES"
          :key="mode"
          class="rounded-md py-1.5 text-sm transition-colors"
          :class="guidance.preferences.cameraMode === mode ? 'bg-background shadow-sm' : 'text-muted-foreground'"
          @click="guidance.preferences.cameraMode = mode; camera.follow()"
        >
          {{ t(`guidance.camera.modes.${mode}`) }}
        </button>
      </div>
      <div class="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        <button
          v-for="bearing in (['look-ahead', 'straight'] as const)"
          :key="bearing"
          class="rounded-md py-1.5 text-sm transition-colors"
          :class="guidance.preferences.bearingMode === bearing ? 'bg-background shadow-sm' : 'text-muted-foreground'"
          @click="guidance.preferences.bearingMode = bearing"
        >
          {{ t(`guidance.camera.bearing.${bearing}`) }}
        </button>
      </div>
    </section>

    <section>
      <h3 class="mb-2 text-sm font-medium text-muted-foreground">{{ t('guidance.sound.title') }}</h3>
      <div class="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        <button
          v-for="mode in SOUND_MODES"
          :key="mode"
          class="rounded-md py-1.5 text-sm transition-colors"
          :class="guidance.soundModeAt(guidance.progress?.puck.s ?? 0) === mode ? 'bg-background shadow-sm' : 'text-muted-foreground'"
          @click="setSound(mode)"
        >
          {{ t(`guidance.sound.${mode}`) }}
        </button>
      </div>
    </section>

    <section class="grid grid-cols-2 gap-2">
      <Button variant="secondary" class="justify-start" @click="camera.overview()">
        <RouteIcon class="size-4" />
        {{ t('guidance.camera.overview') }}
      </Button>
      <Button v-for="item in COMING" :key="item.key" variant="secondary" class="justify-start" disabled>
        <component :is="item.icon" class="size-4" />
        {{ t(`guidance.menu.${item.key}`) }}
      </Button>
    </section>

    <section v-if="upcoming.length">
      <h3 class="mb-1 text-sm font-medium text-muted-foreground">{{ t('guidance.menu.steps') }}</h3>
      <ol class="divide-y">
        <li v-for="{ step, distance } in upcoming" :key="step.index" class="flex items-center gap-3 py-2.5">
          <ManeuverIcon :kind="maneuverKind(step.instruction)" :exit="step.instruction.exitNumber" class="size-5 shrink-0" />
          <span class="min-w-0 flex-1 truncate text-sm">{{ step.instruction.text }}</span>
          <span class="shrink-0 text-sm text-muted-foreground tabular-nums">
            {{ distance.value }} {{ t(`guidance.units.${distance.unit}`) }}
          </span>
        </li>
      </ol>
    </section>

    <Button variant="secondary" class="w-full text-red-600 dark:text-red-400" @click="$emit('exit')">
      <FlagIcon class="size-4" />
      {{ t('guidance.exit') }}
    </Button>
  </div>
</template>
