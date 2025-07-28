<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useMapStore } from '@/stores/map.store'
import { useAppService } from '@/services/app.service'
import { useDragAndDrop } from '@/composables/useDragAndDrop'
import type { LayerItem } from '@/types/map.types'
import LayerConfiguration from './layers/LayerConfiguration.vue'
import LayerGroupConfiguration from './layers/LayerGroupConfiguration.vue'
import LayerItemComponent from './layers/LayerItem.vue'
import LayerGroupItem from './layers/LayerGroupItem.vue'
import { Button } from '@/components/ui/button'
import SettingsSection from '@/components/settings/SettingsSection.vue'
import {
  ChevronDownIcon,
  PlusIcon,
  FolderIcon,
  LayersIcon,
} from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import draggable from 'vuedraggable'

const appService = useAppService()
const mapStore = useMapStore()
const { layerItems } = storeToRefs(mapStore)
const { t } = useI18n()

// Drag and drop composable
const {
  isDragging,
  mainDragOptions,
  onDragStart,
  onDragEnd,
  onDragMove,
  handleMainListChange,
  getLayerItemKey,
} = useDragAndDrop()

// Track expanded groups
const expandedGroups = ref(new Set<string>())

// Computed property for the main draggable list
const draggableLayerItems = computed({
  get: () => layerItems.value || [],
  set: (newItems: LayerItem[]) => {
    // Update order for all items based on their position in the array
    newItems.forEach((item, index) => {
      if (item.type === 'group') {
        mapStore.updateLayerGroup(item.data.id, { order: index })
      } else if (item.type === 'layer') {
        const layerId = item.data.configuration?.id
        if (layerId) {
          const layerIndex = mapStore.layers.findIndex(
            l => l.configuration?.id === layerId,
          )
          if (layerIndex !== -1) {
            mapStore.layers[layerIndex].order = index
          }
        }
      }
    })
  },
})

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

function toggleGroup(groupId: string) {
  if (expandedGroups.value.has(groupId)) {
    expandedGroups.value.delete(groupId)
  } else {
    expandedGroups.value.add(groupId)
  }
}

function createNewLayer() {
  openLayerConfigDialog()
}

function createNewGroup() {
  openLayerGroupConfigDialog()
}

function ungroupLayer(layerId: string) {
  mapStore.moveLayerToGroup(layerId, null)
}

function onMainChange(evt: any) {
  handleMainListChange(evt, draggableLayerItems.value)
}

// Prevent bottom sheet interaction during drag
function preventBottomSheetGesture(event: Event) {
  if (isDragging.value) {
    event.preventDefault()
    event.stopPropagation()
  }
}

// Add global event listeners to prevent bottom sheet interaction
onMounted(() => {
  document.addEventListener('touchstart', preventBottomSheetGesture, {
    passive: false,
  })
  document.addEventListener('touchmove', preventBottomSheetGesture, {
    passive: false,
  })
})

onUnmounted(() => {
  document.removeEventListener('touchstart', preventBottomSheetGesture)
  document.removeEventListener('touchmove', preventBottomSheetGesture)
})
</script>

<template>
  <SettingsSection
    :title="t('settings.mapSettings.layers.title')"
    :description="t('settings.mapSettings.layers.description')"
    :frame="false"
  >
    <template v-slot:actions>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm">
            <PlusIcon class="size-4 mr-2" />
            {{ t('layers.actions.new') }}
            <ChevronDownIcon class="size-4 ml-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem @click="createNewLayer">
            <LayersIcon class="size-4 mr-2" />
            {{ t('layers.actions.newLayer') }}
          </DropdownMenuItem>
          <DropdownMenuItem @click="createNewGroup">
            <FolderIcon class="size-4 mr-2" />
            {{ t('layers.actions.newGroup') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>

    <div class="space-y-2">
      <!-- Main Draggable Container -->
      <draggable
        v-if="layerItems?.length > 0"
        v-model="draggableLayerItems"
        v-bind="mainDragOptions"
        @start="onDragStart"
        @end="onDragEnd"
        @move="onDragMove"
        @change="onMainChange"
        :item-key="getLayerItemKey"
        class="space-y-2"
        tag="div"
      >
        <template #item="{ element }">
          <div :key="getLayerItemKey(element)" class="relative">
            <!-- Group Item -->
            <LayerGroupItem
              v-if="element.type === 'group'"
              :group="element.data"
              :expanded="expandedGroups.has(element.data.id)"
              @toggle-expanded="toggleGroup"
              @ungroup-layer="ungroupLayer"
            />

            <!-- Individual Layer Item -->
            <div
              v-else-if="
                element.type === 'layer' && element.data?.configuration
              "
              class="border border-border rounded-lg bg-background"
            >
              <LayerItemComponent
                :layer="element.data"
                @ungroup="ungroupLayer"
              />
            </div>
          </div>
        </template>
      </draggable>

      <!-- Empty State -->
      <div
        v-if="!layerItems?.length"
        class="text-center py-8 text-muted-foreground"
      >
        <FolderIcon class="size-8 mx-auto mb-2 opacity-50" />
        <p class="text-sm">{{ t('layers.empty.message') }}</p>
      </div>
    </div>
  </SettingsSection>
</template>

<style scoped>
/* Vue-draggable styling */
.drag-ghost {
  opacity: 0;
}

.drag-chosen {
}

.drag-active {
  transform: rotate(10deg);
}

/* Touch feedback improvements */
@media (hover: none) and (pointer: coarse) {
  .drag-chosen {
  }

  .drag-active {
    transform: rotate(2deg);
  }
}

/* Improve minimum touch targets */
.min-h-\[40px\] {
  min-height: 40px;
}

/* Smooth transitions */
.drag-ghost,
.drag-chosen,
.drag-active {
  transition: all 0.2s ease;
}
</style>
