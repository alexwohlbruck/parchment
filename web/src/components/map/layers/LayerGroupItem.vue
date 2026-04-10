<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLayersStore } from '@/stores/layers.store'
import { useLayersService } from '@/services/layers/layers.service'
import { useAppService } from '@/services/app.service'
import type { LayerGroupWithLayers, LayerGroup, Layer } from '@/types/map.types'
import { useDragAndDrop } from '@/composables/useDragAndDrop'
import * as LucideIcons from 'lucide-vue-next'
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
import { useMapService } from '@/services/map.service'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'

interface GroupTreeNode extends LayerGroupWithLayers {
  children?: GroupTreeNode[]
}

interface Props {
  group: GroupTreeNode
  expandedGroups: Set<string>
  depth?: number
}

const props = withDefaults(defineProps<Props>(), {
  depth: 0,
})

const emit = defineEmits<{
  toggleExpanded: [groupId: string]
}>()

const { t } = useI18n()
const layersStore = useLayersStore()
const layersService = useLayersService()
const appService = useAppService()
const mapService = useMapService()

const expanded = computed(() => props.expandedGroups.has(props.group.id))

const childGroups = computed(() => props.group.children ?? [])

// Build mixed items list: child groups + layers, sorted by order.
// The group tree is recomputed in the store whenever its inputs change, so
// `props.group.layers`/`props.group.children` already get fresh array
// identities on every meaningful update. A shallow watch is sufficient —
// `deep: true` was forcing Vue to traverse every layer/group proxy per
// LayerGroupItem instance on every reactive tick and was a major source
// of UI hangs when many groups were mounted.
const mixedItems = ref<(Layer | LayerGroup)[]>([])

watch(
  [() => props.group.layers, () => props.group.children],
  () => {
    const layers = props.group.layers ?? []
    const groups = props.group.children ?? []
    const items: (Layer | LayerGroup)[] = [...layers, ...groups]
    mixedItems.value = items.sort((a, b) => a.order - b.order)
  },
  { immediate: true },
)

function isLayer(item: Layer | LayerGroup): item is Layer {
  return 'groupId' in item
}

function isGroup(item: Layer | LayerGroup): item is LayerGroup {
  return !('groupId' in item)
}

function getItemKey(item: Layer | LayerGroup): string {
  // Never use `Date.now()` as a fallback: vuedraggable uses this key to
  // diff list items, and a changing key would unmount/remount the row on
  // every render (breaking drag state and tanking perf). An item without
  // an id is a real bug — surface it with a warn and use a stable sentinel.
  if (isLayer(item)) {
    if (!item.id) {
      console.warn('[LayerGroupItem] layer item is missing an id', item)
      return 'layer-unknown'
    }
    return item.id
  }
  return `group-${item.id}`
}

function isDefaultGroup(id: string, name: string): boolean {
  return id?.startsWith('reserved:') || name === 'Mapillary'
}

function getIconComponent(iconName?: string | null) {
  if (!iconName) return null
  const fullName = iconName.endsWith('Icon') ? iconName : `${iconName}Icon`
  const icon = LucideIcons[fullName as keyof typeof LucideIcons]
  const isValidIcon = fullName !== 'icons' && typeof icon === 'function'
  return isValidIcon ? (icon as any) : null
}

const { groupDragOptions, onDragStart, onDragEnd, onDragMove, getLayerKey } =
  useDragAndDrop()

// NB: this switch reflects whether the group appears in the layer selector
// (i.e. `showInLayerSelector`), not the group's map visibility. It's
// deliberately named to avoid confusion with the toggle used by
// `LayersSelector.vue` which drives on-map visibility.
function getGroupEnabledForSelector(): boolean {
  return props.group.showInLayerSelector
}

async function updateGroupEnabledForSelector(enabled: boolean) {
  await layersService.setGroupShownInSelector(props.group, layersStore, enabled)
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
  layersStore.removeLayerGroup(props.group.id)
}

function handleToggleExpanded() {
  emit('toggleExpanded', props.group.id)
}

