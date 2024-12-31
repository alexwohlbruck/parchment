<script setup lang="ts">
import { Input } from '@/components/ui/input'
import { H4, H6 } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDirectionsService } from '@/services/directions.service'
import { ref } from 'vue'
import { useMapService } from '@/services/map.service'
import { useMapListener } from '@/composables/useMapListener'
import {
  BikeIcon,
  BusFrontIcon,
  CarFrontIcon,
  FootprintsIcon,
  XIcon,
  ShuffleIcon,
  PlusIcon,
} from 'lucide-vue-next'

const MIN_LOCATIONS = 2

const directionsService = useDirectionsService()
const mapService = useMapService()

const locations = ref<string[]>(['', ''])

const modes = [
  {
    type: 'Pedestrian',
    icon: FootprintsIcon,
  },
  {
    type: 'cycling',
    icon: BikeIcon,
  },
  // {
  //   type: 'transit',
  //   icon: BusFrontIcon,
  // },
  {
    type: 'auto',
    icon: CarFrontIcon,
  },
  // {
  //   type: 'multimodal',
  //   icon: ShuffleIcon,
  // },
]

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

  const directions = await directionsService.getDirections(
    filteredLocations.map(location => ({
      type: 'coordinates',
      value: location.split(',').map(v => parseFloat(v.trim())) as [
        number,
        number,
      ],
    })),
  )
  mapService.setDirections(directions)
}

function clearLocation(index: number) {
  if (locations.value.length > MIN_LOCATIONS) {
    locations.value.splice(index, 1)
    getDirections()
  } else {
    locations.value[index] = ''
  }
}

function addLocation() {
  locations.value.push('')
}
</script>

<template>
  <div
    class="p-4 bg-background max-h-full w-80 overflow-y-auto shadow-md flex flex-col gap-2 rounded-md"
  >
    <Tabs default-value="account">
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

    <div
      v-for="(location, i) in locations"
      :key="i"
      class="relative w-full max-w-sm items-center"
    >
      <Input
        :placeholder="i == 0 ? 'From' : 'To'"
        :value="location"
        @input="e => locations[i] = (e.target as HTMLInputElement).value"
      />
      <span class="absolute end-0 inset-y-0 flex items-center justify-center">
        <Button
          @click="clearLocation(i)"
          variant="ghost"
          size="icon"
          :icon="XIcon"
          class="rounded-l-none"
        ></Button>
      </span>
    </div>

    <Button variant="secondary" :icon="PlusIcon" @click="addLocation()">
      Add stop
    </Button>
  </div>
</template>
