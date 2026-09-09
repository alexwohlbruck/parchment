<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useMapService } from '@/services/map.service'
import { LayerType, ControlVisibility } from '@/types/map.types'
import { Card } from '@/components/ui/card'
import { Toggle } from '@/components/ui/toggle'
import { PersonStandingIcon } from 'lucide-vue-next'
import { useLayersStore } from '@/stores/layers.store'
import { useStreetViewLayersService } from '@/services/layers/features/street-view-layers.service'
import { useMapStore } from '@/stores/map.store'

const mapService = useMapService()
const mapStore = useMapStore()
const { controlSettings } = storeToRefs(mapStore)
const layersStore = useLayersStore()
const streetViewLayersService = useStreetViewLayersService()

const hasStreetViewLayers = computed(() =>
  layersStore.layers.some(layer => layer.type === LayerType.STREET_VIEW),
)

const isStreetViewLayerVisible = computed(() => {
  return layersStore.layers.some(
    layer => layer.type === LayerType.STREET_VIEW && layer.visible,
  )
})

const isVisible = computed(() => {
  if (!hasStreetViewLayers.value) return false
  const setting = controlSettings.value.streetView
  if (setting === ControlVisibility.ALWAYS) return true
  if (setting === ControlVisibility.NEVER) return false
  // WHILE_ACTIVE: show only when street view layer is visible
  return isStreetViewLayerVisible.value
})

async function onToggle() {
  const next = !isStreetViewLayerVisible.value
  await streetViewLayersService.toggleStreetViewLayers(
    layersStore.layers,
    layersStore,
    mapService.mapStrategy,
    next,
  )
}
</script>

<template>
  <transition name="fade">
    <div v-if="isVisible">
      <Toggle
        :key="`street-view-${isStreetViewLayerVisible}`"
        variant="outline"
        size="icon"
        class="size-11"
        :default-value="isStreetViewLayerVisible"
        @update:model-value="onToggle"
      >
        <PersonStandingIcon class="size-6" />
      </Toggle>
    </div>
  </transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
