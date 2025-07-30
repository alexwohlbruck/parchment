<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMapStore } from '@/stores/map.store'
import { useAppService } from '@/services/app.service'
import type { LayerGroup, Layer } from '@/types/map.types'
import { useDragAndDrop } from '@/composables/useDragAndDrop'
import LayerItemComponent from './LayerItem.vue'
import LayerGroupConfiguration from './LayerGroupConfiguration.vue'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  FolderIcon,
  PencilIcon,
  TrashIcon,
} from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import draggable from 'vuedraggable'

interface Props {
  group: LayerGroup & { layers: Layer[] }
  expanded: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  toggleExpanded: [groupId: string]
  ungroupLayer: [layerId: string]
}>()

const { t } = useI18n()
const mapStore = useMapStore()
const appService = useAppService()
const {
  groupDragOptions,
  onDragStart,
  onDragEnd,
  onDragMove,
  handleGroupChange,
  getLayerKey,
  layerToDragItem,
} = useDragAndDrop()

// Get group layers as a writable ref for v-model
const groupLayers = computed({
  get: () => props.group.layers,
  set: (newLayers: Layer[]) => {
    // Update the order based on the new array position
    newLayers.forEach((layer, index) => {
      const layerId = layer.configuration?.id
      if (layerId) {
        const layerIndex = mapStore.layers.findIndex(
          l => l.configuration?.id === layerId,
        )
        if (layerIndex !== -1) {
          mapStore.layers[layerIndex].order = index
        }
      }
    })
  },
})

function getGroupVisibility(): boolean {
  return props.group.showInLayerSelector
}

function updateGroupVisibility(visible: boolean) {
  mapStore.toggleLayerGroupEnabled(props.group.id, visible)
}

function openLayerGroupConfigDialog() {
  appService.componentDialog({
    component: LayerGroupConfiguration,
    continueText: t('general.save'),
    props: {
      groupId: props.group.id,
    },
  })
}

function deleteGroup() {
  mapStore.removeLayerGroup(props.group.id)
}

function handleToggleExpanded() {
  emit('toggleExpanded', props.group.id)
}

function handleUngroupLayer(layerId: string) {
  emit('ungroupLayer', layerId)
}

function onGroupLayersChange(evt: any) {
  handleGroupChange(props.group.id, evt, groupLayers.value)
}
</script>

<template>
  <div class="border border-border rounded-lg bg-background transition-colors">
    <Collapsible :open="expanded">
      <div class="flex items-center p-2 rounded-t-lg">
        <!-- Expand/Collapse Button -->
        <CollapsibleTrigger
          @click.stop="handleToggleExpanded"
          class="flex items-center gap-2 flex-1 text-left cursor-pointer"
        >
          <ChevronRightIcon
            v-if="!expanded"
            class="size-3 text-muted-foreground"
          />
          <ChevronDownIcon v-else class="size-3 text-muted-foreground" />

          <!-- Group Icon & Name -->
          <component v-if="group.icon" :is="group.icon" class="size-4" />
          <FolderIcon v-else class="size-4" />
          <span class="text-sm font-medium">{{ group.name }}</span>
          <span class="text-xs text-muted-foreground ml-auto">
            ({{ group.layers.length }})
          </span>
        </CollapsibleTrigger>

        <!-- Group Visibility Toggle -->
        <Switch
          :model-value="getGroupVisibility()"
          @update:model-value="updateGroupVisibility"
          @click.stop
          @mousedown.stop
          class="mx-2"
        />

        <!-- Group Actions -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 w-6 p-0"
              @click.stop
              @mousedown.stop
            >
              <MoreHorizontalIcon class="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @click="openLayerGroupConfigDialog">
              <PencilIcon class="size-3 mr-2" />
              {{ t('layers.actions.editGroup') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="deleteGroup" class="text-destructive">
              <TrashIcon class="size-3 mr-2" />
              {{ t('layers.actions.deleteGroup') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <!-- Group Layers -->
      <CollapsibleContent>
        <div class="border-t border-border">
          <draggable
            v-model="groupLayers"
            v-bind="groupDragOptions"
            @start="onDragStart"
            @end="onDragEnd"
            @move="onDragMove"
            @change="onGroupLayersChange"
            :item-key="getLayerKey"
            class="min-h-[40px] draggable-container"
            tag="div"
          >
            <template #item="{ element }">
              <div class="draggable-item">
                <LayerItemComponent
                  :key="getLayerKey(element)"
                  :layer="element"
                  :group-id="group.id"
                  :compact="true"
                  :show-ungroup-action="true"
                  @ungroup="handleUngroupLayer"
                />
              </div>
            </template>
          </draggable>
        </div>
      </CollapsibleContent>
    </Collapsible>
  </div>
</template>

<style scoped>
/* Prevent scrolling issues on iOS */
.draggable-container {
  -webkit-overflow-scrolling: touch;
}

/* Improve touch target sizes for mobile */
@media (hover: none) and (pointer: coarse) {
  .draggable-item {
    min-height: 44px; /* Apple recommended minimum touch target */
  }

  /* Prevent text selection during drag */
  .drag-active,
  .drag-chosen {
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }
}
</style>
