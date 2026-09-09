<script setup lang="ts">
import { useTripNavigation } from '@/composables/directions/useTripNavigation'
import type { TripsResponse } from '@/types/directions.types'
import TripListItem from './TripListItem.vue'
import TripRows from './TripRows.vue'

const props = defineProps<{ trips: TripsResponse }>()

const { openTrip } = useTripNavigation(() => props.trips.request)
</script>

<template>
  <TripRows :trips="trips.trips" v-slot="{ trip }">
    <TripListItem :trip="trip" @click="openTrip" />
  </TripRows>
</template>
