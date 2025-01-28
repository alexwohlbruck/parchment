<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useMapStore } from '../../stores/map.store'
import { useMapService } from '@/services/map.service'
import { MapStrategy } from './map-providers/map.strategy'
import { LayerType } from '@/types/map.types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { Layers3Icon, PersonStandingIcon } from 'lucide-vue-next'
import LayersSelector from '@/components/navigation/LayersSelector.vue'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { layers } from '@/components/map/layers/layers'

const mapService = useMapService()
const mapStore = useMapStore()

const mapContainer = useTemplateRef<HTMLElement>('mapContainer')
let mapStrategy: MapStrategy

onMounted(() => {
  if (!mapContainer.value) {
    throw new Error('Map container element not found')
  }
  mapStrategy = mapService.initializeMap(mapContainer.value, mapStore.mapEngine)
})

onUnmounted(() => {
  mapService.destroy()
})

function toggleStreetViewLayers() {
  layers.forEach(layer => {
    if (layer.type === LayerType.STREET_VIEW) {
      mapService.toggleLayerVisibility(layer.configuration.id)
    }
  })
}
</script>

<template>
  <div class="flex flex-col gap-2 pointer-events-auto">
    <Card class="border-none">
      <Toggle
        variant="outline"
        size="icon"
        class="size-10"
        @click="toggleStreetViewLayers()"
      >
        <PersonStandingIcon class="size-6" />
      </Toggle>
    </Card>

    <HoverCard :openDelay="0" :closeDelay="0">
      <HoverCardTrigger as-child>
        <Button variant="outline" size="icon" class="size-10 shadow-md">
          <Layers3Icon class="size-5" />
        </Button>
      </HoverCardTrigger>

      <HoverCardContent
        side="left"
        align="end"
        class="w-fit fit-content max-w-[calc(100vw-3.75rem)] md:max-w-[50vw]"
      >
        <LayersSelector />
      </HoverCardContent>
    </HoverCard>
  </div>
</template>
