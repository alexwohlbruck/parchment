<script setup lang="ts">
import { computed } from 'vue'
import { useMapService } from '@/services/map.service'
import { LayerType } from '@/types/map.types'
import { Card } from '@/components/ui/card'
import { Toggle } from '@/components/ui/toggle'
import { PersonStandingIcon } from 'lucide-vue-next'
import { useLayersStore } from '@/stores/layers.store'
import { useLayersService } from '@/services/layers.service'

const mapService = useMapService()
const layersStore = useLayersStore()
const layersService = useLayersService()

const hasStreetViewLayers = computed(() =>
  layersStore.layers.some(layer => layer.type === LayerType.STREET_VIEW),
)

const isStreetViewLayerVisible = computed(() => {
  return layersStore.layers.some(
    layer => layer.type === LayerType.STREET_VIEW && layer.visible,
  )
})

async function onToggle() {
  const next = !isStreetViewLayerVisible.value
  await layersService.toggleStreetViewLayers(
    layersStore.layers,
    layersStore,
    mapService.mapStrategy,
    next,
  )
}
</script>

<template>
  <Card v-if="hasStreetViewLayers" class="border-none shadow-md rounded-md">
    <Toggle
      variant="outline"
      size="icon"
      class="size-10"
      @click="onToggle"
      :default-value="isStreetViewLayerVisible"
    >
      <PersonStandingIcon class="size-6" />
    </Toggle>
  </Card>
</template>
