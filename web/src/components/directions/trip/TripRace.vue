<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FootprintsIcon } from 'lucide-vue-next'
import { getSegmentIcon } from '@/lib/directions/travel-mode-icons'
import type { Race } from '@/lib/directions/trip-advice'

/** The walk to the first stop against the train's countdown, drawn to one scale. */
const props = defineProps<{
  race: Race
  nowMs: number
  /** Text tone of the advice; the walk bar takes its colour. */
  tone: string
  ride?: { routeType?: string; lineColor?: string; lineName?: string }
}>()

const { t } = useI18n()

const leadMs = computed(() => Math.max(0, props.race.departAtMs - props.nowMs))
const scale = computed(() => Math.max(props.race.walkMs, leadMs.value, 1))
const width = (ms: number) => `${(ms / scale.value) * 100}%`

const minutes = (ms: number, round: (n: number) => number) => {
  const n = round(ms / 60_000)
  return n < 1 ? '<1' : String(n)
}
const walk = computed(() => minutes(props.race.walkMs, Math.round))
const train = computed(() => minutes(leadMs.value, Math.floor))

const rideIcon = computed(() => getSegmentIcon('transit', props.ride?.routeType))
const rideColor = computed(() => (props.ride?.lineColor ? `#${props.ride.lineColor}` : 'currentColor'))
const label = computed(() =>
  t('directions.advice.race', { walk: walk.value, train: train.value, line: props.ride?.lineName ?? '' }),
)
</script>

<template>
  <div
    role="img"
    :aria-label="label"
    class="mt-2 grid w-52 grid-cols-[auto_1fr_2.75rem] items-center gap-x-2 gap-y-1.5 text-xs tabular-nums text-muted-foreground"
  >
    <FootprintsIcon class="size-3.5" />
    <div class="h-1 rounded-full bg-muted">
      <div class="h-full rounded-full bg-current transition-[width] duration-700" :class="tone" :style="{ width: width(race.walkMs) }" />
    </div>
    <span class="text-right">{{ walk }} min</span>

    <component :is="rideIcon" class="size-3.5" :style="{ color: rideColor }" />
    <div class="h-1 rounded-full bg-muted">
      <div class="h-full rounded-full transition-[width] duration-700" :style="{ width: width(leadMs), background: rideColor }" />
    </div>
    <span class="text-right">{{ train }} min</span>
  </div>
</template>
