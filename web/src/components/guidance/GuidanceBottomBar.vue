<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { formatDurationParts } from '@/lib/time-format'
import { formatClock } from '@/lib/directions/trip-display'
import { bannerDistance } from '@/lib/guidance/guidance-display'
import type { GuidanceProgress } from '@/stores/guidance.store'

const props = defineProps<{ progress: GuidanceProgress | null; metric: boolean }>()
defineEmits<{ exit: [] }>()
const { t } = useI18n()

const duration = computed(() => formatDurationParts(props.progress?.remainingSeconds ?? 0).parts)
const arrival = computed(() =>
  props.progress ? formatClock(new Date(Date.now() + props.progress.remainingSeconds * 1000)) : '',
)
const distance = computed(() => bannerDistance(props.progress?.remainingMeters ?? 0, props.metric))
</script>

<template>
  <div class="flex items-center gap-3">
    <div class="min-w-0 flex-1">
      <template v-if="progress">
        <div class="flex items-baseline gap-1 font-display leading-none text-emerald-600 dark:text-emerald-400">
          <template v-for="part in duration" :key="part.unit">
            <span class="text-[30px] tabular-nums">{{ part.value }}</span>
            <span class="mr-1 text-lg">{{ part.unit }}</span>
          </template>
        </div>
        <div class="mt-1 text-sm text-muted-foreground tabular-nums">
          {{ distance.value }} {{ t(`guidance.units.${distance.unit}`) }} · {{ arrival }}
        </div>
      </template>
      <div v-else class="text-muted-foreground">{{ t('guidance.waitingForLocation') }}</div>
    </div>
    <Button
      variant="secondary"
      class="h-11 rounded-full px-5 text-red-600 dark:text-red-400"
      @click="$emit('exit')"
    >
      {{ t('guidance.exitShort') }}
    </Button>
  </div>
</template>
