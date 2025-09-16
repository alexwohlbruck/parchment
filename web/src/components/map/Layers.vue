<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useLayersStore } from '@/stores/layers.store'
import { useAppService } from '@/services/app.service'
import { useDragAndDrop } from '@/composables/useDragAndDrop'
import { useDragState } from '@/composables/useDragState'
import type { Layer, LayerGroup } from '@/types/map.types'
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
  RotateCcwIcon,
  MoreHorizontalIcon,
} from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import draggable from 'vuedraggable'
import { useLayersService } from '@/services/layers.service'
import { TooltipProvider } from '@/components/ui/tooltip'

const appService = useAppService()
const layersStore = useLayersStore()
const layersService = useLayersService()
const { mainReorderableItems, groupsWithLayers } = storeToRefs(layersStore)
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
  const count = await layersStore.populateUserLayerTemplates()
  appService.toast.success(
    t('layers.restoreDefaults.success', { count }),
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
  <TooltipProvider>
    <SettingsSection
      class="h-full"
      :title="t('settings.mapSettings.layers.title')"
      :description="t('settings.mapSettings.layers.description')"
      :frame="false"
    >
      <template v-slot:actions>
        <div class="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" size="sm" :disabled="isProd">
                <PlusIcon class="size-4 mr-2" />
                {{ t('layers.actions.new') }}
                <ChevronDownIcon class="size-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click="openLayerConfigDialog">
                <LayersIcon class="size-4" />
                {{ t('layers.actions.newLayer') }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="openLayerGroupConfigDialog">
                <FolderIcon class="size-4" />
                {{ t('layers.actions.newGroup') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon" class="size-8">
                <MoreHorizontalIcon class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click="restoreDefaults">
                <RotateCcwIcon class="size-4 mr-2" />
                {{ t('layers.actions.restoreDefaults') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </template>

      <div class="space-y-1 h-full">
        <!-- Main Reorderable List (Ungrouped Layers + Groups) -->
        <draggable
          v-if="draggableItems?.length > 0"
          v-model="draggableItems"
          v-bind="mainDragOptions"
          @start="onDragStart"
          @end="onDragEnd"
          @move="onDragMove"
          @change="handleMainChange"
          :item-key="
            item => ('groupId' in item ? getLayerKey(item) : `group-${item.id}`)
          "
          class="space-y-1 draggable-container"
          tag="div"
        >
          <template #item="{ element }">
            <div
              :key="
                'groupId' in element
                  ? getLayerKey(element)
                  : `group-${element.id}`
              "
              class="relative draggable-item"
            >
              <!-- Layer Group -->
              <LayerGroupItem
                v-if="!('groupId' in element)"
                :group="groupsWithLayers.find(g => g.id === element.id)!"
                :expanded="expandedGroups.has(element.id)"
                @toggle-expanded="toggleGroup"
              />

              <!-- Ungrouped Layer -->
              <div v-else class="border border-border rounded-lg bg-background">
                <LayerItemComponent :layer="element" />
              </div>
            </div>
          </template>
        </draggable>

        <!-- Empty State -->
        <div
          v-if="!draggableItems?.length"
          class="text-center py-8 text-muted-foreground"
        >
          <FolderIcon class="size-8 mx-auto mb-2 opacity-50" />
          <p class="text-sm">{{ t('layers.empty.message') }}</p>
        </div>
      </div>
    </SettingsSection>
  </TooltipProvider>
</template>

<style scoped>
.drag-ghost {
  opacity: 0;
}

.drag-chosen {
  user-select: none;
}

.drag-active {
  transform: rotate(1deg) scale(1.02);
}
</style>
