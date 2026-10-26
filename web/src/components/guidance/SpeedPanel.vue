<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { postedLimit } from '@/lib/guidance/guidance-display'
import { modeProfile } from '@/lib/guidance/mode-profiles'
import { displaySpeed, showsLimit, showsSpeedometer, speeding } from '@/lib/guidance/speed-display'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useGuidanceContext } from './context'

defineProps<{ dash?: boolean }>()
const { t } = useI18n()
const guidance = useGuidanceStore()
const { metric } = useGuidanceContext()

const profile = computed(() => modeProfile(guidance.travelMode))
const current = computed(() => displaySpeed(guidance.progress?.puck.speed ?? 0, metric.value))
const limit = computed(() => {
  const kmh = guidance.progress?.speedLimitKmh
  const shown = profile.value.speedLimit && showsLimit(guidance.preferences.speedDisplay)
  return kmh && shown ? postedLimit(kmh, metric.value) : null
})
const speedometer = computed(() => profile.value.speedometer && showsSpeedometer(guidance.preferences.speedDisplay))
const level = computed(() => speeding(current.value, limit.value))
</script>

<template>
  <div
    v-if="guidance.progress && (limit != null || speedometer)"
    class="nav-surface pointer-events-auto flex flex-col gap-1.5 rounded-[20px] bg-background/95 p-1.5 shadow-xl ring-1 ring-foreground/5 backdrop-blur-md"
    :class="dash ? 'w-20' : 'w-16'"
  >
    <!-- US / mph regions post a rectangular sign; metric regions a red ring. -->
    <div
      v-if="limit != null && !metric"
      class="flex flex-col items-center justify-center gap-1 rounded-[14px] border-2 border-zinc-900 bg-white text-zinc-900 dark:border-zinc-100 dark:bg-zinc-900 dark:text-zinc-100"
      :class="dash ? 'h-[76px]' : 'h-[60px]'"
    >
      <span class="font-bold leading-none" :class="dash ? 'text-[11px]' : 'text-[9px]'">{{ t('guidance.speed.limitSign') }}</span>
      <span class="font-bold leading-none tabular-nums" :class="dash ? 'text-[32px]' : 'text-[26px]'">{{ limit }}</span>
    </div>
    <div
      v-else-if="limit != null"
      class="flex aspect-square items-center justify-center rounded-full border-[5px] border-red-600 bg-white font-bold leading-none text-zinc-900 tabular-nums dark:border-red-500 dark:bg-zinc-900 dark:text-zinc-100"
      :class="dash ? 'text-[28px]' : 'text-[22px]'"
    >
      {{ limit }}
    </div>
    <div
      v-if="speedometer"
      class="flex flex-col items-center justify-center gap-1 rounded-[14px] transition-colors"
      :class="[
        dash ? 'h-[76px]' : 'h-[60px]',
        {
          'text-amber-600 dark:text-amber-400': level === 'over',
          'bg-coral-600 text-white': level === 'far-over',
        },
      ]"
    >
      <span class="font-bold leading-none tabular-nums" :class="dash ? 'text-[32px]' : 'text-[26px]'">{{ current }}</span>
      <span class="leading-none" :class="[dash ? 'text-[11px]' : 'text-[10px]', level === 'far-over' ? 'text-white/80' : 'text-muted-foreground']">
        {{ metric ? 'km/h' : 'mph' }}
      </span>
    </div>
  </div>
</template>
