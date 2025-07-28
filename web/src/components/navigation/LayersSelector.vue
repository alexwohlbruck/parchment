<script setup lang="ts">
import { computed } from 'vue'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useMapStore } from '@/stores/map.store'
import { useMapService } from '@/services/map.service'
import { H5 } from '@/components/ui/typography'
import { basemaps } from '../map/map.data'
import { Basemap, LayerType } from '@/types/map.types'
import { storeToRefs } from 'pinia'
import { toRaw } from 'vue'

const mapStore = useMapStore()
const mapService = useMapService()
const { layers, layerGroups } = storeToRefs(mapStore)

// Helper function to get layer ID from either structure
function getLayerId(layer: any): string | undefined {
  return layer?.configuration?.id || layer?.id
}

function toggleLayerVisibility(layerId: string, visible: boolean) {
  mapService.toggleLayerVisibility(layerId, visible)
}

function toggleLayerGroupVisibility(groupId: string, visible: boolean) {
  mapStore.toggleLayerGroupVisibility(groupId, visible)
}

// Get ungrouped layers (not street view)
const ungroupedLayers = computed(() => {
  return layers.value.filter(layer => {
    const raw = toRaw(layer)
    return raw && !raw.groupId && raw.type !== LayerType.STREET_VIEW
  })
})

// Get layer groups (filtered for non-street-view content)
const filteredGroups = computed(() => {
  return layerGroups.value.filter(group => {
    // Only show groups that have non-street-view layers
    const groupLayers = layers.value.filter(layer => {
      const raw = toRaw(layer)
      return raw && raw.groupId === group.id
    })
    return groupLayers.some(
      layer => toRaw(layer)?.type !== LayerType.STREET_VIEW,
    )
  })
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <H5>Base map</H5>
    <div class="flex gap-2 flex-wrap">
      <ToggleGroup
        type="single"
        :default-value="mapStore.settings.basemap"
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
    <div class="space-y-2">
      <!-- Layer Groups -->
      <Toggle
        v-for="group in filteredGroups"
        :key="group.id"
        variant="outline"
        :aria-label="group.name"
        :default-value="group.visible || false"
        @update:model-value="
          visible => toggleLayerGroupVisibility(group.id, visible)
        "
        class="flex gap-2"
      >
        <component v-if="group.icon" :is="group.icon" class="size-5" />
        <span>{{ group.name }}</span>
        <span class="text-xs text-muted-foreground ml-auto">
          ({{ layers.filter(l => toRaw(l)?.groupId === group.id).length }})
        </span>
      </Toggle>

      <!-- Individual Ungrouped Layers -->
      <Toggle
        v-for="layer in ungroupedLayers"
        :key="getLayerId(layer)"
        variant="outline"
        :aria-label="layer.name"
        :default-value="layer.visible || false"
        @update:model-value="
          visible => toggleLayerVisibility(getLayerId(layer), visible)
        "
        class="flex gap-2"
      >
        <component v-if="layer.icon" :is="layer.icon" class="size-5" />
        <span>{{ layer.name }}</span>
      </Toggle>
    </div>
  </div>
</template>
