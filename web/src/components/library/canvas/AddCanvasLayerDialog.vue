<script setup lang="ts">
/**
 * Picking something that already exists to put on a canvas — a library layer,
 * a saved collection, a saved route.
 *
 * Choosing *what kind* of thing happens in the add menu, which is a dropdown:
 * a flat list of routes into the canvas reads far better there than as a
 * dialog you have to dismiss first. This is only the second step, once the
 * kind is settled, so it opens straight onto the right list.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { ItemIcon } from '@/components/ui/item-icon'
import { ITEM_ROW_SURFACES } from '@/components/ui/item-row'
import { Input } from '@/components/ui/input'
import { useLayersStore } from '@/stores/layers.store'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useRoutesStore } from '@/stores/library/routes.store'
import { fuzzyFilter, type ThemeColor } from '@/lib/utils'
import { newCanvasId, type CanvasLayer } from '@/types/canvas.types'
import { SearchIcon } from 'lucide-vue-next'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  /** Which list to show. Set by the add menu before opening. */
  step?: 'library' | 'collection' | 'route' | null
}>()

const emit = defineEmits<{ add: [layer: CanvasLayer] }>()

const { t } = useI18n()
const layersStore = useLayersStore()
const collectionsStore = useCollectionsStore()
const routesStore = useRoutesStore()
const { layers } = storeToRefs(layersStore)
const { collections } = storeToRefs(collectionsStore)
const { routes } = storeToRefs(routesStore)

const step = computed(() => props.step ?? 'library')
const query = ref('')

watch(open, isOpen => {
  if (!isOpen) query.value = ''
})

/**
 * Marker-rendered layers (friends, trackers, notes) and the client-side core
 * layers have no portable configuration, so they can't be borrowed onto a
 * canvas. Everything with a real style layer can.
 */
const borrowable = computed(() =>
  layers.value.filter(l => l.origin !== 'core' && l.origin !== 'virtual'),
)

function filtered<T>(items: T[]) {
  return query.value
    ? fuzzyFilter(items, query.value, { keys: ['name'], preserveOrder: true })
    : items
}

const filteredLayers = computed(() => filtered(borrowable.value))
const filteredCollections = computed(() => filtered(collections.value))
const filteredRoutes = computed(() => filtered(routes.value))

function newId() {
  return newCanvasId('cl')
}

function addLibraryLayer(layerId: string) {
  emit('add', { id: newId(), kind: 'library', layerId, visible: true })
  open.value = false
}

function addCollection(collectionId: string) {
  const collection = collections.value.find(c => c.id === collectionId)
  emit('add', {
    id: newId(),
    kind: 'collection',
    collectionId,
    visible: true,
    icon: collection?.icon ?? null,
    iconColor: collection?.iconColor ?? null,
  })
  open.value = false
}

function addRoute(routeId: string) {
  emit('add', { id: newId(), kind: 'route', routeId, visible: true })
  open.value = false
}

const rowClass = [
  ITEM_ROW_SURFACES.tile,
  'w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/40 transition-colors',
]
</script>

<template>
  <ResponsiveDialog
    v-model:open="open"
    :title="t(`canvases.add.options.${step}.title`)"
    :description="t(`canvases.add.options.${step}.description`)"
  >
    <template #content>
      <div class="space-y-3">
        <div class="relative">
          <SearchIcon
            class="absolute left-2.5 top-2.5 size-4 text-muted-foreground"
          />
          <Input
            v-model="query"
            class="h-9 pl-8"
            :placeholder="t('general.search')"
          />
        </div>

        <div class="max-h-[45vh] overflow-y-auto -mx-1 px-1 space-y-1">
          <template v-if="step === 'library'">
            <button
              v-for="layer in filteredLayers"
              :key="layer.id"
              :class="rowClass"
              @click="addLibraryLayer(layer.id)"
            >
              <ItemIcon :icon="layer.icon ?? 'Layers3Icon'" size="xs" />
              <span class="text-sm truncate">{{ layer.name }}</span>
            </button>
            <p
              v-if="!filteredLayers.length"
              class="py-6 text-center text-sm text-muted-foreground"
            >
              {{ t('canvases.add.noLayers') }}
            </p>
          </template>

          <template v-else-if="step === 'route'">
            <button
              v-for="route in filteredRoutes"
              :key="route.id"
              :class="rowClass"
              @click="addRoute(route.id)"
            >
              <ItemIcon icon="RouteIcon" color="forest" size="xs" />
              <span class="text-sm truncate">
                {{ route.name || t('canvases.layers.missing') }}
              </span>
            </button>
            <p
              v-if="!filteredRoutes.length"
              class="py-6 text-center text-sm text-muted-foreground"
            >
              {{ t('canvases.add.noRoutes') }}
            </p>
          </template>

          <template v-else>
            <button
              v-for="collection in filteredCollections"
              :key="collection.id"
              :class="rowClass"
              @click="addCollection(collection.id)"
            >
              <ItemIcon
                :icon="collection.icon ?? 'BookmarkIcon'"
                :color="(collection.iconColor as ThemeColor) ?? 'coral'"
                size="xs"
              />
              <span class="text-sm truncate">{{ collection.name }}</span>
            </button>
            <p
              v-if="!filteredCollections.length"
              class="py-6 text-center text-sm text-muted-foreground"
            >
              {{ t('canvases.add.noCollections') }}
            </p>
          </template>
        </div>
      </div>
    </template>
  </ResponsiveDialog>
</template>
