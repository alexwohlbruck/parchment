<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { postedLimit } from '@/lib/guidance/guidance-display'

const props = defineProps<{
  /** m/s */
  speed: number
  limitKmh: number | null
  metric: boolean
  showLimit: boolean
}>()
const { t } = useI18n()

const current = computed(() => Math.round(props.metric ? props.speed * 3.6 : props.speed * 2.236936))
const limit = computed(() => (props.limitKmh && props.showLimit ? postedLimit(props.limitKmh, props.metric) : null))
const speeding = computed(() => limit.value != null && current.value > limit.value * 1.1)
</script>

<template>
  <div class="pointer-events-auto flex items-end gap-1.5">
    <!-- US / mph regions post a rectangular sign; metric regions a red ring. -->
    <div
      v-if="limit != null && !metric"
      class="flex w-12 flex-col items-center rounded-md border-2 border-zinc-900 bg-white px-1 py-0.5 text-zinc-900 shadow-md"
    >
      <span class="text-[7px] font-semibold leading-tight">{{ t('guidance.speed.limitSign') }}</span>
      <span class="font-display text-xl leading-none tabular-nums">{{ limit }}</span>
    </div>
    <div
      v-else-if="limit != null"
      class="flex size-12 items-center justify-center rounded-full border-[5px] border-red-600 bg-white font-display text-lg text-zinc-900 shadow-md tabular-nums"
    >
      {{ limit }}
    </div>
    <div
      class="flex size-12 flex-col items-center justify-center rounded-full bg-background shadow-md"
      :class="speeding ? 'text-red-600' : 'text-foreground'"
    >
      <span class="font-display text-lg leading-none tabular-nums">{{ current }}</span>
      <span class="text-[9px] text-muted-foreground">{{ metric ? 'km/h' : 'mph' }}</span>
    </div>
  </div>
</template>
