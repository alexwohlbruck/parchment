<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUnits } from '@/composables/useUnits'
import { getTravelModeColor } from '@/lib/directions/travel-mode-colors'
import { getModeIcon, getSegmentIcon } from '@/lib/directions/travel-mode-icons'
import { formatCo2 } from '@/lib/directions/trip-display'
import { longestTransitSegment, tripType } from '@/lib/directions/trip-type'
import type { TripOption } from '@/types/directions.types'

interface Props {
  trip: TripOption
  /** List view has no duration sidebar, so distance rides along here. */
  showDistance?: boolean
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

/** "Q · toward Coney Island" — merged interchangeable legs read "4 or 5 · toward …". */
const headsign = computed(() => {
  const seg = props.trip.segments.find(
    s => s.mode === 'transit' && (s as { headsign?: string }).headsign,
  ) as { headsign?: string; lineName?: string; routeOptions?: { shortName?: string }[] } | undefined
  if (!seg) return null
  const options = seg.routeOptions ?? []
  const line =
    options.length > 1
      ? options.map(o => o.shortName).filter(Boolean).join(` ${t('directions.or')} `)
      : seg.lineName
  return `${line ? line + ' · ' : ''}${t('directions.toward', { headsign: seg.headsign })}`
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
  </div>
</template>
