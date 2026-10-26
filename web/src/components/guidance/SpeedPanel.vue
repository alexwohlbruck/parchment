<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { postedLimit } from '@/lib/guidance/guidance-display'
import { modeProfile } from '@/lib/guidance/mode-profiles'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useGuidanceContext } from './context'

defineProps<{ dash?: boolean }>()
const { t } = useI18n()
const guidance = useGuidanceStore()
const { metric } = useGuidanceContext()

const profile = computed(() => modeProfile(guidance.travelMode))
const current = computed(() => {
  const speed = guidance.progress?.puck.speed ?? 0
  return Math.round(metric.value ? speed * 3.6 : speed * 2.236936)
})
const limit = computed(() => {
  const kmh = guidance.progress?.speedLimitKmh
  return kmh && profile.value.speedLimit ? postedLimit(kmh, metric.value) : null
})
const speeding = computed(() => limit.value != null && current.value > limit.value * 1.1)
</script>

<template>
  <div v-if="profile.speedometer && guidance.progress" class="pointer-events-auto flex items-end gap-2">
    <!-- US / mph regions post a rectangular sign; metric regions a red ring. -->
    <div
      v-if="limit != null && !metric"
      class="flex flex-col items-center rounded-lg border-2 border-zinc-900 bg-white px-1 py-1 text-zinc-900 shadow-lg"
      :class="dash ? 'w-16' : 'w-13'"
    >
      <span class="text-[7px] font-semibold leading-tight">{{ t('guidance.speed.limitSign') }}</span>
      <span class="font-display leading-none tabular-nums" :class="dash ? 'text-3xl' : 'text-2xl'">{{ limit }}</span>
    </div>
    <div
      v-else-if="limit != null"
      class="flex items-center justify-center rounded-full border-[5px] border-red-600 bg-white font-display text-zinc-900 shadow-lg tabular-nums"
      :class="dash ? 'size-16 text-2xl' : 'size-13 text-xl'"
    >
      {{ limit }}
    </div>
    <div
      class="nav-surface flex flex-col items-center justify-center rounded-full bg-background shadow-lg ring-1 ring-foreground/5"
      :class="[dash ? 'size-16' : 'size-13', speeding ? 'text-red-600 dark:text-red-400' : 'text-foreground']"
    >
      <span class="font-display leading-none tabular-nums" :class="dash ? 'text-2xl' : 'text-xl'">{{ current }}</span>
      <span class="text-[10px] text-muted-foreground">{{ metric ? 'km/h' : 'mph' }}</span>
    </div>
  </div>
</template>
