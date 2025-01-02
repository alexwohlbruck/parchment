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
} from 'lucide-vue-next'
import { useMapStore } from '@/stores/map.store'
import { storeToRefs } from 'pinia'
import WaypointInput from './WaypointInput.vue'

dayjs.extend(duration)

const directionsService = useDirectionsService()
const mapService = useMapService()
const { directions } = storeToRefs(useMapStore())

const selectedMode = ref('pedestrian')
const locations = ref<string[]>(['', ''])

const modes = [
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
    class="p-4 bg-background max-h-full w-80 overflow-y-auto shadow-md flex flex-col gap-2 rounded-md"
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

    <div v-if="directions">
      {{
        (() => {
          const seconds = directions.summary.time
          if (seconds < 60) return seconds + ' seconds'
          if (seconds < 3600) return Math.round(seconds / 60) + ' minutes'
          if (seconds < 86400) {
            const hours = Math.floor(seconds / 3600)
            const minutes = Math.round((seconds % 3600) / 60)
            return (
              hours +
              ' hour' +
              (hours > 1 ? 's' : '') +
              (minutes ? ' ' + minutes + ' min' : '')
            )
          }
          const days = Math.floor(seconds / 86400)
          const hours = Math.round((seconds % 86400) / 3600)
          return (
            days +
            ' day' +
            (days > 1 ? 's' : '') +
            (hours ? ' ' + hours + ' hr' : '')
          )
        })()
      }}
    </div>

    <div v-if="directions">
      {{
        (() => {
          const km = directions.summary.length
          if (km < 0.1) return (km * 1000).toFixed(0) + ' meters'
          if (km < 100) return km.toFixed(1) + ' km'
          return Math.round(km) + ' km'
        })()
      }}
    </div>
  </div>
</template>
