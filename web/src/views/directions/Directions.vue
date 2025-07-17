<script setup lang="ts">
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import { onUnmounted } from 'vue'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDirectionsService } from '@/services/directions.service'
import { useMapListener } from '@/composables/useMapListener'
import {
  BikeIcon,
  BusFrontIcon,
  CarFrontIcon,
  FootprintsIcon,
  ShuffleIcon,
  TrainFrontIcon,
  TrainIcon,
} from 'lucide-vue-next'
import { useDirectionsStore } from '@/stores/directions.store'
import { storeToRefs } from 'pinia'
import WaypointInput from './WaypointInput.vue'
import TripsList from './TripsList.vue'
import { Spinner } from '@/components/ui/spinner'
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

onUnmounted(() => {
  directionsService.clearWaypoints()
})
</script>

<template>
  <div class="h-full w-full overflow-y-auto flex flex-col">
    <div class="p-4 space-y-3 flex flex-col">
      <Tabs v-model="selectedMode" default-value="pedestrian">
        <TabsList class="w-full flex">
          <TabsTrigger
            v-for="(mode, i) in modes"
            :key="i"
            :value="mode.type"
            class="grow"
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
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex items-center justify-center py-8 px-4">
      <Spinner />
      <span class="ml-2 text-sm text-muted-foreground"> Finding trips... </span>
    </div>

    <!-- Trips results -->
    <TripsList v-else-if="trips" :trips="trips" class="flex-1" />

    <!-- No results -->
    <div
      v-else-if="!isLoading && waypoints.some(wp => wp.lngLat)"
      class="text-center py-8 text-muted-foreground px-4"
    >
      <p class="text-sm">No routes found</p>
    </div>
  </div>
</template>
