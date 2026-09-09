<script setup lang="ts">
/**
 * Live bikeshare / scootershare dock availability — sourced from a GBFS
 * `station_status` feed via Barrelman. Compact, scannable card:
 *
 *   🚲 16       ⚡ 1        🅿 13
 *   Bikes      E-bikes      Docks
 *   ◉ Live · Updated 2 min ago · Citi Bike
 *
 * GBFS only reports aggregate counts (not per-slot occupancy), so the card
 * shows totals — there is no faithful way to render individual dock slots.
 */
import { computed, type FunctionalComponent } from 'vue'
import type { BikeshareStatus } from '@/types/place.types'
import { Card, CardContent } from '@/components/ui/card'
import {
  BikeIcon,
  ZapIcon,
  SquareParkingIcon,
  TriangleAlertIcon,
} from 'lucide-vue-next'
import { useTransitClock } from '@/composables/useTransitClock'

const props = defineProps<{
  status: BikeshareStatus
}>()

// Ticks once a minute so "Updated N min ago" stays current.
const now = useTransitClock()

const totalBikes = computed(
  () => props.status.bikesAvailable + props.status.ebikesAvailable,
)
const isScooterDock = computed(
  () => props.status.scootersAvailable > 0 && totalBikes.value === 0,
)

interface Stat {
  key: string
  icon: FunctionalComponent
  count: number
  label: string
  /** Available vehicles use the theme accent; empty docks stay muted. */
  accent: boolean
}

const stats = computed<Stat[]>(() => {
  const s = props.status
  const out: Stat[] = []

  if (isScooterDock.value) {
    out.push({
      key: 'scooters',
      icon: ZapIcon,
      count: s.scootersAvailable,
      label: s.scootersAvailable === 1 ? 'Scooter' : 'Scooters',
      accent: true,
    })
  } else {
    out.push({
      key: 'bikes',
      icon: BikeIcon,
      count: s.bikesAvailable,
      label: s.bikesAvailable === 1 ? 'Bike' : 'Bikes',
      accent: true,
    })
    if (s.ebikesAvailable > 0) {
      out.push({
        key: 'ebikes',
        icon: ZapIcon,
        count: s.ebikesAvailable,
        label: s.ebikesAvailable === 1 ? 'E-bike' : 'E-bikes',
        accent: true,
      })
    }
  }

  out.push({
    key: 'docks',
    icon: SquareParkingIcon,
    count: s.docksAvailable,
    label: s.docksAvailable === 1 ? 'Dock' : 'Docks',
    accent: false,
  })
  return out
})

const networkLabel = computed(
  () => props.status.systemName || props.status.operator || null,
)

const updatedLabel = computed(() => {
  if (!props.status.lastReported) return null
  const then = new Date(props.status.lastReported).getTime()
  if (isNaN(then)) return null
  const min = Math.round((now.value.getTime() - then) / 60_000)
  if (min <= 0) return 'Updated just now'
  if (min === 1) return 'Updated 1 min ago'
  if (min < 60) return `Updated ${min} min ago`
  const h = Math.round(min / 60)
  return h === 1 ? 'Updated 1 hr ago' : `Updated ${h} hr ago`
})

/** Operational warning shown in place of the "Live" indicator. */
const statusWarning = computed(() => {
  const { isRenting, isReturning } = props.status
  if (!isRenting && !isReturning) return 'Out of service'
  if (!isRenting) return 'Not renting'
  if (!isReturning) return 'No open docks'
  return null
})
</script>

<template>
  <Card>
    <CardContent class="p-3 space-y-3">
      <!-- Live counts -->
      <div class="flex text-center">
        <div
          v-for="st in stats"
          :key="st.key"
          class="flex-1 flex flex-col items-center gap-1"
        >
          <component
            :is="st.icon"
            class="size-4"
            :class="st.accent ? 'text-primary' : 'text-muted-foreground'"
          />
          <span
            class="font-display text-4xl leading-none"
            :class="st.count === 0 ? 'text-muted-foreground' : 'text-foreground'"
          >
            {{ st.count }}
          </span>
          <span class="text-xs text-muted-foreground">{{ st.label }}</span>
        </div>
      </div>

      <!-- Status + freshness + network attribution.
           The "updated N min ago" already signals live data, so there's
           no separate Live badge. -->
      <div
        v-if="statusWarning || updatedLabel || networkLabel"
        class="flex items-center gap-1.5 text-xs text-muted-foreground border-t border-border pt-2"
      >
        <template v-if="statusWarning">
          <TriangleAlertIcon class="size-3 shrink-0 text-destructive" />
          <span class="font-medium text-destructive">{{ statusWarning }}</span>
        </template>

        <template v-if="updatedLabel">
          <span v-if="statusWarning" aria-hidden="true">·</span>
          <span>{{ updatedLabel }}</span>
        </template>

        <template v-if="networkLabel">
          <span v-if="statusWarning || updatedLabel" aria-hidden="true">·</span>
          <span class="truncate">{{ networkLabel }}</span>
        </template>
      </div>
    </CardContent>
  </Card>
</template>
