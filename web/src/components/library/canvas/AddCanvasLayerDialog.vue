<script setup lang="ts">
/**
 * Adding a layer to a canvas.
 *
 * The list is deliberately ordered by what people reach for: bring your own
 * data first, then draw it, then borrow something that already exists. Each
 * option either returns a finished layer or hands off — designing a style
 * layer opens the layer editor, drawing arms the map.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { ItemIcon } from '@/components/ui/item-icon'
import { ITEM_ROW_SURFACES } from '@/components/ui/item-row'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useLayersStore } from '@/stores/layers.store'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useRoutesStore } from '@/stores/library/routes.store'
import { useAppService } from '@/services/app.service'
import { fuzzyFilter, type ThemeColor } from '@/lib/utils'
import {
  ACCEPTED_EXTENSIONS,
  GeoImportError,
  importGeoFile,
} from '@/lib/geo-import'
import {
  countGeometries,
  defaultStyleFor,
  inferRender,
} from '@/lib/map-style/data-presets'
import type { CanvasDataRender, CanvasLayer } from '@/types/canvas.types'
import {
  BookmarkIcon,
  ChevronLeftIcon,
  Layers3Icon,
  PenLineIcon,
  PencilRulerIcon,
  RouteIcon,
  SearchIcon,
  UploadIcon,
  UsersIcon,
} from 'lucide-vue-next'

const open = defineModel<boolean>('open', { required: true })

const emit = defineEmits<{
  /** A ready-made layer to append. */
  add: [layer: CanvasLayer]
  /** The user wants to author a new style layer in the editor. */
  createStyle: []
  /** The user wants to draw on the map. */
  draw: [render: CanvasDataRender]
}>()

const { t } = useI18n()
const layersStore = useLayersStore()
const collectionsStore = useCollectionsStore()
const routesStore = useRoutesStore()
const appService = useAppService()
const { layers } = storeToRefs(layersStore)
const { collections } = storeToRefs(collectionsStore)
const { routes } = storeToRefs(routesStore)

type Step = 'choose' | 'library' | 'collection' | 'route' | 'draw'
const step = ref<Step>('choose')
const query = ref('')
const importing = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

watch(open, isOpen => {
  if (isOpen) return
  step.value = 'choose'
  query.value = ''
})

const OPTIONS = [
  { id: 'import', icon: UploadIcon },
  { id: 'draw', icon: PencilRulerIcon },
  { id: 'collection', icon: BookmarkIcon },
  { id: 'route', icon: RouteIcon },
  { id: 'people', icon: UsersIcon },
  { id: 'library', icon: Layers3Icon },
  { id: 'style', icon: PenLineIcon },
] as const

const DRAW_MODES: readonly CanvasDataRender[] = ['points', 'lines', 'shapes']

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
  return `cl-${Math.random().toString(36).slice(2, 10)}`
}

function choose(id: (typeof OPTIONS)[number]['id']) {
  if (id === 'style') {
    emit('createStyle')
    open.value = false
    return
  }
  if (id === 'import') {
    fileInput.value?.click()
    return
  }
  if (id === 'people') {
    emit('add', { id: newId(), kind: 'people', visible: true })
    open.value = false
    return
  }
  step.value = id
}

async function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Reset immediately so picking the same file twice still fires.
  input.value = ''
  if (!file) return

  importing.value = true
  try {
    const result = await importGeoFile(file)
    const render = inferRender(countGeometries(result.collection))
    emit('add', {
      id: newId(),
      kind: 'data',
      // The filename minus its extension is a better default name than
      // anything we could invent, and it's what the user will recognise.
      name: file.name.replace(/\.[^.]+$/, ''),
      visible: true,
      render,
      data: result.collection,
      origin: { format: result.format, filename: file.name },
      style: defaultStyleFor(render),
    })
    open.value = false
  } catch (error) {
    appService.toast.error(
      error instanceof GeoImportError
        ? t(`canvases.import.errors.${error.key}`)
        : t('canvases.import.errors.failed'),
    )
  } finally {
    importing.value = false
  }
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

function startDrawing(render: CanvasDataRender) {
  emit('draw', render)
  open.value = false
}

const title = computed(() =>
  step.value === 'choose'
    ? t('canvases.add.title')
    : t(`canvases.add.options.${step.value}.title`),
)

const searchable = computed(() =>
  ['library', 'collection', 'route'].includes(step.value),
)
</script>

<template>
  <ResponsiveDialog
    v-model:open="open"
    :title="title"
    :description="step === 'choose' ? t('canvases.add.description') : undefined"
  >
    <template #content>
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        :accept="ACCEPTED_EXTENSIONS"
        @change="onFilePicked"
      />

      <div v-if="step === 'choose'" class="space-y-1.5">
        <button
          v-for="option in OPTIONS"
          :key="option.id"
          :disabled="importing"
          :class="[
            ITEM_ROW_SURFACES.tile,
            'w-full flex items-start gap-3 p-3 text-left transition-colors hover:bg-secondary/40 disabled:opacity-60',
          ]"
          @click="choose(option.id)"
        >
          <Spinner
            v-if="option.id === 'import' && importing"
            class="size-4 mt-0.5"
          />
          <component
            v-else
            :is="option.icon"
            class="size-4 mt-0.5 text-muted-foreground"
          />
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

        <!-- Pick what you're about to draw -->
        <div v-if="step === 'draw'" class="space-y-1.5">
          <button
            v-for="render in DRAW_MODES"
            :key="render"
            :class="[
              ITEM_ROW_SURFACES.tile,
              'w-full flex items-center gap-3 p-3 text-left transition-colors hover:bg-secondary/40',
            ]"
            @click="startDrawing(render)"
          >
            <span class="min-w-0">
              <span class="block text-sm font-medium">
                {{ t(`canvases.draw.modes.${render}.title`) }}
              </span>
              <span class="block text-xs text-muted-foreground leading-snug">
                {{ t(`canvases.draw.modes.${render}.description`) }}
              </span>
            </span>
          </button>
        </div>

        <template v-else>
          <div v-if="searchable" class="relative">
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

            <template v-else-if="step === 'route'">
              <button
                v-for="route in filteredRoutes"
                :key="route.id"
                :class="[
                  ITEM_ROW_SURFACES.tile,
                  'w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/40 transition-colors',
                ]"
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
        </template>
      </div>
    </template>
  </ResponsiveDialog>
</template>
