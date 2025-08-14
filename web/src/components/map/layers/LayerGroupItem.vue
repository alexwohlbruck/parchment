<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useLayersStore } from '@/stores/layers.store'
import { useLayersService } from '@/services/layers.service'
import { useAppService } from '@/services/app.service'
import type { LayerGroupWithLayers, Layer } from '@/types/map.types'
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

interface Props {
  group: LayerGroupWithLayers
  expanded: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  toggleExpanded: [groupId: string]
}>()

const { t } = useI18n()
const layersStore = useLayersStore()
const layersService = useLayersService()
const appService = useAppService()
const mapService = useMapService()

function isDefaultGroup(id: string, name: string): boolean {
  return id?.startsWith('reserved:') || name === 'Mapillary'
}

// Helper function to convert icon string name to Vue component
function getIconComponent(iconName?: string | null) {
  if (!iconName) return null

  const fullName = iconName.endsWith('Icon') ? iconName : `${iconName}Icon`

  const isValidIcon =
    fullName !== 'icons' &&
    typeof LucideIcons[fullName as keyof typeof LucideIcons] === 'function'

  return isValidIcon ? LucideIcons[fullName as keyof typeof LucideIcons] : null
}

const { groupDragOptions, onDragStart, onDragEnd, onDragMove, getLayerKey } =
  useDragAndDrop()

function getGroupVisibility(): boolean {
  return props.group.showInLayerSelector
}

async function updateGroupVisibility(visible: boolean) {
  await layersService.setGroupShownInSelector(props.group, layersStore, visible)
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

// Simple drag handler for group layers
async function handleGroupLayersChange(evt: any) {
  if (evt.added) {
    // Layer dropped into this group
    const layerId = evt.added.element.id
    const newIndex = evt.added.newIndex
    await layersStore.handleLayerMove(layerId, props.group.id, newIndex)
  } else if (!evt.added && !evt.removed) {
    // Pure reorder within group
    await layersStore.handleGroupReorder(props.group.id, props.group.layers)
  }
}

function handleUngroupLayer(layerId: string) {
  // Move layer to ungrouped at the end
  layersStore.handleLayerMove(layerId, null, 999) // Large number to put at end
}
</script>

<template>
  <div
    class="border border-border rounded-lg bg-background transition-colors select-none"
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
            class="size-3 text-muted-foreground"
          />
          <ChevronDownIcon v-else class="size-3 text-muted-foreground" />

          <!-- Group Icon & Name -->
          <component
            v-if="getIconComponent(group.icon)"
            :is="getIconComponent(group.icon)"
            class="size-4"
          />
          <FolderIcon v-else class="size-4" />
          <span class="text-sm font-medium">{{ group.name }}</span>
          <div class="ml-auto flex items-center gap-2">
            <span
              class="inline-flex items-center justify-center h-5 w-6 rounded bg-muted text-muted-foreground text-xs tabular-nums"
            >
              {{ group.layers.length }}
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
            v-model="group.layers"
            v-bind="groupDragOptions"
            @start="onDragStart"
            @end="onDragEnd"
            @move="onDragMove"
            @change="handleGroupLayersChange"
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
.draggable-container {
  -webkit-overflow-scrolling: touch;
}

.drag-chosen {
  user-select: none;
}
</style>
