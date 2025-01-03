<script setup lang="ts">
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDirectionsService } from '@/services/directions.service'
import { ref, watch } from 'vue'
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
import { useMapStore } from '@/stores/map.store'
import { storeToRefs } from 'pinia'
import WaypointInput from './WaypointInput.vue'
import TripsList from './TripsList.vue'

dayjs.extend(duration)

const directionsService = useDirectionsService()
const mapService = useMapService()
const { directions } = storeToRefs(useMapStore())

const selectedMode = ref('pedestrian')
const locations = ref<string[]>(['', ''])

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
    type: 'auto',
    icon: CarFrontIcon,
  },
]

// Watch for mode changes and recalculate directions
watch(selectedMode, () => {
  getDirections()
})

// When map is clicked, fill in the coordinates in the location list
useMapListener('map:click', data => {
  const [lon, lat] = data.coordinates
  const text = `${lat.toFixed(6)}, ${lon.toFixed(6)}`

  const emptyIndex = locations.value.findIndex(loc => loc === '')
  if (emptyIndex !== -1) {
    locations.value[emptyIndex] = text
    getDirections()
  }
})

async function getDirections() {
  const filteredLocations = locations.value.filter(l => l != '')

  if (filteredLocations.length < 2) {
    return
  }

  const directions = await directionsService.getDirections({
    locations: filteredLocations.map(location => ({
      type: 'coordinates',
      value: location.split(',').map(v => parseFloat(v.trim())) as [
        number,
        number,
      ],
    })),
    costing: selectedMode.value,
  })
  mapService.setDirections(directions)
}
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

    <WaypointInput v-model="locations" @change="getDirections" />

    <TripsList v-if="directions" />
  </div>
</template>
