<script setup lang="ts">
import { Input } from '@/components/ui/input'
import { H4, H6 } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDirectionsService } from '@/services/directions.service'
import { ref } from 'vue'
import { useMapService } from '@/services/map.service'
import {
  BikeIcon,
  BusFrontIcon,
  CarFrontIcon,
  FootprintsIcon,
  ShuffleIcon,
} from 'lucide-vue-next'

const directionsService = useDirectionsService()
const mapService = useMapService()

const fromLat = ref('')
const toLat = ref('')

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

async function getDirections() {
  // const directions = await directionsService.getDirections([
  //   {
  //     type: 'coordinates',
  //     value: [fromLat.value, fromLon.value],
  //   },
  //   {
  //     type: 'coordinates',
  //     value: [toLat.value, toLon.value],
  //   },
  // ])
  // mapService.setDirections(directions)
}
</script>

<template>
  <div
    class="p-4 bg-background max-h-full overflow-y-auto m-2 py-2 shadow-md flex flex-col gap-2 rounded-md"
  >
    <div class="flex gap-2"></div>

    <Tabs default-value="account" class="w-[400px]">
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

    <Input placeholder="Origin" v-model="fromLat" />
    <Input placeholder="Destination" v-model="toLat" />
  </div>
</template>
