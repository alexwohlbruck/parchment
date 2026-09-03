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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { EmptyState } from '@/components/ui/empty-state'
import ItemIcon from '@/components/ui/item-icon/ItemIcon.vue'
import { useMapStore } from '@/stores/map.store'
import { useLayersStore } from '@/stores/layers.store'
import { useLayersService } from '@/services/layers/layers.service'
import { useMapService } from '@/services/map.service'
import { basemaps } from '../map/map.data'
import { Basemap } from '@/types/map.types'
import type { Layer, LayerGroup } from '@/types/map.types'
import {
  isVirtualLayerId,
  SAVED_PLACES_GROUP_ID,
} from '@/lib/saved-places-layers'
import { canvasIdFromLayerId, CANVASES_GROUP_ID } from '@/lib/canvas-layers'
import { useCanvasesStore } from '@/stores/library/canvases.store'
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
import { BookmarkIcon, Paintbrush2Icon } from 'lucide-vue-next'

const layersStore = useLayersStore()
const layersService = useLayersService()
const mapStore = useMapStore()
const mapService = useMapService()
const portolanStore = usePortolanTransitStore()
const canvasesStore = useCanvasesStore()
const { t } = useI18n()

const {
  layers,
  allLayerGroups,
  mainReorderableItems,
  groupTree,
  savedPlacesMeta,
  canvasesMeta,
} = storeToRefs(layersStore)

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
  // A canvas is already switched on and off from the library, and that state
  // lives in the canvases store. Writing an override here as well would make
  // this row and the library two answers to one question.
  const canvasId = canvasIdFromLayerId(layer.id)
  if (canvasId) {
    canvasesStore.setActive(canvasId, visible)
    return
  }

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
  const meta =
    savedPlacesMeta.value.get(layer.id) ?? canvasesMeta.value.get(layer.id)
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
  ].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name),
  )

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
const mapLayerNodes = computed<SelectorNode[]>(() => {
  const result: SelectorNode[] = []

  for (const item of mainReorderableItems.value) {
    const isGroup = !('groupId' in item)

    if (isGroup) {
      if (item.id === SAVED_PLACES_GROUP_ID || item.id === CANVASES_GROUP_ID) {
        continue
      }
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

function selectorGroup(id: string): SelectorNode | null {
  const treeNode = findGroupNode(id, groupTree.value)
  if (!treeNode?.showInLayerSelector) return null
  return groupNode(treeNode)
}

const collectionsNode = computed(() => selectorGroup(SAVED_PLACES_GROUP_ID))
const collectionNodes = computed(() => collectionsNode.value?.children ?? [])
const collectionPlaceCount = computed(() =>
  collectionNodes.value.reduce((total, node) => total + (node.count ?? 0), 0),
)

const canvasesNode = computed(() => selectorGroup(CANVASES_GROUP_ID))
const canvasNodes = computed(() => canvasesNode.value?.children ?? [])
const canvasItemCount = computed(() =>
  canvasNodes.value.reduce((total, node) => total + (node.count ?? 0), 0),
)

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
  <div class="flex min-w-0 flex-col overflow-hidden">
    <Tabs default-value="map" class="min-h-0">
      <div class="flex items-end border-b px-3 pt-2.5">
        <TabsList variant="linear" class="w-full gap-2 border-b-0 sm:gap-5">
          <TabsTrigger value="map" variant="linear" class="flex-1">
            {{ t('layers.selector.tabs.map') }}
          </TabsTrigger>
          <TabsTrigger
            value="collections"
            variant="linear"
            :count="collectionNodes.length || null"
            class="flex-1"
          >
            {{ t('layers.selector.tabs.collections') }}
          </TabsTrigger>
          <TabsTrigger
            value="canvases"
            variant="linear"
            :count="canvasNodes.length || null"
            class="flex-1"
          >
            {{ t('layers.selector.tabs.canvases') }}
          </TabsTrigger>
        </TabsList>
      </div>

      <ScrollArea class="h-[min(460px,calc(100vh-10rem))] min-h-[260px]">
        <TabsContent value="map" class="m-0 space-y-3 p-3 focus-visible:ring-0">
          <section class="space-y-2">
            <p class="px-0.5 text-xs font-medium text-muted-foreground">
              {{ t('layers.selector.baseMap') }}
            </p>

            <ToggleGroup
              type="single"
              :model-value="mapStore.settings.basemap"
              class="grid grid-cols-3 gap-2"
              @update:model-value="
                basemap => mapStore.setBasemap(basemap as Basemap)
              "
            >
              <ToggleGroupItem
                v-for="[basemapId, basemap] in Object.entries(basemaps)"
                :key="basemapId"
                :value="basemapId"
                :aria-label="
                  t('layers.selector.switchBasemap', { name: basemap.name })
                "
                variant="outline"
                class="h-16 flex-col gap-1.5 rounded-md border bg-card px-2 text-xs transition-colors hover:bg-muted/70 data-[state=on]:border-primary/50 data-[state=on]:bg-primary/10 data-[state=on]:text-foreground data-[state=on]:shadow-none"
              >
                <component :is="basemap.icon" class="size-4 shrink-0" />
                <span class="font-medium leading-none">{{ basemap.name }}</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </section>

          <section class="space-y-2">
            <p class="px-0.5 text-xs font-medium text-muted-foreground">
              {{ t('layers.selector.overlays') }}
            </p>
            <div class="space-y-0.5 rounded-md border bg-card/70 p-1">
              <template v-for="node in mapLayerNodes" :key="node.id">
                <LayerSelectorRow
                  :node="node"
                  :expanded="expanded"
                  @toggle-expanded="toggleExpanded"
                />
                <!-- The service-time control belongs to the Transit group: it
                     filters the portolan map to what actually runs at an instant. -->
                <TransitServiceTimeControl
                  v-if="
                    node.id === TRANSIT_GROUP_ID &&
                    node.visible &&
                    expanded.has(node.id)
                  "
                />
              </template>
            </div>
          </section>
        </TabsContent>

        <TabsContent
          value="collections"
          class="m-0 space-y-3 p-3 focus-visible:ring-0"
        >
          <template v-if="collectionsNode && collectionNodes.length">
            <div
              class="flex items-center gap-3 rounded-md border bg-primary/[0.04] p-2"
            >
              <ItemIcon
                icon="Bookmark"
                color="parchment"
                variant="ghost"
                size="xs"
              />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium">
                  {{ t('layers.selector.savedPlaces') }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{
                    t('layers.selector.placeCount', {
                      count: collectionPlaceCount,
                    })
                  }}
                </p>
              </div>
              <Switch
                :model-value="collectionsNode.visible"
                :aria-label="t('layers.selector.savedPlaces')"
                @update:model-value="collectionsNode.onToggle"
              />
            </div>

            <div class="space-y-0.5 rounded-md border bg-card/70 p-1">
              <LayerSelectorRow
                v-for="node in collectionNodes"
                :key="node.id"
                :node="node"
                :expanded="expanded"
                @toggle-expanded="toggleExpanded"
              />
            </div>
          </template>

          <EmptyState
            v-else
            :icon="BookmarkIcon"
            :title="t('layers.selector.emptyCollections.title')"
            :description="t('layers.selector.emptyCollections.description')"
            variant="inline"
          />
        </TabsContent>

        <TabsContent
          value="canvases"
          class="m-0 space-y-3 p-3 focus-visible:ring-0"
        >
          <template v-if="canvasesNode && canvasNodes.length">
            <div
              class="flex items-center gap-3 rounded-md border bg-primary/[0.04] p-2"
            >
              <ItemIcon
                icon="Shapes"
                color="parchment"
                variant="ghost"
                size="xs"
              />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium">
                  {{ t('layers.selector.showCanvases') }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{
                    t('layers.selector.canvasItemCount', {
                      count: canvasItemCount,
                    })
                  }}
                </p>
              </div>
              <Switch
                :model-value="canvasesNode.visible"
                :aria-label="t('layers.selector.showCanvases')"
                @update:model-value="canvasesNode.onToggle"
              />
            </div>

            <div class="space-y-0.5 rounded-md border bg-card/70 p-1">
              <LayerSelectorRow
                v-for="node in canvasNodes"
                :key="node.id"
                :node="node"
                :expanded="expanded"
                @toggle-expanded="toggleExpanded"
              />
            </div>
          </template>

          <EmptyState
            v-else
            :icon="Paintbrush2Icon"
            :title="t('canvases.empty.title')"
            :description="t('canvases.empty.description')"
            variant="inline"
          />
        </TabsContent>
      </ScrollArea>
    </Tabs>
  </div>
</template>
