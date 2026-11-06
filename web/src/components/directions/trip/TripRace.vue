<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FootprintsIcon } from 'lucide-vue-next'
import { getSegmentIcon } from '@/lib/directions/travel-mode-icons'
import { raceZones, type Race, type RaceZoneKind } from '@/lib/directions/trip-advice'

/** The walk to the first stop on one bar, with the train's departure marked where it falls. */
const props = defineProps<{
  race: Race
  nowMs: number
  ride?: { routeType?: string; lineColor?: string; lineName?: string }
}>()

const { t } = useI18n()

const leadMs = computed(() => Math.max(0, props.race.departAtMs - props.nowMs))
const scale = computed(() => Math.max(props.race.walkMs, leadMs.value, 1))
const share = (ms: number) => Math.min(100, (ms / scale.value) * 100)

/** Below this share of the bar the gap's label would crowd the walk's; the badges above still say it. */
const GAP_LABEL_MIN_SHARE = 30

const ZONE_COLORS: Record<RaceZoneKind, string> = {
  calm: 'bg-forest-500',
  leave: 'bg-yellow-400',
  hurry: 'bg-amber-400',
  run: 'bg-orange-600',
  tooFar: 'bg-red-600',
}
const zones = computed(() =>
  raceZones(props.race, leadMs.value).map(z => ({
    kind: z.kind,
    color: ZONE_COLORS[z.kind],
    style: { left: `${share(z.fromMs)}%`, width: `${share(z.toMs) - share(z.fromMs)}%` },
  })),
)
const walkClip = computed(() => ({ clipPath: `inset(0 ${100 - share(props.race.walkMs)}% 0 0 round 9999px)` }))
/** Pins a label to a point on the bar, sliding it inward so it never leaves the bar's span. */
const at = (ms: number) => ({ left: `${share(ms)}%`, transform: `translateX(-${share(ms)}%)` })

const minutes = (ms: number, round: (n: number) => number) => {
  const n = round(ms / 60_000)
  return n < 1 ? '<1' : String(n)
}
const walk = computed(() => minutes(props.race.walkMs, Math.round))

/** Between reaching the stop and the doors closing: slack when early, the shortfall when late. */
const gap = computed(() => {
  const from = Math.min(props.race.walkMs, leadMs.value)
  const to = Math.max(props.race.walkMs, leadMs.value)
  const spareMs = leadMs.value - props.race.walkMs
  const n = Math.floor(Math.abs(spareMs) / 60_000)
  const text =
    spareMs < 0
      ? t('directions.advice.badge.short', { minutes: Math.max(1, Math.ceil(-spareMs / 60_000)) })
      : n < 1
        ? t('directions.advice.badge.spareNone')
        : t('directions.advice.badge.spare', { minutes: n })
  return {
    late: spareMs < 0,
    text,
    style: { left: `${share(from)}%`, width: `${share(to) - share(from)}%` },
    label: at((from + to) / 2),
    roomy: share(to) - share(from) >= GAP_LABEL_MIN_SHARE,
  }
})
const train = computed(() => minutes(leadMs.value, Math.floor))

const rideIcon = computed(() => getSegmentIcon('transit', props.ride?.routeType))
const rideColor = computed(() => (props.ride?.lineColor ? `#${props.ride.lineColor}` : 'currentColor'))
const label = computed(() =>
  t('directions.advice.race', { walk: walk.value, train: train.value, line: props.ride?.lineName ?? '' }),
)
</script>

<template>
  <div role="img" :aria-label="label" class="mt-2 w-52 text-xs tabular-nums text-muted-foreground">
    <div class="relative h-4">
      <span class="absolute inline-flex items-center gap-1 whitespace-nowrap" :style="at(leadMs)">
        <component :is="rideIcon" class="size-3.5" :style="{ color: rideColor }" />{{ train }} min
      </span>
    </div>
    <div class="relative my-1.5 h-1.5">
      <div class="absolute inset-0 overflow-hidden rounded-full opacity-25">
        <div v-for="zone in zones" :key="zone.kind" class="absolute inset-y-0" :class="zone.color" :style="zone.style" />
      </div>
      <div class="absolute inset-0 overflow-hidden rounded-full transition-[clip-path] duration-700" :style="walkClip">
        <div v-for="zone in zones" :key="zone.kind" class="absolute inset-y-0" :class="zone.color" :style="zone.style" />
      </div>
      <div
        v-if="!gap.late"
        class="absolute inset-y-0 text-foreground/40 transition-all duration-700"
        :style="{ ...gap.style, backgroundImage: 'repeating-linear-gradient(135deg, currentColor 0 1.5px, transparent 1.5px 4px)' }"
      />
      <div
        class="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full transition-[left] duration-700"
        :style="{ left: `${share(leadMs)}%`, background: rideColor }"
      />
    </div>
    <div class="relative h-4">
      <span class="absolute inline-flex items-center gap-1 whitespace-nowrap" :style="at(gap.roomy ? Math.min(race.walkMs, leadMs) / 2 : race.walkMs)">
        <FootprintsIcon class="size-3.5" />{{ walk }} min
      </span>
      <span
        v-if="gap.roomy"
        class="absolute whitespace-nowrap"
        :class="gap.late ? 'text-orange-600 dark:text-orange-400' : 'text-foreground/70'"
        :style="gap.label"
      >
        {{ gap.text }}
      </span>
    </div>
  </div>
</template>
