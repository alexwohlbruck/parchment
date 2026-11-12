<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import RouteBullet from '@/components/transit/bullets/RouteBullet.vue'
import { raceZones, type Race, type RaceZoneKind } from '@/lib/directions/trip-advice'

/** A tug of war between your walk and the train's departure: the knot is where you reach the stop. */
const props = defineProps<{
  race: Race
  nowMs: number
  ride?: { lineColor?: string; lineTextColor?: string; lineName?: string; departureStop?: { name?: string } }
}>()

const { t } = useI18n()

const leadMs = computed(() => Math.max(0, props.race.departAtMs - props.nowMs))
const scale = computed(() => Math.max(props.race.walkMs, leadMs.value, 1))
const share = (ms: number) => Math.min(100, (ms / scale.value) * 100)
const pct = (ms: number) => `${share(ms)}%`

const WALK_COLORS: Record<RaceZoneKind, { bar: string; hatch: string }> = {
  calm: { bar: 'bg-forest-600', hatch: 'text-forest-600' },
  leave: { bar: 'bg-forest-600', hatch: 'text-forest-600' },
  hurry: { bar: 'bg-amber-500', hatch: 'text-amber-500' },
  run: { bar: 'bg-orange-600', hatch: 'text-orange-600' },
  tooFar: { bar: 'bg-red-600', hatch: 'text-red-600' },
}
/** How the walk ends: the zone the rider reaches the stop in. */
const walkColor = computed(() => {
  const zone = raceZones(props.race, leadMs.value).find(z => props.race.walkMs <= z.toMs)
  return WALK_COLORS[zone?.kind ?? 'tooFar']
})

const lineColor = computed(() => (props.ride?.lineColor ? `#${props.ride.lineColor}` : 'hsl(var(--primary))'))

const minutes = (ms: number, round: (n: number) => number) => Math.max(0, round(ms / 60_000))
const walkMin = computed(() => minutes(props.race.walkMs, Math.round))
const trainMin = computed(() => minutes(leadMs.value, Math.floor))

const late = computed(() => props.race.walkMs > leadMs.value)
/** Where the rope is lost: the slack you keep, or the shortfall past the train's departure. */
const gap = computed(() => {
  const from = Math.min(props.race.walkMs, leadMs.value)
  const to = Math.max(props.race.walkMs, leadMs.value)
  const off = Math.abs(leadMs.value - props.race.walkMs) / 60_000
  const text = late.value
    ? t('directions.advice.status.short', { minutes: Math.max(1, Math.ceil(off)) })
    : off < 1
      ? t('directions.advice.status.spareNone')
      : t('directions.advice.status.spare', { minutes: Math.floor(off) })
  const mid = (share(from) + share(to)) / 2
  return {
    text,
    span: { left: pct(from), width: `${share(to) - share(from)}%` },
    label: { left: `${mid}%`, transform: `translateX(-${mid}%)` },
  }
})

const hatch = 'repeating-linear-gradient(135deg, currentColor 0 1.5px, transparent 1.5px 4.5px)'

const label = computed(() =>
  t('directions.advice.race.label', { walk: walkMin.value, train: trainMin.value, line: props.ride?.lineName ?? '' }),
)
</script>

<template>
  <div role="img" :aria-label="label" class="mt-3 max-w-80 text-xs tabular-nums text-muted-foreground">
    <div v-if="ride?.departureStop?.name" class="mb-1 ml-8 truncate">
      {{ t('directions.advice.race.to') }} <span class="font-medium text-foreground">{{ ride.departureStop.name }}</span>
    </div>

    <div class="grid grid-cols-[22px_1fr_auto] items-center gap-x-2.5 gap-y-1">
      <!-- The gap the knot leaves, above the side that holds it -->
      <span />
      <div class="relative h-4">
        <span
          class="absolute whitespace-nowrap font-semibold transition-all duration-700"
          :class="late ? 'text-orange-600 dark:text-orange-400' : 'text-forest-700 dark:text-forest-400'"
          :style="gap.label"
        >
          {{ gap.text }}
        </span>
      </div>
      <span />

      <!-- You pull from the left, the train holds the right; the knot is where you reach the stop -->
      <span class="grid size-[22px] place-items-center">
        <span class="size-3.5 rounded-full border-2 border-white bg-primary shadow-sm ring-[3px] ring-primary/25" />
      </span>
      <div class="relative h-[22px]">
        <div
          class="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-l-full transition-all duration-700"
          :class="walkColor.bar"
          :style="{ width: pct(Math.min(race.walkMs, leadMs)) }"
        />
        <div
          v-if="late"
          class="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-r-full transition-all duration-700"
          :class="walkColor.hatch"
          :style="{ ...gap.span, backgroundImage: hatch }"
        />
        <div
          v-else
          class="absolute top-1/2 h-1 -translate-y-1/2 rounded-r-full opacity-60 transition-all duration-700"
          :style="{ ...gap.span, background: lineColor }"
        />
        <div
          v-if="late"
          class="absolute top-1/2 h-4 -translate-x-1/2 -translate-y-1/2 border-l-2 border-dashed transition-[left] duration-700"
          :style="{ left: pct(leadMs), borderColor: lineColor }"
        />
        <div
          class="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background shadow-sm transition-[left] duration-700"
          :class="walkColor.bar"
          :style="{ left: pct(race.walkMs) }"
        />
      </div>
      <RouteBullet
        v-if="ride?.lineName"
        :label="ride.lineName"
        :color="ride.lineColor"
        :text-color="ride.lineTextColor"
        class="justify-self-center"
      />
      <span v-else class="size-3 justify-self-center rounded-full" :style="{ background: lineColor }" />

      <span />
      <div class="flex justify-between gap-3 whitespace-nowrap">
        <span>{{ t('directions.advice.race.walk', { minutes: walkMin }) }}</span>
        <span>{{ t('directions.advice.race.leaves', { minutes: trainMin }) }}</span>
      </div>
      <span />
    </div>
  </div>
</template>
