<script setup lang="ts">
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDirectionsService } from '@/services/directions.service'
import { ref, watch } from 'vue'
import { useMapService } from '@/services/map.service'
import { useMapListener } from '@/composables/useMapListener'
import draggable from 'vuedraggable'
import {
  BikeIcon,
  BusFrontIcon,
  CarFrontIcon,
  FootprintsIcon,
  XIcon,
  ShuffleIcon,
  PlusIcon,
  GripHorizontalIcon,
} from 'lucide-vue-next'

const MIN_LOCATIONS = 2

const directionsService = useDirectionsService()
const mapService = useMapService()

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

function onDragEnd() {
  getDirections()
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

    <draggable
      v-model="locations"
      :animation="200"
      handle=".handle"
      item-key="index"
      @end="onDragEnd"
      tag="transition-group"
      :component-data="{
        name: 'locations-list',
        type: 'transition-group',
      }"
      class="flex flex-col gap-2"
    >
      <template #item="{ element, index }">
        <div
          class="relative w-full max-w-sm items-center flex gap-2 locations-list-item"
        >
          <GripHorizontalIcon class="size-4 cursor-move handle" />
          <Input
            :placeholder="index == 0 ? 'From' : 'To'"
            :value="element"
            @input="e => locations[index] = (e.target as HTMLInputElement).value"
          />
          <span
            class="absolute end-0 inset-y-0 flex items-center justify-center"
          >
            <Button
              @click="clearLocation(index)"
              variant="ghost"
              size="icon"
              :icon="XIcon"
              class="rounded-l-none"
            ></Button>
          </span>
        </div>
      </template>
    </draggable>

    <Button variant="secondary" :icon="PlusIcon" @click="addLocation()">
      Add stop
    </Button>
  </div>
</template>
