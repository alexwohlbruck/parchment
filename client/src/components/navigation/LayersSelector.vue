<script setup lang="ts">
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useMapStore } from '@/stores/map.store'
import H5 from '@/components/ui/typography/H5.vue'
import { basemaps, layers } from '../map/map.data'
import { Basemap, MapLayer } from '../../types/map.types'

const mapStore = useMapStore()
const { mapState } = storeToRefs(mapStore)

function toggleLayer(layerId: MapLayer, pressed: boolean) {
  mapStore.toggleLayer(layerId, pressed)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <H5>Base map</H5>
    <div class="flex gap-2">
      <ToggleGroup
        type="single"
        :default-value="mapState.basemap"
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
    <div class="flex gap-2">
      <Toggle
        v-for="(layer, i) in layers"
        :key="i"
        variant="outline"
        :aria-label="layer.name"
        :default-value="mapState.layers.includes(layer.id)"
        @update:pressed="pressed => toggleLayer(layer.id, pressed)"
      >
        <component :is="layer.icon" class="size-5" />
      </Toggle>
    </div>
  </div>
</template>
