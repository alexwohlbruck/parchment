<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TripListAdvice } from '@/composables/directions/useTripAdvice'
import { byRank } from '@/lib/directions/trip-display'
import { groupByTripType } from '@/lib/directions/trip-groups'
import { stableTripKeys } from '@/lib/directions/trip-signature'
import type { TripOption } from '@/types/directions.types'

const props = defineProps<{
  trips: TripOption[]
  advice: TripListAdvice
  /** Head each trip type with its own section. */
  grouped?: boolean
}>()

const { t } = useI18n()

const groups = computed(() => {
  const byType = groupByTripType(props.trips)
  return props.grouped && byType.length > 1
    ? byType
    : [{ key: null, trips: byRank(props.trips) }]
})
const ranked = computed(() => groups.value.flatMap(group => group.trips))
const position = computed(() => new Map(ranked.value.map((trip, index) => [trip.id, index])))
const keys = computed(() => stableTripKeys(props.trips))
</script>

<template>
  <!-- Staggered entrance as a fresh set of suggestions loads -->
  <TransitionGroup name="trip" tag="div" class="flex flex-col" appear>
    <template v-for="group in groups" :key="group.key ?? 'all'">
      <!-- Sticky left so the heading stays put while the timeline pans -->
      <h3
        v-if="group.key"
        :key="`heading-${group.key}`"
        class="sticky left-0 w-fit px-4 pt-4 pb-1 text-xs font-medium text-muted-foreground"
      >
        {{ t(`directions.tripTypes.${group.key}`) }}
      </h3>
      <div
        v-for="(trip, index) in group.trips"
        :key="keys.get(trip.id) ?? trip.id"
        :style="{ '--trip-delay': `${Math.min(position.get(trip.id)!, 8) * 45}ms` }"
      >
        <slot :trip="trip" :index="position.get(trip.id)!" :status="advice.status[trip.id] ?? null" />
        <div
          v-if="index < group.trips.length - 1"
          class="border-b border-border/50 mx-4"
        />
      </div>
    </template>
  </TransitionGroup>

  <div v-if="!ranked.length" class="text-center py-8 text-muted-foreground">
    <p class="text-sm">{{ t('directions.noTrips') }}</p>
  </div>
</template>

<style scoped>
/* Each row fades and lifts in, offset by its index via the inline
   --trip-delay. `appear` replays it whenever a new result set mounts. */
.trip-enter-active {
  transition:
    opacity 0.4s ease,
    transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
  transition-delay: var(--trip-delay, 0ms);
}

.trip-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

@media (prefers-reduced-motion: reduce) {
  .trip-enter-active {
    transition: opacity 0.2s ease;
    transition-delay: 0ms;
  }
  .trip-enter-from {
    transform: none;
  }
}
</style>
