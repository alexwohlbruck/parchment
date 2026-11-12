<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { arrivalZone, spareZones, type Race, type RaceZoneKind } from '@/lib/directions/trip-advice'

/** Your spare time at the stop on a fixed scale: walking slower drags the marker toward late. */
const props = defineProps<{
  race: Race
  nowMs: number
  lineName?: string
}>()

const { t } = useI18n()

const MIN = 60_000
const SCALE_FROM = -5 * MIN
const SCALE_TO = 10 * MIN
const at = (ms: number) => (Math.min(SCALE_TO, Math.max(SCALE_FROM, ms)) - SCALE_FROM) / (SCALE_TO - SCALE_FROM)
const pct = (ms: number) => `${at(ms) * 100}%`

const ZONE_COLORS: Record<RaceZoneKind, string> = {
  calm: 'bg-forest-400',
  leave: 'bg-forest-600',
  hurry: 'bg-amber-500',
  run: 'bg-orange-600',
  tooFar: 'bg-red-600',
}
const zone = computed(() => arrivalZone(props.race, props.nowMs))

/** The track, with the outermost zones stretched to the scale's ends. */
const segments = computed(() => {
  const zones = spareZones(props.race, props.nowMs)
  return zones.map((z, i) => {
    const from = i === 0 ? SCALE_FROM : z.fromMs
    const to = i === zones.length - 1 ? SCALE_TO : z.toMs
    return { kind: z.kind, left: pct(from), width: `${(at(to) - at(from)) * 100}%`, color: ZONE_COLORS[z.kind] }
  })
})

const spareMin = computed(() => props.race.spareMs / MIN)
const text = computed(() =>
  props.race.spareMs < 0
    ? t('directions.advice.status.short', { minutes: Math.max(1, Math.ceil(-spareMin.value)) })
    : spareMin.value < 1
      ? t('directions.advice.status.spareNone')
      : t('directions.advice.status.spare', { minutes: Math.floor(spareMin.value) }),
)
const marker = computed(() => {
  const p = at(props.race.spareMs) * 100
  return { left: `${p}%`, label: { left: `${p}%`, transform: `translateX(-${p}%)` }, nearLate: p < 30, nearEarly: p > 70 }
})

const label = computed(() =>
  t('directions.advice.race.label', {
    walk: Math.round(props.race.walkMs / MIN),
    train: Math.max(0, Math.floor((props.race.departAtMs - props.nowMs) / MIN)),
    line: props.lineName ?? '',
  }),
)
</script>

<template>
  <div role="img" :aria-label="label" class="text-xs tabular-nums text-muted-foreground">
    <div class="relative h-[18px]">
      <div
        v-for="s in segments"
        :key="s.kind"
        class="absolute top-1/2 h-1.5 -translate-y-1/2 transition-all duration-700 first:rounded-l-full last:rounded-r-full"
        :class="[s.color, s.kind === zone ? 'opacity-100' : 'opacity-30']"
        :style="{ left: s.left, width: s.width }"
      />
      <div class="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70" :style="{ left: pct(0) }" />
      <div
        class="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow-sm ring-[3px] ring-primary/25 transition-[left] duration-700"
        :style="{ left: marker.left }"
      />
    </div>
    <div class="relative mt-1 h-4">
      <span v-show="!marker.nearLate" class="absolute left-0">{{ t('directions.advice.race.late') }}</span>
      <span v-show="!marker.nearEarly" class="absolute right-0">{{ t('guidance.transit.reach.early') }}</span>
      <span class="absolute whitespace-nowrap font-medium text-foreground transition-all duration-700" :style="marker.label">
        {{ text }}
      </span>
    </div>
  </div>
</template>
