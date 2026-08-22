<script setup lang="ts">
/**
 * Adding a layer to a canvas. Three ways in, and the choice comes first
 * because they are genuinely different things: authoring a new style layer,
 * borrowing one that already exists, or drawing a collection of saved places.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { ItemIcon } from '@/components/ui/item-icon'
import { ITEM_ROW_SURFACES } from '@/components/ui/item-row'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLayersStore } from '@/stores/layers.store'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { fuzzyFilter, type ThemeColor } from '@/lib/utils'
import type { CanvasLayer } from '@/types/canvas.types'
import {
  BookmarkIcon,
  ChevronLeftIcon,
  Layers3Icon,
  PenLineIcon,
  SearchIcon,
} from 'lucide-vue-next'

const open = defineModel<boolean>('open', { required: true })

const emit = defineEmits<{
  /** A ready-made layer to append. */
  add: [layer: CanvasLayer]
  /** The user wants to author a new style layer in the editor. */
  createStyle: []
}>()

const { t } = useI18n()
const layersStore = useLayersStore()
const collectionsStore = useCollectionsStore()
const { layers } = storeToRefs(layersStore)
const { collections } = storeToRefs(collectionsStore)

type Step = 'choose' | 'library' | 'collection'
const step = ref<Step>('choose')
const query = ref('')

watch(open, isOpen => {
  if (isOpen) return
  step.value = 'choose'
  query.value = ''
})

const OPTIONS = [
  { id: 'style', icon: PenLineIcon },
  { id: 'library', icon: Layers3Icon },
  { id: 'collection', icon: BookmarkIcon },
] as const

/**
 * Marker-rendered layers (friends, trackers, notes) and the client-side core
 * layers have no portable configuration, so they can't be borrowed onto a
 * canvas. Everything with a real style layer can.
 */
const borrowable = computed(() =>
  layers.value.filter(l => l.origin !== 'core' && l.origin !== 'virtual'),
)

const filteredLayers = computed(() =>
  query.value
    ? fuzzyFilter(borrowable.value, query.value, { keys: ['name'], preserveOrder: true })
    : borrowable.value,
)

const filteredCollections = computed(() =>
  query.value
    ? fuzzyFilter(collections.value, query.value, { keys: ['name'], preserveOrder: true })
    : collections.value,
)

function newId() {
  return `cl-${Math.random().toString(36).slice(2, 10)}`
}

function choose(id: (typeof OPTIONS)[number]['id']) {
  if (id === 'style') {
    emit('createStyle')
    open.value = false
    return
  }
  step.value = id
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

const title = computed(() =>
  step.value === 'choose'
    ? t('canvases.add.title')
    : t(`canvases.add.options.${step.value}.title`),
)
</script>

<template>
  <ResponsiveDialog
    v-model:open="open"
    :title="title"
    :description="step === 'choose' ? t('canvases.add.description') : undefined"
  >
    <template #content>
      <div v-if="step === 'choose'" class="space-y-1.5">
        <button
          v-for="option in OPTIONS"
          :key="option.id"
          :class="[
            ITEM_ROW_SURFACES.tile,
            'w-full flex items-start gap-3 p-3 text-left transition-colors hover:bg-secondary/40',
          ]"
          @click="choose(option.id)"
        >
          <component :is="option.icon" class="size-4 mt-0.5 text-muted-foreground" />
          <span class="min-w-0">
            <span class="block text-sm font-medium">
              {{ t(`canvases.add.options.${option.id}.title`) }}
            </span>
            <span class="block text-xs text-muted-foreground leading-snug">
              {{ t(`canvases.add.options.${option.id}.description`) }}
            </span>
          </span>
        </button>
      </div>

      <div v-else class="space-y-3">
        <Button
          variant="ghost"
          size="sm"
          class="-ml-2 h-7 px-2 text-muted-foreground"
          @click="step = 'choose'"
        >
          <ChevronLeftIcon class="size-4" />
          {{ t('general.back') }}
        </Button>

        <div class="relative">
          <SearchIcon class="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input v-model="query" class="h-9 pl-8" :placeholder="t('general.search')" />
        </div>

        <div class="max-h-[45vh] overflow-y-auto -mx-1 px-1 space-y-1">
          <template v-if="step === 'library'">
            <button
              v-for="layer in filteredLayers"
              :key="layer.id"
              :class="[
                ITEM_ROW_SURFACES.tile,
                'w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/40 transition-colors',
              ]"
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

          <template v-else>
            <button
              v-for="collection in filteredCollections"
              :key="collection.id"
              :class="[
                ITEM_ROW_SURFACES.tile,
                'w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/40 transition-colors',
              ]"
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
