<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
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
import {
  FolderIcon,
  PlusIcon,
  LayersIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
} from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import draggable from 'vuedraggable'
import { TooltipProvider } from '@/components/ui/tooltip'

const appService = useAppService()
const layersStore = useLayersStore()
const { mainReorderableItems, groupsWithLayers, groupTree } = storeToRefs(layersStore)
const { t } = useI18n()
const { isDragActive } = useDragState()

const isProd = import.meta.env.PROD

const hasTeleportTarget = ref(false)
onMounted(() => {
  hasTeleportTarget.value = !!document.getElementById('library-tab-actions')
})

function openLayerConfigDialog(layerId?: string) {
  appService.componentDialog({
    component: LayerConfiguration,
    continueText: t('general.save'),
    props: { layerId },
  })
}

function openLayerGroupConfigDialog(groupId?: string) {
  appService.componentDialog({
    component: LayerGroupConfiguration,
    continueText: t('general.save'),
    props: { groupId },
  })
}

async function restoreDefaults() {
  const result = await layersStore.restoreDefaults()
  appService.toast.success(
    t('layers.restoreDefaults.success', { count: result.restoredLayers + result.restoredGroups }),
  )
}

// Track expanded groups
const expandedGroups = ref(new Set<string>())

// Local draggable array that syncs with the store but allows vuedraggable to modify it
const draggableItems = ref<(Layer | LayerGroup)[]>([])

// Sync with store data when it changes. We intentionally do NOT use
// `deep: true` here: `mainReorderableItems` is a computed that already
// rebuilds (new array identity) whenever the underlying layers/groups
// change, so a shallow watch fires on every meaningful update. A deep
// watch forces Vue to walk every reactive proxy on every micro-change
// (e.g. toggling visibility) and was causing multi-second hangs.
watch(
  mainReorderableItems,
  newItems => {
    draggableItems.value = [...newItems]
  },
  { immediate: true },
)

// Drag and drop composable
const {
  isDragging,
  mainDragOptions,
  onDragStart,
  onDragEnd,
  onDragMove,
  getLayerKey,
} = useDragAndDrop()

function findGroupTreeNode(groupId: string, nodes?: any[]): any {
  const searchNodes = nodes ?? groupTree.value
  for (const node of searchNodes) {
    if (node.id === groupId) return node
    if (node.children?.length) {
      const found = findGroupTreeNode(groupId, node.children)
      if (found) return found
    }
  }
  return null
}

function getGroupForElement(element: LayerGroup): any {
  const treeNode = findGroupTreeNode(element.id)
  if (treeNode) return treeNode
  const gwl = groupsWithLayers.value.find(g => g.id === element.id)
  if (gwl) return { ...gwl, children: [] }
  // Fallback: construct a minimal group node. Hitting this branch means the
  // element is in the draggable array but the store's merged pipeline no
  // longer knows about it — usually a stale reactive snapshot during a move.
  // Warn so we notice if it starts firing consistently (indicates a desync).
  console.warn(
    '[Layers] getGroupForElement fallback: group not found in merged state',
    element.id,
  )
  return { ...element, layers: [], children: [] }
}

function toggleGroup(groupId: string) {
  if (expandedGroups.value.has(groupId)) {
    expandedGroups.value.delete(groupId)
  } else {
    expandedGroups.value.add(groupId)
  }
}

// Drag handler for the main list (mixed layers + groups)
async function handleMainChange(evt: any) {
  if (evt.added) {
    const element = evt.added.element
    const newIndex = evt.added.newIndex

    if ('groupId' in element) {
      // Layer dropped from a group to the main (ungrouped) list
      await layersStore.handleLayerMove(element.id, null, newIndex)
    } else {
      // Group dropped from a parent group to the top level
      await layersStore.handleGroupMove(element.id, null, newIndex)
    }
  } else if (evt.moved) {
    // Item reordered within the main list
    await layersStore.handleMainReorder(draggableItems.value)
  }
}
</script>

<template>
  <Teleport v-if="hasTeleportTarget" to="#library-tab-actions">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="icon" class="size-7" :disabled="isProd">
          <PlusIcon class="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem @click="openLayerConfigDialog()">
          <LayersIcon class="size-4" />
          {{ t('layers.actions.newLayer') }}
        </DropdownMenuItem>
        <DropdownMenuItem @click="openLayerGroupConfigDialog()">
          <FolderIcon class="size-4" />
          {{ t('layers.actions.newGroup') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="icon" class="size-7">
          <MoreHorizontalIcon class="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem @click="restoreDefaults">
          <RotateCcwIcon class="size-4" />
          {{ t('layers.actions.restoreDefaults') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </Teleport>

  <TooltipProvider>
    <div class="h-full flex flex-col">
      <div class="space-y-1 flex-1 min-h-0">
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
              <LayerGroupItem
                v-if="!('groupId' in element)"
                :group="getGroupForElement(element)"
                :expanded-groups="expandedGroups"
                @toggle-expanded="toggleGroup"
              />

              <div v-else class="border rounded-lg bg-background">
                <LayerItemComponent :layer="element" />
              </div>
            </div>
          </template>
        </draggable>

        <div
          v-if="!draggableItems?.length"
          class="text-center py-8 text-muted-foreground"
        >
          <FolderIcon class="size-8 mx-auto mb-2 opacity-50" />
          <p class="text-sm">{{ t('layers.empty.message') }}</p>
        </div>
      </div>
    </div>
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
