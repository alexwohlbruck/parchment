<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { MapPinIcon } from 'lucide-vue-next'
import TripsList from '@/components/directions/TripsList.vue'
import { useTripNavigation } from '@/composables/directions/useTripNavigation'
import { AppRoute } from '@/router'
import type { AskTripPlan } from '@/stores/ask.store'
import type { AskStop } from '@/types/ask.types'

const props = defineProps<{ plan: AskTripPlan; stops?: AskStop[] }>()

const { t } = useI18n()
const router = useRouter()
const { openTrip } = useTripNavigation(() => props.plan.trips.request)

const trip = computed(() => props.plan.trips.trips.find(candidate => candidate.id === props.plan.tripId))
const proposed = computed(() => ({ ...props.plan.trips, trips: trip.value ? [trip.value] : [] }))
</script>

<template>
  <div class="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
    <div v-if="stops?.length" class="flex flex-wrap items-center gap-1.5 px-3 pt-3 text-[13px] text-muted-foreground">
      {{ t('ask.trip.via') }}
      <span
        v-for="stop in stops"
        :key="`${stop.lat},${stop.lng}`"
        class="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/60 px-1.5 font-medium text-foreground"
      >
        <MapPinIcon class="size-3 text-muted-foreground" />{{ stop.name ?? t('ask.trip.stop') }}
        <span v-if="stop.minutes" class="font-normal text-muted-foreground">· {{ t('ask.trip.minutes', { count: stop.minutes }) }}</span>
      </span>
    </div>
    <TripsList :trips="proposed" />
    <div class="flex items-center justify-end gap-2 border-t border-border/60 p-2">
      <button
        type="button"
        class="rounded-full border border-border px-3.5 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted transition-colors"
        @click="router.push({ name: AppRoute.DIRECTIONS })"
      >
        {{ t('ask.trip.allWays') }}
      </button>
      <button
        v-if="trip"
        type="button"
        class="rounded-full bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        @click="openTrip(trip)"
      >
        {{ t('ask.trip.open') }}
      </button>
    </div>
  </div>
</template>
