<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUnits } from '@/composables/useUnits'
import { getTravelModeColor } from '@/lib/directions/travel-mode-colors'
import { getModeIcon, getSegmentIcon } from '@/lib/directions/travel-mode-icons'
import { longestTransitSegment, tripType } from '@/lib/directions/trip-type'
import type { TripOption } from '@/types/directions.types'
import type { AdviceStatus } from '@/lib/directions/trip-advice'
import AdviceStatusLine from './AdviceStatusLine.vue'

interface Props {
  trip: TripOption
  /** List view has no duration sidebar, so distance rides along here. */
  showDistance?: boolean
  status?: AdviceStatus | null
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

const PURE_TRANSIT = new Set(['transit', 'transitWalking'])

const direction = computed(() => {
  const seg = props.trip.segments.find(
    s => s.mode === 'transit' && ((s as { headsign?: string }).headsign || (s as { directionLabel?: string }).directionLabel),
  ) as { headsign?: string; directionLabel?: string } | undefined
  if (!seg) return null
  return seg.directionLabel ?? t('directions.toward', { headsign: seg.headsign })
})

const typeLabel = computed(() =>
  direction.value && PURE_TRANSIT.has(type.value.key)
    ? null
    : t(`directions.tripTypes.${type.value.key}`),
)
</script>

<template>
  <div>
    <div class="flex items-center gap-1.5 flex-wrap text-[11px] text-muted-foreground">
      <span class="inline-flex items-center gap-1 min-w-0">
        <component
          :is="icon"
          class="size-3"
          :style="{ color: getTravelModeColor(type.iconMode) }"
        />
        <span v-if="direction" class="text-xs font-semibold text-foreground truncate">
          {{ direction }}
        </span>
        <span v-else class="font-semibold text-foreground/80">
          {{ typeLabel }}
        </span>
      </span>

      <template v-if="direction && typeLabel">
        <span class="size-0.5 rounded-full bg-muted-foreground/50" />
        <span>{{ typeLabel }}</span>
      </template>

      <template v-if="showDistance">
        <span class="size-0.5 rounded-full bg-muted-foreground/50" />
        <span class="tabular-nums">{{ formatDistance(trip.summary.totalDistance) }}</span>
      </template>

      <template v-if="trip.cost?.total">
        <span class="size-0.5 rounded-full bg-muted-foreground/50" />
        <span class="tabular-nums">${{ trip.cost.total.amount.toFixed(2) }}</span>
      </template>
    </div>

    <AdviceStatusLine v-if="status" :status="status" class="mt-1 text-xs" />
  </div>
</template>
