<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { guideView, type StationGuideState, type StationGuideTarget } from '@/lib/guidance/station-guide'
import { stationStepIcon } from '@/lib/transit/station/step-icons'
import { formatDurationShort } from '@/lib/time-format'

const props = defineProps<{ target: StationGuideTarget; state: StationGuideState; nowMs: number }>()
defineEmits<{ next: [] }>()
const { t } = useI18n()

const view = computed(() => guideView(props.state, props.target, props.nowMs))

const detail = computed(() => {
  const { levelChange, landmark, instruction } = view.value.step
  const n = Math.abs(levelChange ?? 0)
  const levels = !n ? null : (levelChange ?? 0) > 0 ? t('directions.station.levelUp', { n }, n) : t('directions.station.levelDown', { n }, n)
  return [levels, landmark && !instruction.includes(landmark) ? landmark : null].filter(Boolean).join(' · ')
})

const last = computed(() => view.value.next == null)
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="text-xs text-muted-foreground tabular-nums">
      {{ t('guidance.transit.station.stepOf', { n: view.index + 1, total: view.total }) }} · {{ t('guidance.transit.station.noGps') }}
    </div>
    <div class="flex items-start gap-3">
      <component :is="stationStepIcon(view.step)" class="mt-1 size-6 shrink-0" />
      <div class="min-w-0">
        <div class="text-xl font-semibold leading-snug">{{ view.step.instruction }}</div>
        <div v-if="detail" class="mt-0.5 text-sm text-muted-foreground">{{ detail }}</div>
      </div>
    </div>
    <div class="flex items-center justify-between gap-3">
      <span class="min-w-0 truncate text-sm text-muted-foreground tabular-nums">
        <template v-if="view.advancesInMs != null">
          {{ t('guidance.transit.station.advancesIn', { duration: formatDurationShort(view.advancesInMs / 1000) }) }}
        </template>
      </span>
      <Button variant="secondary" class="h-11 shrink-0 rounded-full px-5" @click="$emit('next')">
        {{ last ? t('guidance.transit.station.done') : t('guidance.transit.station.next') }}
      </Button>
    </div>
  </div>
</template>
