<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useLayersStore } from '@/stores/layers.store'
import { useDragAndDrop } from '@/composables/useDragAndDrop'
import { useDragState } from '@/composables/useDragState'
import type { Layer, LayerGroup } from '@/types/map.types'
import { groupSubtreeMatches, matchesQuery } from '@/lib/layer-search'
import LayerItemComponent from './layers/LayerItem.vue'
import LayerGroupItem from './layers/LayerGroupItem.vue'
import { FolderIcon } from 'lucide-vue-next'
import draggable from 'vuedraggable'
import { TooltipProvider } from '@/components/ui/tooltip'

// `filter` is the library search query. Reordering is disabled while a search
// is active, and non-matching rows are hidden rather than removed so the drag
// model stays intact.
const props = defineProps<{ filter?: string }>()

const layersStore = useLayersStore()
const { mainReorderableItems, groupsWithLayers, groupTree } = storeToRefs(layersStore)
const { t } = useI18n()
const { isDragActive } = useDragState()

const query = computed(() => (props.filter ?? '').trim().toLowerCase())
const isFiltering = computed(() => query.value.length > 0)

function itemMatches(item: Layer | LayerGroup): boolean {
  if (!isFiltering.value) return true
  if ('groupId' in item) return matchesQuery(item.name, query.value)
  return groupSubtreeMatches(getGroupForElement(item), query.value)
}

const hasMatches = computed(() =>
  !isFiltering.value || draggableItems.value.some(itemMatches),
)

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
  <TooltipProvider>
    <div class="h-full flex flex-col">
      <div class="space-y-1 flex-1 min-h-0">
        <draggable
          v-if="draggableItems?.length > 0"
          v-model="draggableItems"
          v-bind="mainDragOptions"
          :disabled="isFiltering"
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
              v-show="itemMatches(element)"
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
                :filter="filter"
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

        <div
          v-else-if="isFiltering && !hasMatches"
          class="text-center py-8 text-muted-foreground"
        >
          <p class="text-sm">{{ t('layers.search.noResults') }}</p>
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
