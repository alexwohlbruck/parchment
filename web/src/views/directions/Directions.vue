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
} from 'lucide-vue-next'
import { useDirectionsStore } from '@/stores/directions.store'
import { storeToRefs } from 'pinia'
import WaypointInput from './WaypointInput.vue'
import TripsList from './TripsList.vue'
import { Waypoint } from '@/types/map.types'

dayjs.extend(duration)

const directionsService = useDirectionsService()

const { waypoints, directions, selectedMode } = storeToRefs(
  useDirectionsStore(),
)

const modes = [
  {
    type: 'multi',
    icon: ShuffleIcon,
  },
  {
    type: 'pedestrian',
    icon: FootprintsIcon,
  },
  {
    type: 'bicycle',
    icon: BikeIcon,
  },
  {
    type: 'transit',
    icon: TrainIcon,
  },
  {
    type: 'auto',
    icon: CarFrontIcon,
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
  <div
    class="p-4 bg-background max-h-full w-[26rem] overflow-y-auto shadow-md flex flex-col gap-2 rounded-md"
  >
    <Tabs v-model="selectedMode" default-value="pedestrian">
      <TabsList class="w-full flex">
        <TabsTrigger
          v-for="(mode, i) in modes"
          :key="i"
          :value="mode.type"
          class="flex-grow"
        >
          <component :is="mode.icon" class="size-5" />
        </TabsTrigger>
      </TabsList>
    </Tabs>

    <WaypointInput
      :model-value="waypoints"
      @update:modelValue="directionsService.setWaypoints"
    />

    <TripsList v-if="directions" />
  </div>
</template>
