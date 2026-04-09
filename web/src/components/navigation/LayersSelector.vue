<script setup lang="ts">
import { computed } from 'vue'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useMapStore } from '@/stores/map.store'
import { useLayersStore } from '@/stores/layers.store'
import { useNotesStore } from '@/stores/notes.store'
import { useLayersService } from '@/services/layers/layers.service'
import { useMapService } from '@/services/map.service'
import { H6 } from '@/components/ui/typography'
import { basemaps } from '../map/map.data'
import { Basemap, LayerType } from '@/types/map.types'
import { storeToRefs } from 'pinia'
import { toRaw } from 'vue'
import * as LucideIcons from 'lucide-vue-next'
import { MessageSquareIcon } from 'lucide-vue-next'

const layersStore = useLayersStore()
const layersService = useLayersService()
const mapStore = useMapStore()
const mapService = useMapService()
const notesStore = useNotesStore()
const { layers, allLayerGroups, mainReorderableItems } =
  storeToRefs(layersStore)

// Helper function to convert icon string name to Vue component
function getIconComponent(iconName?: string | null) {
  if (!iconName) return null

  const fullName = iconName.endsWith('Icon') ? iconName : `${iconName}Icon`

  const icon = LucideIcons[fullName as keyof typeof LucideIcons]
  const isValidIcon = fullName !== 'icons' && typeof icon === 'function'

  return isValidIcon ? (icon as any) : null
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
    allLayerGroups.value,
  )
}

async function toggleLayerGroupVisibility(groupId: string, visible: boolean) {
  const group = allLayerGroups.value.find(g => g.id === groupId)
  if (group) {
    await layersService.toggleLayerGroupVisibility(
      group,
      visible,
      layersStore,
      layers.value,
      mapService.mapStrategy,
      allLayerGroups.value,
    )
  }
}

const ungroupedLayers = computed(() => {
  return layers.value.filter(layer => {
    const raw = toRaw(layer)
    return raw && !raw.groupId && raw.showInLayerSelector
  })
})

// Get layer groups (filtered for showInLayerSelector)
const filteredGroups = computed(() => {
  return allLayerGroups.value.filter(group => {
    // Only show groups that are enabled in the selector
    if (!group.showInLayerSelector) return false

    const groupLayers = layers.value.filter(layer => {
      const raw = toRaw(layer)
      return raw && raw.groupId === group.id
    })
    return groupLayers
  })
})

// Get total layer count for a group (including sub-layers and descendant groups)
function getGroupLayerCount(groupId: string): number {
  return layersStore.getGroupTotalLayerCount(groupId)
}

// Combine in the exact custom order from mainReorderableItems
const allLayers = computed(() => {
  return mainReorderableItems.value
    .map(item => {
      // Item is a group
      if (!('groupId' in item)) {
        const group = allLayerGroups.value.find(g => g.id === item.id)
        if (!group) return null
        // Only include groups that should show and have at least one non-street-view layer
        if (!group.showInLayerSelector) return null
        const groupHasNonStreetLayer = layers.value.some(
          l => toRaw(l)?.groupId === group.id,
        )
        if (!groupHasNonStreetLayer) return null
        return {
          type: 'group' as const,
          id: group.id,
          name: group.name,
          icon: group.icon,
          visible: group.visible,
          count: getGroupLayerCount(group.id),
          toggleFn: (visible: boolean) =>
            toggleLayerGroupVisibility(group.id, visible),
        }
      }

      // Item is a layer (ungrouped only appears in main list)
      const raw = toRaw(item)
      if (raw && !raw.groupId && raw.showInLayerSelector) {
        return {
          type: 'layer' as const,
          id: getLayerId(raw),
          name: raw.name,
          icon: raw.icon,
          visible: raw.visible,
          toggleFn: (visible: boolean) =>
            toggleLayerVisibility(getLayerId(raw), visible),
        }
      }
      return null
    })
    .filter(Boolean) as Array<
    | {
        type: 'group'
        id: string
        name: string
        icon: any
        visible: boolean
        count: number
        toggleFn: (v: boolean) => void
      }
    | {
        type: 'layer'
        id: string
        name: string
        icon: any
        visible: boolean
        toggleFn: (v: boolean) => void
      }
  >
})
</script>

<template>
  <div class="space-y-5 min-w-0">
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
          @update:model-value="
            basemap => mapStore.setBasemap(basemap as Basemap)
          "
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

      <div class="grid grid-cols-2 gap-2">
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

        <!-- OSM Notes toggle -->
        <Toggle
          variant="outline"
          aria-label="Toggle OSM Notes layer"
          :default-value="notesStore.isLayerVisible"
          @update:model-value="(v: boolean) => (notesStore.isLayerVisible = v)"
          class="flex flex-col items-center gap-2 p-3 h-16 justify-center text-center transition-all duration-200 hover:bg-accent/50 data-[state=on]:bg-primary/10 data-[state=on]:text-primary data-[state=on]:border-primary/50 group relative"
        >
          <div class="flex flex-col items-center gap-1 min-w-0 w-full">
            <MessageSquareIcon
              class="size-4 transition-colors group-data-[state=on]:text-primary"
            />
            <div class="font-medium text-xs leading-tight truncate w-full">
              {{ $t('notes.layer') }}
            </div>
          </div>
        </Toggle>
      </div>

      <!-- Empty State (no custom layers) -->
      <div
        v-if="allLayers.length === 0"
        class="text-center py-4 text-muted-foreground"
      >
        <div class="text-sm">No layers available</div>
        <div class="text-xs mt-1">
          Enable layers in settings to see them here
        </div>
      </div>
    </div>
  </div>
</template>