// Handle drag changes for the mixed items list
async function handleMixedChange(evt: any) {
  if (evt.added) {
    const element = evt.added.element
    const newIndex = evt.added.newIndex

    if (isLayer(element)) {
      // Layer dropped into this group
      await layersStore.handleLayerMove(element.id, props.group.id, newIndex)
    } else {
      // Group dropped into this group as a child
      await layersStore.handleGroupMove(element.id, props.group.id, newIndex)
    }
  } else if (evt.moved) {
    // Reorder within this group
    await layersStore.handleMixedGroupReorder(props.group.id, mixedItems.value)
  }
}

function handleUngroupLayer(layerId: string) {
  layersStore.handleLayerMove(layerId, null, 999)
}

// Find a child group tree node by ID for recursive rendering.
// Falls back to a stub with empty layers/children so the type stays
// consistent if the tree node is momentarily missing during updates.
function findChildTreeNode(group: LayerGroup): GroupTreeNode {
  const found = childGroups.value.find(c => c.id === group.id) as
    | GroupTreeNode
    | undefined
  if (found) return found
  return { ...group, layers: [], children: [] }
}
</script>

<template>
  <div
    class="border border-border rounded-lg bg-background transition-colors select-none"
    :class="depth > 0 ? 'mt-1' : ''"
  >
    <Collapsible :open="expanded">
      <div class="flex items-center p-2 rounded-t-lg">
        <!-- Expand/Collapse Button -->
        <CollapsibleTrigger
          @click.stop="handleToggleExpanded"
          class="flex items-center gap-2 flex-1 text-left cursor-pointer"
        >
          <ChevronRightIcon
            v-if="!expanded"
            class="size-3 text-muted-foreground shrink-0"
          />
          <ChevronDownIcon v-else class="size-3 text-muted-foreground shrink-0" />

          <!-- Group Icon & Name -->
          <component
            v-if="getIconComponent(group.icon)"
            :is="getIconComponent(group.icon)"
            class="size-4 shrink-0"
          />
          <FolderIcon v-else class="size-4 shrink-0" />
          <span class="text-sm font-medium truncate">{{ group.name }}</span>
          <div class="ml-auto flex items-center gap-2 shrink-0">
            <span
              class="inline-flex items-center justify-center h-5 w-6 rounded bg-muted text-muted-foreground text-xs tabular-nums"
            >
              {{ layersStore.getGroupTotalLayerCount(group.id) }}
            </span>
            <Tooltip v-if="!isDefaultGroup(group.id, group.name)">
              <TooltipTrigger as-child>
                <span
                  class="inline-block w-1.5 h-1.5 rounded-full bg-primary align-middle"
                />
              </TooltipTrigger>
              <TooltipContent>
                <span>{{ t('layers.badges.custom') }}</span>
              </TooltipContent>
            </Tooltip>
          </div>
        </CollapsibleTrigger>

        <!-- Group "Show in layer selector" toggle (NOT on-map visibility). -->
        <Switch
          :model-value="getGroupEnabledForSelector()"
          @update:model-value="updateGroupEnabledForSelector"
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

      <!-- Group Content: Mixed draggable of layers + child groups -->
      <CollapsibleContent>
        <div class="border-t border-border">
          <draggable
            v-model="mixedItems"
            v-bind="groupDragOptions"
            @start="onDragStart"
            @end="onDragEnd"
            @move="onDragMove"
            @change="handleMixedChange"
            :item-key="getItemKey"
            class="min-h-[32px] draggable-container p-1 space-y-1"
            tag="div"
          >
            <template #item="{ element }">
              <div class="draggable-item">
                <!-- Child Group (recursive) -->
                <LayerGroupItem
                  v-if="isGroup(element)"
                  :group="findChildTreeNode(element)"
                  :expanded-groups="expandedGroups"
                  :depth="depth + 1"
                  @toggle-expanded="(id: string) => emit('toggleExpanded', id)"
                />

                <!-- Layer -->
                <LayerItemComponent
                  v-else
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
.draggable-container {
  -webkit-overflow-scrolling: touch;
}

.drag-chosen {
  user-select: none;
}
</style>
