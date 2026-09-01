<script setup lang="ts">
/**
 * The map's layer selector (the popover behind the Layers control).
 *
 * Groups are expandable here rather than being a single opaque toggle, so a
 * group's switch acts as a master and each child keeps its own. That matters
 * most for saved places, where the children are the user's collections.
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useMapStore } from '@/stores/map.store'
import { useLayersStore } from '@/stores/layers.store'
import { useLayersService } from '@/services/layers/layers.service'
import { useMapService } from '@/services/map.service'
import { basemaps } from '../map/map.data'
import { Basemap } from '@/types/map.types'
import type { Layer, LayerGroup } from '@/types/map.types'
import { isVirtualLayerId } from '@/lib/saved-places-layers'
import { usePortolanTransitStore } from '@/stores/portolan.store'
import {
  CLASS_GROUP_ROW_ID_PREFIX,
  TRANSIT_CLASS_GROUPS,
  TRANSIT_GROUP_ID,
  type TransitClassGroup,
} from '@/services/layers/features/portolan/portolan-ui'
import LayerSelectorRow from './LayerSelectorRow.vue'
import TransitServiceTimeControl from './TransitServiceTimeControl.vue'
import type { SelectorNode } from './layer-selector.types'

const layersStore = useLayersStore()
const layersService = useLayersService()
const mapStore = useMapStore()
const mapService = useMapService()
const portolanStore = usePortolanTransitStore()
const { t } = useI18n()

const { layers, allLayerGroups, mainReorderableItems, groupTree, savedPlacesMeta } =
  storeToRefs(layersStore)

const expanded = ref(new Set<string>())

function toggleExpanded(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function getLayerId(layer: any): string {
  return layer?.configuration?.id || layer?.id
}

// ---------------------------------------------------------------------------
// Toggling
// ---------------------------------------------------------------------------

async function setLayerVisible(layer: Layer, visible: boolean) {
  // Virtual layers all share one map layer (the saved-places circle layer), so
  // the usual lookup-by-configuration-id would resolve the wrong row. They
  // carry no map layer of their own — flipping the override is the whole job,
  // and the saved-places source rebuilds off it.
  if (isVirtualLayerId(layer.id)) {
    layersStore.updateLayerVisibility(layer.id, visible)
    return
  }

  await layersService.setLayerVisibility(
    getLayerId(layer),
    layers.value,
    layersStore,
    mapService.mapStrategy,
    visible,
    allLayerGroups.value,
  )
}

async function setGroupVisible(group: LayerGroup, visible: boolean) {
  // Master switch, not a cascade: children keep their own state so turning the
  // group back on restores exactly what was showing before.
  if (isVirtualLayerId(group.id)) {
    layersStore.toggleLayerGroupVisibility(group.id, visible)
    return
  }

  await layersService.toggleLayerGroupVisibility(
    group,
    visible,
    layersStore,
    layers.value,
    mapService.mapStrategy,
    allLayerGroups.value,
  )
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

function layerNode(layer: Layer): SelectorNode {
  const meta = savedPlacesMeta.value.get(layer.id)
  return {
    id: layer.id,
    name: layer.name,
    icon: layer.icon,
    visible: layer.visible,
    count: meta?.count,
    meta,
    onToggle: (visible: boolean) => setLayerVisible(layer, visible),
  }
}

// The portolan transit classes, folded to the four toggles a rider thinks
// in. Not `layers` rows (they gate a client-side renderer, not tile-URL
// layers), so like osm-notes they're synthetic — but their state persists
// in the same visibility override map as everything else in this list.
const TRANSIT_CLASS_ICONS: Record<TransitClassGroup, string> = {
  rail: 'TrainFront',
  bus: 'Bus',
  ferry: 'Ship',
  other: 'CableCar',
}

function transitClassNodes(): SelectorNode[] {
  return TRANSIT_CLASS_GROUPS.map(group => ({
    id: CLASS_GROUP_ROW_ID_PREFIX + group,
    name: t(`layers.transit.${group}`),
    icon: TRANSIT_CLASS_ICONS[group],
    visible: portolanStore.classGroups[group],
    onToggle: (visible: boolean) =>
      portolanStore.setClassGroupVisible(group, visible),
  }))
}

function groupNode(node: any): SelectorNode {
  // Sort by the group tree's own `order` first — that's how "Frequents" pins
  // above the collections — and fall back to name for anything sharing one.
  // Sub-layers (casings, label twins, station infrastructure) ride their
  // group's master switch and stay out of the list.
  const children: SelectorNode[] = [
    ...(node.layers ?? [])
      .filter((l: Layer) => l.showInLayerSelector)
      .map((l: Layer) => ({ ...layerNode(l), order: l.order })),
    ...(node.children ?? []).map(g => ({ ...groupNode(g), order: g.order })),
  ].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))

  // The Transit group's primary children are the portolan class toggles.
  if (node.id === TRANSIT_GROUP_ID) {
    children.unshift(...transitClassNodes())
  }

  return {
    id: node.id,
    name: node.name,
    icon: node.icon,
    visible: node.visible,
    children,
    count: children.length,
    onToggle: (visible: boolean) => setGroupVisible(node, visible),
  }
}

/**
 * Groups and ungrouped layers, in the user's own order. Empty groups are
 * dropped — an expandable row with nothing inside is just a dead end.
 */
const nodes = computed<SelectorNode[]>(() => {
  const result: SelectorNode[] = []

  for (const item of mainReorderableItems.value) {
    const isGroup = !('groupId' in item)

    if (isGroup) {
      const treeNode = findGroupNode(item.id, groupTree.value)
      if (!treeNode || !treeNode.showInLayerSelector) continue
      if (layersStore.getGroupTotalLayerCount(item.id) === 0) continue
      result.push(groupNode(treeNode))
      continue
    }

    const layer = toRaw(item) as Layer
    if (!layer || layer.groupId || !layer.showInLayerSelector) continue
    result.push(layerNode(layer))
  }

  return result
})

function findGroupNode(id: string, tree: any[]): any {
  for (const node of tree) {
    if (node.id === id) return node
    if (node.children?.length) {
      const found = findGroupNode(id, node.children)
      if (found) return found
    }
  }
  return null
}
</script>

<template>
  <div class="space-y-5 min-w-0">
    <!-- Base map -->
    <div class="space-y-2">
      <p class="text-xs font-medium text-muted-foreground">Base map</p>
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
            class="flex flex-col items-center gap-2 p-3 h-16 justify-center text-center transition-all duration-200 hover:bg-muted data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm"
          >
            <component :is="basemap.icon" class="size-4 shrink-0" />
            <span class="font-medium text-xs leading-tight">{{
              basemap.name
            }}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>

    <!-- Layers -->
    <div class="space-y-1">
      <p class="text-xs font-medium text-muted-foreground">
        {{ $t('layers.title') }}
      </p>

      <div class="-mx-1">
        <template v-for="node in nodes" :key="node.id">
          <LayerSelectorRow
            :node="node"
            :expanded="expanded"
            @toggle-expanded="toggleExpanded"
          />
          <!-- The service-time control belongs to the Transit group: it
               filters the portolan map to what actually runs at an instant,
               so it appears under the expanded, enabled group. -->
          <TransitServiceTimeControl
            v-if="
              node.id === TRANSIT_GROUP_ID &&
              node.visible &&
              expanded.has(node.id)
            "
          />
        </template>
      </div>
    </div>
  </div>
</template>
