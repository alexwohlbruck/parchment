<script setup lang="ts">
import { useTripNavigation } from '@/composables/directions/useTripNavigation'
import { useTripListAdvice } from '@/composables/directions/useTripAdvice'
import type { TripsResponse } from '@/types/directions.types'
import TripListItem from './TripListItem.vue'
import TripRows from './TripRows.vue'
import CrossoverTip from './CrossoverTip.vue'

const props = defineProps<{ trips: TripsResponse }>()

const { openTrip } = useTripNavigation(() => props.trips.request)
const advice = useTripListAdvice(() => props.trips.trips)
</script>

<template>
  <CrossoverTip v-if="advice.crossover" :tip="advice.crossover" />
  <TripRows :trips="trips.trips" :advice="advice" v-slot="{ trip, status }">
    <TripListItem :trip="trip" :status="status" @click="openTrip" />
  </TripRows>
</template>
