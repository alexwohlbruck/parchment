<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUnits } from '@/composables/useUnits'
import { getTravelModeColor } from '@/lib/directions/travel-mode-colors'
import { getTripTypeIcon } from '@/lib/directions/travel-mode-icons'
import { tripType } from '@/lib/directions/trip-type'
import type { TripOption } from '@/types/directions.types'
import type { AdviceStatus } from '@/lib/directions/trip-advice'
import AdviceStatusLine from './AdviceStatusLine.vue'

interface Props {
  trip: TripOption
  /** List view has no duration sidebar, so distance rides along here. */
  showDistance?: boolean
  status?: AdviceStatus | null
  /** Leave the trip type out — a section heading already names it. */
  hideType?: boolean
}

const props = defineProps<Props>()

const { t } = useI18n()
const { formatDistance } = useUnits()

const type = computed(() => tripType(props.trip.segments))

const icon = computed(() => getTripTypeIcon(props.trip.segments))

const PURE_TRANSIT = new Set(['transit', 'transitWalking'])

const direction = computed(() => {
  const seg = props.trip.segments.find(
    s => s.mode === 'transit' && ((s as { headsign?: string }).headsign || (s as { directionLabel?: string }).directionLabel),
  ) as { headsign?: string; directionLabel?: string } | undefined
  if (!seg) return null
  return seg.directionLabel ?? t('directions.toward', { headsign: seg.headsign })
})

const typeLabel = computed(() =>
  props.hideType || (direction.value && PURE_TRANSIT.has(type.value.key))
    ? null
    : t(`directions.tripTypes.${type.value.key}`),
)

const lead = computed(() => direction.value ?? typeLabel.value)
const details = computed(() => [
  direction.value ? typeLabel.value : null,
  props.showDistance ? formatDistance(props.trip.summary.totalDistance) : null,
  props.trip.cost?.total ? `$${props.trip.cost.total.amount.toFixed(2)}` : null,
].filter((detail): detail is string => !!detail))
</script>

<template>
  <div>
    <div
      v-if="lead || details.length"
      class="flex items-center gap-1.5 flex-wrap text-[11px] text-muted-foreground"
    >
      <span v-if="lead" class="inline-flex items-center gap-1 min-w-0">
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

      <template v-for="(detail, i) in details" :key="i">
        <span v-if="lead || i > 0" class="size-0.5 rounded-full bg-muted-foreground/50" />
        <span class="tabular-nums">{{ detail }}</span>
      </template>
    </div>

    <AdviceStatusLine v-if="status" :status="status" class="mt-1 text-xs" />
  </div>
</template>
