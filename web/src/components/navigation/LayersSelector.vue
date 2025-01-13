<script setup lang="ts">
import { computed } from 'vue'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useMapStore } from '@/stores/map.store'
import { useMapService } from '@/services/map.service'
import { H5 } from '@/components/ui/typography'
import { basemaps } from '../map/map.data'
import { Basemap, Layer } from '@/types/map.types'

const mapStore = useMapStore()
const mapService = useMapService()

const enabledLayers = computed(() =>
  mapStore.layers.filter(layer => layer.enabled),
)

function toggleLayerVisibility(
  layerId: Layer['configuration']['id'],
  pressed: boolean,
) {
  mapService.toggleLayerVisibility(layerId, pressed)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <H5>Base map</H5>
    <div class="flex gap-2 flex-wrap">
      <ToggleGroup
        type="single"
        :default-value="mapStore.mapState.basemap"
        @update:model-value="(basemap) => mapStore.setBasemap(basemap as Basemap)"
      >
        <ToggleGroupItem
          v-for="[basemapId, basemap] in Object.entries(basemaps)"
          :key="basemapId"
          :value="basemapId"
          aria-label="Toggle bold"
          variant="outline"
          class="flex gap-2"
        >
          <component :is="basemap.icon" class="size-5" />
          <span>{{ basemap.name }}</span>
        </ToggleGroupItem>
      </ToggleGroup>
    </div>

    <H5>Layers</H5>
    <div class="flex gap-2 flex-wrap">
      <Toggle
        v-for="(layer, i) in enabledLayers"
        :key="i"
        variant="outline"
        :aria-label="layer.name"
        :default-value="layer.visible || false"
        @update:pressed="
          pressed => toggleLayerVisibility(layer.configuration.id, pressed)
        "
        class="flex gap-2"
      >
        <component :is="layer.icon" class="size-5" />
        <span>{{ layer.name }}</span>
      </Toggle>
    </div>
  </div>
</template>
