<script setup lang="ts">
import { computed, onMounted, onUnmounted, useTemplateRef, watch } from 'vue'
import { useMapStore } from '../../stores/map.store'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useMapService } from '@/services/map.service'
import { useAppService } from '@/services/app.service'
import { useDragAndDrop } from '@/composables/useDragAndDrop'
import { useDragState } from '@/composables/useDragState'
import type { Layer, LayerGroup } from '@/types/map.types'
import LayerConfiguration from './layers/LayerConfiguration.vue'
import DataTable from '@/components/table/DataTable.vue'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

const appService = useAppService()
const mapService = useMapService()
const mapStore = useMapStore()
const { layers } = storeToRefs(mapStore)
const { t } = useI18n()
const { isDragActive } = useDragState()

const isProd = import.meta.env.PROD

// Track expanded groups
const expandedGroups = ref(new Set<string>())

// Local draggable array that syncs with the store but allows vuedraggable to modify it
const draggableItems = ref<(Layer | LayerGroup)[]>([])

// Sync with store data when it changes
watch(
  mainReorderableItems,
  newItems => {
    draggableItems.value = [...newItems]
  },
  { immediate: true, deep: true },
) // Added deep: true to watch for property changes

// Drag and drop composable
const {
  isDragging,
  mainDragOptions,
  onDragStart,
  onDragEnd,
  onDragMove,
  getLayerKey,
} = useDragAndDrop()

function openLayerConfigDialog(layerId?: string) {
  appService.componentDialog({
    component: LayerConfiguration,
    continueText: t('general.save'),
    props: {
      layerId,
    },
  })
}

function openLayerGroupConfigDialog(groupId?: string) {
  appService.componentDialog({
    component: LayerGroupConfiguration,
    continueText: t('general.save'),
    props: {
      groupId,
    },
  })
}

async function restoreDefaults() {
  const res = await layersService.restoreDefaultLayers()
  await layersStore.loadLayers()
  appService.toast.success(
    t('layers.restoreDefaults.success', { count: res?.restored ?? 0 }),
  )
}

function toggleGroup(groupId: string) {
  if (expandedGroups.value.has(groupId)) {
    expandedGroups.value.delete(groupId)
  } else {
    expandedGroups.value.add(groupId)
  }
}

// Simple drag handlers
async function handleMainChange(evt: any) {
  console.log('=== Frontend handleMainChange ===')
  console.log('Event:', evt)

  if (evt.added) {
    // Layer dropped from group to main list - handle via layer move
    const layerId = evt.added.element.id
    const newIndex = evt.added.newIndex
    console.log('Added event - moving layer to main list:', layerId, newIndex)
    await layersStore.handleLayerMove(layerId, null, newIndex)
  } else if (evt.moved) {
    // Item was reordered within the main list
    const { element, newIndex } = evt.moved
    console.log(
      'Moved event - reordering within main list:',
      element.id,
      'to index',
      newIndex,
    )

    // Use the current draggableItems array which has been updated by vuedraggable
    console.log(
      'Current draggableItems order:',
      draggableItems.value.map((item, idx) => ({
        id: item.id,
        name: 'name' in item ? item.name : 'Unknown',
        arrayIndex: idx,
      })),
    )

    await layersStore.handleMainReorder(draggableItems.value)
  } else if (!evt.added && !evt.removed && !evt.moved) {
    // This should handle other reorder cases if any
    console.log('General reorder event - using current draggableItems')
    await layersStore.handleMainReorder(draggableItems.value)
  }
  console.log('=== End Frontend handleMainChange ===')
}
</script>

<template>
  <!-- Always render the map container, but conditionally show content -->
  <div ref="mapContainer" class="w-full h-full">
    <!-- Show loading state while integrations are loading -->
    <MapLoading v-if="isLoadingIntegrations" />

    <!-- Show Mapbox fallback if Mapbox is selected but not configured -->
    <MapboxFallback v-else-if="shouldShowMapboxFallback" />
  </div>

  <!-- Context menu is always available -->
  <ContextMenu v-if="shouldShowMap" />
</template>

<style>
.mapboxgl-canvas,
.maplibregl-canvas {
  outline: none;
}

.mapboxgl-ctrl-scale,
.maplibregl-ctrl-scale {
  font-weight: 700;
  font-family: var(--font);
}

.dark .mapboxgl-ctrl-scale,
.dark .maplibregl-ctrl-scale {
  color: hsl(var(--foreground));
}

.dark .mapboxgl-ctrl-group,
.dark .maplibregl-ctrl-group,
.dark .mapboxgl-ctrl-scale,
.dark .maplibregl-ctrl-scale {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.dark .mapboxgl-ctrl-icon,
.dark .maplibregl-ctrl-icon {
  filter: invert(1);
}

.mapboxgl-control-container {
  visibility: v-bind(mapControlsVisibility);
}

.mapboxgl-ctrl-top,
.mapboxgl-ctrl-top-left,
.mapboxgl-ctrl-top-right {
  padding-top: env(safe-area-inset-top);
}

.mapboxgl-ctrl-bottom,
.mapboxgl-ctrl-bottom-left,
.mapboxgl-ctrl-bottom-right {
  padding-bottom: env(safe-area-inset-bottom);
}

.mapboxgl-ctrl-left,
.mapboxgl-ctrl-left-top,
.mapboxgl-ctrl-right-bottom {
  padding-right: env(safe-area-inset-right);
}

.mapboxgl-ctrl-right,
.mapboxgl-ctrl-right-top,
.mapboxgl-ctrl-right-bottom {
  padding-right: env(safe-area-inset-right);
}

.mapboxgl-ctrl-logo {
  display: none !important;
}

.mapboxgl-ctrl-geolocate {
  display: none !important;
}
</style>
