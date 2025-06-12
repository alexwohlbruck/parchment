<script setup lang="ts">
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDirectionsService } from '@/services/directions.service'
import { computed, ref, watch } from 'vue'
import { useMapService } from '@/services/map.service'
import { useMapListener } from '@/composables/useMapListener'
import {
  BikeIcon,
  BusFrontIcon,
  CarFrontIcon,
  FootprintsIcon,
  ShuffleIcon,
  TrainFrontIcon,
  TrainIcon,
  LoaderIcon,
} from 'lucide-vue-next'
import { useDirectionsStore } from '@/stores/directions.store'
import { storeToRefs } from 'pinia'
import WaypointInput from './WaypointInput.vue'
import TripsList from './TripsList.vue'
import { Waypoint } from '@/types/map.types'

dayjs.extend(duration)

const directionsService = useDirectionsService()

const { waypoints, trips, selectedMode, isLoading } = storeToRefs(
  useDirectionsStore(),
)

const modes = [
  {
    type: 'multi',
    icon: ShuffleIcon,
    label: 'All modes',
  },
  {
    type: 'pedestrian',
    icon: FootprintsIcon,
    label: 'Walking',
  },
  {
    type: 'bicycle',
    icon: BikeIcon,
    label: 'Cycling',
  },
  {
    type: 'transit',
    icon: TrainIcon,
    label: 'Transit',
  },
  {
    type: 'auto',
    icon: CarFrontIcon,
    label: 'Driving',
  },
]

useMapListener('click', data => {
  directionsService.fillWaypoint({
    lngLat: data.lngLat,
  })
})

watch(
  waypoints,
  () => {
    directionsService.getDirections()
  },
  { deep: true },
)
</script>

<template>
  <div class="p-4 h-full w-full overflow-y-auto flex flex-col gap-2">
    <Tabs v-model="selectedMode" default-value="pedestrian">
      <TabsList class="w-full flex">
        <TabsTrigger
          v-for="(mode, i) in modes"
          :key="i"
          :value="mode.type"
          class="flex-grow"
          :title="mode.label"
        >
          <component :is="mode.icon" class="size-5" />
        </TabsTrigger>
      </TabsList>
    </Tabs>

    <WaypointInput
      :model-value="waypoints"
      @update:modelValue="directionsService.setWaypoints"
    />

    <!-- Loading state -->
    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <LoaderIcon class="size-6 animate-spin text-muted-foreground" />
      <span class="ml-2 text-sm text-muted-foreground"
        >Planning your trip...</span
      >
    </div>

    <!-- Trips results -->
    <TripsList v-else-if="trips" :trips="trips" />

    <!-- No results -->
    <div
      v-else-if="!isLoading && waypoints.some(wp => wp.lngLat)"
      class="text-center py-8 text-muted-foreground"
    >
      <p class="text-sm">No routes found</p>
    </div>
  </div>
</template>
