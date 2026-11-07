<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { guideView, type StationGuideState, type StationGuideTarget } from '@/lib/guidance/station-guide'
import { stationStepIcon } from '@/lib/transit/station/step-icons'
import { stationStepText } from '@/lib/transit/station/station-walks'
import { formatDurationShort } from '@/lib/time-format'

const props = defineProps<{ target: StationGuideTarget; state: StationGuideState; nowMs: number }>()
defineEmits<{ next: [] }>()
const { t } = useI18n()

const view = computed(() => guideView(props.state, props.target, props.nowMs))
const text = computed(() => stationStepText(props.target.walk.steps, view.value.index, props.target.spot, t))

const detail = computed(() => {
  const { levelChange, landmark, instruction } = view.value.step
  const n = Math.abs(levelChange ?? 0)
  const levels = !n ? null : (levelChange ?? 0) > 0 ? t('directions.station.levelUp', { n }, n) : t('directions.station.levelDown', { n }, n)
  return [levels, landmark && !instruction.includes(landmark) ? landmark : null].filter(Boolean).join(' · ')
})

const meta = computed(() =>
  [
    detail.value,
    t('guidance.transit.station.stepOf', { n: view.value.index + 1, total: view.value.total }),
    view.value.advancesInMs != null
      ? t('guidance.transit.station.advancesIn', { duration: formatDurationShort(view.value.advancesInMs / 1000) })
      : null,
  ]
    .filter(Boolean)
    .join(' · '),
)

const last = computed(() => view.value.next == null)
</script>

<template>
  <div class="flex items-center gap-3">
    <component :is="stationStepIcon(view.step)" class="size-6 shrink-0 self-start mt-0.5" />
    <div class="min-w-0 flex-1">
      <div class="text-lg font-semibold leading-snug">{{ text }}</div>
      <div class="mt-0.5 truncate text-sm text-muted-foreground tabular-nums">{{ meta }}</div>
    </div>
    <Button variant="secondary" class="h-9 shrink-0 rounded-full px-4" @click="$emit('next')">
      {{ last ? t('guidance.transit.station.done') : t('guidance.transit.station.next') }}
    </Button>
  </div>
</template>
