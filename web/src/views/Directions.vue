<script setup lang="ts">
import { Input } from '@/components/ui/input'
import { H4, H6 } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { useDirectionsService } from '@/services/directions.service'
import { ref } from 'vue'
import { useMapService } from '@/services/map.service'

const directionsService = useDirectionsService()
const mapService = useMapService()

const fromLat = ref(35.22590261131818)
const fromLon = ref(-80.84676058843121)
const toLat = ref(35.228728812341295)
const toLon = ref(-80.84718388671939)

async function getDirections() {
  const directions = await directionsService.getDirections([
    {
      type: 'coordinates',
      value: [fromLat.value, fromLon.value],
    },
    {
      type: 'coordinates',
      value: [toLat.value, toLon.value],
    },
  ])

  mapService.setDirections(directions)
}
</script>

<template>
  <div
    class="p-4 bg-background max-h-full overflow-y-auto m-2 py-2 shadow-md flex flex-col gap-2 rounded-md"
  >
    <H4>Directions</H4>

    <H6>From</H6>
    <div class="flex gap-2">
      <Input placeholder="latitude" v-model="fromLat" />
      <Input placeholder="longitude" v-model="fromLat" />
    </div>

    <H6>To</H6>
    <div class="flex gap-2">
      <Input placeholder="latitude" v-model="toLat" />
      <Input placeholder="longitude" v-model="toLon" />
    </div>

    <Button variant="secondary" @click="getDirections()">Get directions</Button>
  </div>
</template>
