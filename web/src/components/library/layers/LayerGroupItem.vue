<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLayersStore } from '@/stores/layers.store'
import { useLayersService } from '@/services/layers/layers.service'
import { useAppService } from '@/services/app.service'
import type { LayerGroup, Layer } from '@/types/map.types'
import type { GroupTreeNode } from '@/lib/map/layer-tree'
import { groupSubtreeMatches, matchesQuery } from '@/lib/map/layer-search'
import { useDragAndDrop } from '@/composables/map/useDragAndDrop'
import * as LucideIcons from 'lucide-vue-next'
import LayerItemComponent from './LayerItem.vue'
import LayerGroupConfiguration from './LayerGroupConfiguration.vue'
import { Switch } from '@/components/ui/switch'
import { GroupRow } from '@/components/ui/group-row'
import { Button } from '@/components/ui/button'
import { MoreHorizontalIcon, PencilIcon, TrashIcon } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import draggable from 'vuedraggable'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'

interface Props {
  group: GroupTreeNode
  expandedGroups: Set<string>
  filter?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  toggleExpanded: [groupId: string]
}>()

const { t } = useI18n()
const layersStore = useLayersStore()
const layersService = useLayersService()
const appService = useAppService()

const query = computed(() => (props.filter ?? '').trim().toLowerCase())
const isFiltering = computed(() => query.value.length > 0)

// While searching, every rendered group is expanded so matches nested inside
// it are visible without the user having to open each one.
const expanded = computed(
  () => props.expandedGroups.has(props.group.id) || isFiltering.value,
)

const childGroups = computed(() => props.group.children ?? [])

// Build mixed items list: child groups + layers, sorted by order.
// The group tree is recomputed in the store whenever its inputs change, so
// `props.group.layers`/`props.group.children` already get fresh array
// identities on every meaningful update. A shallow watch is sufficient —
// `deep: true` was forcing Vue to traverse every layer/group proxy per
// LayerGroupItem instance on every reactive tick and was a major source
// of UI hangs when many groups were mounted.
const mixedItems = shallowRef<(Layer | LayerGroup)[]>([])

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

// When the group's own name matches, everything inside it stays visible;
// otherwise only the layers and child groups that match the query show.
function itemMatches(item: Layer | LayerGroup): boolean {
  if (!isFiltering.value) return true
  if (matchesQuery(props.group.name, query.value)) return true
  if (isLayer(item)) return matchesQuery(item.name, query.value)
  return groupSubtreeMatches(findChildTreeNode(item), query.value)
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

/** See `LayerItem.vue` — the same rules apply to groups. */
const isUserOwned = computed(() => props.group.origin === 'custom')
const isVirtual = computed(() => props.group.origin === 'virtual')

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
  if (!isUserOwned.value) return
  appService.componentDialog({
    component: LayerGroupConfiguration,
    continueText: t('general.save'),
    props: {
      groupId: props.group.id,
    },
  })
}

async function deleteGroup() {
  // Deleting a group takes the layers inside it, so this is worth confirming.
  const confirmed = await appService.confirm({
    title: t('layers.actions.deleteGroup'),
    description: t('library.confirmDelete', { name: props.group.name }),
    destructive: true,
  })
  if (!confirmed) return
  await layersStore.removeLayerGroup(props.group.id)
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
  <GroupRow
    :name="group.name"
    :expanded="expanded"
    :count="layersStore.getGroupTotalLayerCount(group.id)"
    :renameable="isUserOwned"
    @rename="layersStore.updateLayerGroup(group.id, { name: $event })"
    @update:expanded="handleToggleExpanded"
  >
    <template v-if="getIconComponent(group.icon)" #icon>
      <component
        :is="getIconComponent(group.icon)"
        class="size-4 shrink-0 text-muted-foreground"
      />
    </template>
    <template #details>
      <Tooltip v-if="isUserOwned">
        <TooltipTrigger as-child>
          <span
            class="inline-block w-1.5 h-1.5 rounded-full bg-primary align-middle"
          />
        </TooltipTrigger>
        <TooltipContent>{{ t('layers.badges.custom') }}</TooltipContent>
      </Tooltip>
    </template>
    <template #actions="{ startRename, onMenuClose }">
      <Switch
        :model-value="getGroupEnabledForSelector()"
        @update:model-value="updateGroupEnabledForSelector"
        @click.stop
        @mousedown.stop
        class="mx-1"
      />
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="size-7"
            :aria-label="t('general.more')"
            @click.stop
            @mousedown.stop
          >
            <MoreHorizontalIcon class="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" @close-auto-focus="onMenuClose">
          <template v-if="isUserOwned">
            <DropdownMenuItem @click="startRename">
              <PencilIcon class="size-3.5" />
              {{ t('general.rename') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="openLayerGroupConfigDialog">
              <PencilIcon class="size-3.5" />
              {{ t('layers.actions.editGroup') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </template>
          <DropdownMenuItem
            v-if="!isVirtual"
            @click="deleteGroup"
            class="text-destructive"
          >
            <TrashIcon class="size-3.5" />
            {{ t('layers.actions.deleteGroup') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>
    <draggable
      v-model="mixedItems"
      v-bind="groupDragOptions"
      :disabled="isFiltering"
      @start="onDragStart"
      @end="onDragEnd"
      @move="onDragMove"
      @change="handleMixedChange"
      :item-key="getItemKey"
      class="min-h-[32px] draggable-container space-y-1.5"
      tag="div"
    >
      <template #item="{ element }">
        <div v-show="itemMatches(element)" class="draggable-item">
          <LayerGroupItem
            v-if="isGroup(element)"
            :group="findChildTreeNode(element)"
            :expanded-groups="expandedGroups"
            :filter="filter"
            @toggle-expanded="(id: string) => emit('toggleExpanded', id)"
          />
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
  </GroupRow>
</template>

<style scoped>
.draggable-container {
  -webkit-overflow-scrolling: touch;
}
.drag-chosen {
  user-select: none;
}
</style>
