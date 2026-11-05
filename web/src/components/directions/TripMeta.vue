<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUnits } from '@/composables/useUnits'
import { getTravelModeColor } from '@/lib/directions/travel-mode-colors'
import { getModeIcon, getSegmentIcon } from '@/lib/directions/travel-mode-icons'
import { formatCo2 } from '@/lib/directions/trip-display'
import { longestTransitSegment, tripType } from '@/lib/directions/trip-type'
import type { TripOption } from '@/types/directions.types'
import type { TripCardAdvice } from '@/composables/directions/useTripAdvice'

interface Props {
  trip: TripOption
  /** List view has no duration sidebar, so distance rides along here. */
  showDistance?: boolean
  advice?: TripCardAdvice
}

const props = defineProps<Props>()

const { t } = useI18n()
const { formatDistance } = useUnits()

const type = computed(() => tripType(props.trip.segments))

const icon = computed(() => {
  if (type.value.iconMode !== 'transit') return getModeIcon(type.value.iconMode)
  const seg = longestTransitSegment(props.trip.segments)
  return getSegmentIcon('transit', seg?.routeType)
})

/** "A · Uptown & The Bronx", else "Q · toward Coney Island"; merged legs read "4 or 5 · …". */
const headsign = computed(() => {
  const seg = props.trip.segments.find(
    s => s.mode === 'transit' && ((s as { headsign?: string }).headsign || (s as { directionLabel?: string }).directionLabel),
  ) as { headsign?: string; directionLabel?: string; lineName?: string; routeOptions?: { shortName?: string }[] } | undefined
  if (!seg) return null
  const options = seg.routeOptions ?? []
  const line =
    options.length > 1
      ? options.map(o => o.shortName).filter(Boolean).join(` ${t('directions.or')} `)
      : seg.lineName
  const direction = seg.directionLabel ?? t('directions.toward', { headsign: seg.headsign })
  return `${line ? line + ' · ' : ''}${direction}`
})
</script>

<template>
  <div>
    <div class="flex items-center gap-1.5 flex-wrap text-[11px] text-muted-foreground">
      <span class="inline-flex items-center gap-1">
        <component
          :is="icon"
          class="size-3"
          :style="{ color: getTravelModeColor(type.iconMode) }"
        />
        <span class="font-semibold text-foreground/80">
          {{ t(`directions.tripTypes.${type.key}`) }}
        </span>
      </span>

      <template v-if="showDistance">
        <span class="size-0.5 rounded-full bg-muted-foreground/50" />
        <span class="tabular-nums">{{ formatDistance(trip.summary.totalDistance) }}</span>
      </template>

      <template v-if="trip.cost?.total">
        <span class="size-0.5 rounded-full bg-muted-foreground/50" />
        <span class="tabular-nums">${{ trip.cost.total.amount.toFixed(2) }}</span>
      </template>

      <template v-if="trip.co2Emissions != null && trip.co2Emissions > 0">
        <span class="size-0.5 rounded-full bg-muted-foreground/50" />
        <span class="tabular-nums">{{ formatCo2(trip.co2Emissions) }} CO₂</span>
      </template>
    </div>

    <div v-if="headsign" class="mt-1 text-[11px] text-muted-foreground truncate">
      {{ headsign }}
    </div>

    <div v-if="advice?.hint" class="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] tabular-nums">
      <span
        v-for="word in advice.hint.words"
        :key="word.word"
        class="shrink-0 rounded px-1 py-px font-semibold"
        :class="word.tone"
      >
        {{ word.word }}
      </span>
      <span v-if="advice.hint.text" class="truncate text-muted-foreground">{{ advice.hint.text }}</span>
    </div>

    <div v-if="advice?.crossover" class="mt-1 text-[11px] text-muted-foreground tabular-nums truncate">
      {{ advice.crossover }}
    </div>
  </div>
</template>
