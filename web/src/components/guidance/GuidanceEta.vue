<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { formatDurationLong } from '@/lib/time-format'
import { formatClock } from '@/lib/directions/trip-display'
import { bannerDistance } from '@/lib/guidance/guidance-display'
import type { GuidanceProgress } from '@/stores/guidance.store'

const props = defineProps<{ progress: GuidanceProgress | null; metric: boolean; dash?: boolean }>()
defineEmits<{ exit: [] }>()
const { t } = useI18n()

const duration = computed(() => formatDurationLong(props.progress?.remainingSeconds ?? 0))
const arrival = computed(() =>
  props.progress ? formatClock(new Date(Date.now() + props.progress.remainingSeconds * 1000)) : '',
)
const distance = computed(() => bannerDistance(props.progress?.remainingMeters ?? 0, props.metric))
</script>

<template>
  <div class="flex items-center gap-3">
    <div class="min-w-0 flex-1">
      <template v-if="progress">
        <div
          class="font-display-heavy leading-none text-forest-600 tabular-nums dark:text-forest-400"
          :class="dash ? 'text-[40px]' : 'text-[34px]'"
        >
          {{ arrival }}
        </div>
        <div class="mt-1.5 text-muted-foreground tabular-nums" :class="dash ? 'text-lg' : 'text-[15px]'">
          {{ duration }} · {{ distance.value }} {{ t(`guidance.units.${distance.unit}`) }}
        </div>
      </template>
      <div v-else class="text-muted-foreground">{{ t('guidance.waitingForLocation') }}</div>
    </div>
    <Button
      variant="destructive"
      class="shrink-0 rounded-full"
      :class="dash ? 'h-14 px-7 text-lg' : 'h-12 px-6 text-base'"
      :aria-label="t('guidance.exit')"
      @click="$emit('exit')"
    >
      {{ t('guidance.exitShort') }}
    </Button>
  </div>
</template>
