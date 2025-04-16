<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useMapService } from '@/services/map.service'
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
import { useMapStore } from '@/stores/map.store'

const mapService = useMapService()
const mapStore = useMapStore()

const isStreetViewLayerVisible = computed(() => {
  return mapStore.layers.some(
    layer => layer.type === LayerType.STREET_VIEW && layer.visible,
  )
})
</script>

<template>
  <div class="flex flex-col gap-2 pointer-events-auto">
    <Card class="border-none">
      <Toggle
        variant="outline"
        size="icon"
        class="size-10"
        @click="mapService.toggleStreetViewLayers()"
        :default-value="isStreetViewLayerVisible"
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
        :side-offset="8"
        class="w-fit fit-content max-w-[calc(100vw-3.75rem)] md:max-w-[50vw]"
      >
        <LayersSelector />
      </HoverCardContent>
    </HoverCard>
  </div>
</template>
