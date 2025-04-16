<script setup lang="ts">
import { computed } from 'vue'
import { useMapService } from '@/services/map.service'
import { LayerType } from '@/types/map.types'
import { Card } from '@/components/ui/card'
import { Toggle } from '@/components/ui/toggle'
import { PersonStandingIcon } from 'lucide-vue-next'
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
</template>
