<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { StationGuideTarget } from '@/lib/guidance/station-guide'
import { progressView, type StationProgress } from '@/lib/guidance/station-progress'
import { bannerDistance } from '@/lib/guidance/guidance-display'
import { signedLevelNames } from '@/lib/indoor/indoor-venue'
import { stationStepIcon } from '@/lib/transit/station/step-icons'
import { stationStepText, stepLevelLabel } from '@/lib/transit/station/station-walks'
import { formatDurationShort } from '@/lib/time-format'
import { useMapStore } from '@/stores/map.store'

const props = defineProps<{ target: StationGuideTarget; state: StationProgress; nowMs: number; metric: boolean }>()
defineEmits<{ next: [] }>()
const { t } = useI18n()
const mapStore = useMapStore()

const view = computed(() => progressView(props.state, props.target, props.nowMs))
const text = computed(() => stationStepText(props.target.walk.steps, view.value.index, props.target.spot, t))

const levelNames = computed(() => (mapStore.indoorFocus ? signedLevelNames(mapStore.indoorFocus.venue) : new Map<number, string>()))
const level = computed(() => stepLevelLabel(view.value.step, levelNames.value, t))

const landmark = computed(() => {
  const { landmark, instruction } = view.value.step
  return landmark && !instruction.includes(landmark) ? landmark : null
})

const pace = computed(() => {
  const { metresLeft, advancesInMs } = view.value
  if (metresLeft != null) {
    const { value, unit } = bannerDistance(metresLeft, props.metric)
    return t('guidance.transit.station.left', { distance: `${value} ${unit}` })
  }
  return advancesInMs != null ? t('guidance.transit.station.advancesIn', { duration: formatDurationShort(advancesInMs / 1000) }) : null
})

const meta = computed(() =>
  [landmark.value, t('guidance.transit.station.stepOf', { n: view.value.index + 1, total: view.value.total }), pace.value]
    .filter(Boolean)
    .join(' · '),
)

const last = computed(() => view.value.next == null)
</script>

<template>
  <div class="flex items-center gap-3">
    <component :is="stationStepIcon(view.step)" class="size-6 shrink-0 self-start mt-0.5" />
    <div class="min-w-0 flex-1">
      <Badge v-if="level" variant="secondary" class="mb-1 font-medium">{{ level }}</Badge>
      <div class="text-lg font-semibold leading-snug">{{ text }}</div>
      <div class="mt-0.5 truncate text-sm text-muted-foreground tabular-nums">{{ meta }}</div>
    </div>
    <Button variant="secondary" class="h-9 shrink-0 rounded-full px-4" @click="$emit('next')">
      {{ last ? t('guidance.transit.station.done') : t('guidance.transit.station.next') }}
    </Button>
  </div>
</template>
