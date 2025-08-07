<script setup lang="ts">
import { computed } from 'vue'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useMapStore } from '@/stores/map.store'
import { useLayersStore } from '@/stores/layers.store'
import { useLayersService } from '@/services/layers.service'
import { useMapService } from '@/services/map.service'
import { H6 } from '@/components/ui/typography'
import { basemaps } from '../map/map.data'
import { Basemap, LayerType } from '@/types/map.types'
import { storeToRefs } from 'pinia'
import { toRaw } from 'vue'
import * as LucideIcons from 'lucide-vue-next'

const layersStore = useLayersStore()
const layersService = useLayersService()
const mapStore = useMapStore()
const mapService = useMapService()
const { layers, layerGroups } = storeToRefs(layersStore)

// Helper function to convert icon string name to Vue component
function getIconComponent(iconName?: string | null) {
  if (!iconName) return null

  const fullName = iconName.endsWith('Icon') ? iconName : `${iconName}Icon`

  const isValidIcon =
    fullName !== 'icons' &&
    typeof LucideIcons[fullName as keyof typeof LucideIcons] === 'function'

  return isValidIcon ? LucideIcons[fullName as keyof typeof LucideIcons] : null
}

function getLayerId(layer: any): string {
  return layer?.configuration?.id || layer?.id
}

async function toggleLayerVisibility(layerId: string, visible: boolean) {
  await layersService.setLayerVisibility(
    layerId,
    layers.value,
    layersStore,
    mapService.mapStrategy,
    visible,
  )
}

async function toggleLayerGroupVisibility(groupId: string, visible: boolean) {
  const group = layerGroups.value.find(g => g.id === groupId)
  if (group) {
    await layersService.toggleLayerGroupVisibility(
      group,
      visible,
      layersStore,
      layers.value,
      mapService.mapStrategy,
    )
  }
}

const ungroupedLayers = computed(() => {
  return layers.value.filter(layer => {
    const raw = toRaw(layer)
    return (
      raw &&
      !raw.groupId &&
      raw.type !== LayerType.STREET_VIEW &&
      raw.showInLayerSelector
    )
  })
})

// Get layer groups (filtered for non-street-view content and showInLayerSelector)
const filteredGroups = computed(() => {
  return layerGroups.value.filter(group => {
    // Only show groups that are enabled in the selector
    if (!group.showInLayerSelector) return false

    const groupLayers = layers.value.filter(layer => {
      const raw = toRaw(layer)
      return raw && raw.groupId === group.id
    })
    return groupLayers.some(
      layer => toRaw(layer)?.type !== LayerType.STREET_VIEW,
    )
  })
})

// Get layer count for each group
function getGroupLayerCount(groupId: string): number {
  return layers.value.filter(l => toRaw(l)?.groupId === groupId).length
}

// Combine all layers for unified grid
const allLayers = computed(() => {
  const groups = filteredGroups.value.map(group => ({
    type: 'group' as const,
    id: group.id,
    name: group.name,
    icon: group.icon,
    visible: group.visible,
    count: getGroupLayerCount(group.id),
    toggleFn: (visible: boolean) =>
      toggleLayerGroupVisibility(group.id, visible),
  }))

  const individual = ungroupedLayers.value.map(layer => ({
    type: 'layer' as const,
    id: getLayerId(layer),
    name: layer.name,
    icon: layer.icon,
    visible: layer.visible,
    toggleFn: (visible: boolean) =>
      toggleLayerVisibility(getLayerId(layer), visible),
  }))

  return [...groups, ...individual]
})
</script>

<template>
  <div class="p-4 space-y-5 min-w-0">
    <!-- Base Map Section -->
    <div class="space-y-3">
      <H6
        class="text-xs font-bold text-muted-foreground uppercase tracking-wide"
      >
        Base map
      </H6>
      <div class="grid grid-cols-2 gap-2">
        <ToggleGroup
          type="single"
          :default-value="mapStore.settings.basemap"
          @update:model-value="(basemap) => mapStore.setBasemap(basemap as Basemap)"
          class="contents"
        >
          <ToggleGroupItem
            v-for="[basemapId, basemap] in Object.entries(basemaps)"
            :key="basemapId"
            :value="basemapId"
            :aria-label="`Switch to ${basemap.name}`"
            variant="outline"
            class="flex flex-col items-center gap-2 p-3 h-16 justify-center text-center transition-all duration-200 hover:bg-accent/50 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm"
          >
            <component :is="basemap.icon" class="size-4 shrink-0" />
            <span class="font-medium text-xs leading-tight">{{
              basemap.name
            }}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>

    <!-- Layers Section -->
    <div class="space-y-3">
      <H6
        class="text-xs font-bold text-muted-foreground uppercase tracking-wide"
      >
        Layers
      </H6>

      <div v-if="allLayers.length > 0" class="grid grid-cols-2 gap-2">
        <Toggle
          v-for="item in allLayers"
          :key="item.id"
          variant="outline"
          :aria-label="`Toggle ${item.name} ${
            item.type === 'group' ? 'group' : 'layer'
          }`"
          :default-value="item.visible || false"
          @update:model-value="item.toggleFn"
          class="flex flex-col items-center gap-2 p-3 h-16 justify-center text-center transition-all duration-200 hover:bg-accent/50 data-[state=on]:bg-primary/10 data-[state=on]:text-primary data-[state=on]:border-primary/50 group relative"
        >
          <!-- Group indicator badge -->
          <div
            v-if="item.type === 'group'"
            class="absolute top-1 right-1 bg-muted text-muted-foreground text-xs px-1 py-0.5 rounded font-medium leading-none"
          >
            {{ item.count }}
          </div>

          <div class="flex flex-col items-center gap-1 min-w-0 w-full">
            <component
              v-if="getIconComponent(item.icon)"
              :is="getIconComponent(item.icon)"
              class="size-4 transition-colors group-data-[state=on]:text-primary"
            />
            <div class="font-medium text-xs leading-tight truncate w-full">
              {{ item.name }}
            </div>
          </div>
        </Toggle>
      </div>

      <!-- Empty State -->
      <div v-else class="text-center py-8 text-muted-foreground">
        <div class="text-sm">No layers available</div>
        <div class="text-xs mt-1">
          Enable layers in settings to see them here
        </div>
      </div>
    </div>
  </div>
</template>
