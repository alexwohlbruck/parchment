<script setup lang="ts">
/**
 * A canvas, open for editing, in the sheet beside the map.
 *
 * The canvas's layers render on the map for as long as this view is mounted,
 * whether or not the canvas is switched on in the library — you are looking
 * at the thing you are arranging. Changes are held locally and written on
 * Save; leaving with unsaved work asks first, which is also what the sheet's
 * close button ends up doing.
 */
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { useHotkeys } from '@/composables/useHotkeys'
import { useUnits } from '@/composables/useUnits'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import draggable from 'vuedraggable'
import { AppRoute } from '@/router'
import { useCanvasesStore } from '@/stores/library/canvases.store'
import { useCanvasesService } from '@/services/library/canvases.service'
import { useCollectionsService } from '@/services/library/collections.service'
import { useAppService } from '@/services/app.service'
import { useMapStore } from '@/stores/map.store'
import { useCanvasRendering } from '@/composables/useCanvasRendering'
import * as turf from '@turf/turf'
import { useCanvasAnnotations } from '@/composables/useCanvasAnnotations'
import { useAnnotationEditing } from '@/composables/useAnnotationEditing'
import { useCanvasHistory } from '@/composables/useCanvasHistory'
import { useCanvasMapSettings } from '@/composables/useCanvasMapSettings'
import type { CanvasMapSettings } from '@/types/canvas.types'
import CanvasMapSettingsPanel from '@/components/library/canvas/CanvasMapSettings.vue'
import { useDrawOverlay } from '@/composables/useDrawOverlay'
import { annotationFeature } from '@/lib/canvas-annotations'
import { useRoutesService } from '@/services/library/routes.service'
import DetailPanelLayout from '@/components/layouts/DetailPanelLayout.vue'
import CanvasLayerRow from '@/components/library/canvas/CanvasLayerRow.vue'
import AddCanvasLayerDialog from '@/components/library/canvas/AddCanvasLayerDialog.vue'
import CanvasDialog from '@/components/library/canvas/CanvasDialog.vue'
import CanvasDataLayerSettings from '@/components/library/canvas/CanvasDataLayerSettings.vue'
import CanvasDataSourcesDialog from '@/components/library/canvas/CanvasDataSourcesDialog.vue'
import CanvasAnnotationRow from '@/components/library/canvas/CanvasAnnotationRow.vue'
import CanvasToolbar from '@/components/library/canvas/CanvasToolbar.vue'
import ResponsiveDropdown from '@/components/responsive/ResponsiveDropdown.vue'
import {
  countGeometries,
  defaultStyleFor,
  inferRender,
} from '@/lib/map-style/data-presets'
import type { DataSourceDefinition } from '@/lib/data-sources/catalogue'
import { ItemIcon } from '@/components/ui/item-icon'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import type { ThemeColor } from '@/lib/utils'
import {
  cloneCanvasBody,
  emptyCanvasBody,
  type CanvasAnnotation,
  type CanvasBody,
  type CanvasDataLayer,
  type CanvasDataOrigin,
  type CanvasLayer,
} from '@/types/canvas.types'
import {
  BookmarkIcon,
  CrosshairIcon,
  DatabaseIcon,
  Layers3Icon,
  LayersIcon,
  LockIcon,
  PenLineIcon,
  PencilIcon,
  PlusIcon,
  RouteIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-vue-next'

const props = defineProps<{ id: string }>()

const router = useRouter()
const { t } = useI18n()
const canvasesStore = useCanvasesStore()
const canvasesService = useCanvasesService()
const collectionsService = useCollectionsService()
const routesService = useRoutesService()
const { formatDistance } = useUnits()
const appService = useAppService()
const mapStore = useMapStore()
const { canvases } = storeToRefs(canvasesStore)

const canvas = computed(() => canvases.value.find(c => c.id === props.id))

/** The working copy. Nothing here reaches the server until Save. */
const body = ref<CanvasBody>(emptyCanvasBody())
const pristine = ref('')
const loading = ref(true)
const saving = ref(false)

function load() {
  body.value = cloneCanvasBody(canvas.value?.body)
  pristine.value = JSON.stringify(body.value)
  // Nothing before the canvas was opened is undoable.
  history.reset()
}



// A cold load (opened from a link, or after a reload) has neither the canvas
// nor the collections it references.
;(async () => {
  // A canvas can reference collections and routes, and a cold load has
  // neither — a row with no name is worse than a moment's spinner. One of
  // them failing must still let go of the spinner: a canvas whose routes
  // didn't load is worth editing, and this gate is what lets it save.
  try {
    await Promise.all([
      canvasesService.fetchCanvasById(props.id),
      collectionsService.fetchCollections(),
      routesService.fetchRoutes(),
    ])
  } finally {
    loading.value = false
  }
})()

const isDirty = computed(() => JSON.stringify(body.value) !== pristine.value)

// ── Annotations ──────────────────────────────────────────────────────────────

/**
 * Marks made on the canvas rather than data brought to it. They live in their
 * own bucket, so drawing never asks the user to create a layer first.
 */
/** The annotation whose properties are open for editing. */
const selectedAnnotationId = ref<string | null>(null)

const annotations = useCanvasAnnotations({
  onCommit(annotation: CanvasAnnotation) {
    body.value = {
      ...body.value,
      annotations: [...(body.value.annotations ?? []), annotation],
    }
    // Open the new mark straight away: naming is nearly always the next
    // thing, and hunting for the row you just created is friction.
    selectedAnnotationId.value = annotation.id
  },
})

/**
 * One undo stack over the whole editor — the canvas and whatever is
 * half-drawn on it. See `useCanvasHistory` for why they can't be separate.
 */
const history = useCanvasHistory({
  snapshot: () => ({
    body: body.value,
    drawing: annotations.snapshot(),
  }),
  restore: snapshot => {
    body.value = snapshot.body
    annotations.restore(snapshot.drawing)
  },
  busy: annotations.isBusy,
})

/**
 * Only a different canvas reloads the working copy.
 *
 * Saving upserts the canvas into the store, so watching the record itself
 * would reload — and reset the undo history — after every autosave.
 */
watch(() => canvas.value?.id, id => id && load(), { immediate: true })

/**
 * Reshaping a committed mark. Off while a tool is armed: a click then belongs
 * to the tool, not to whatever it happens to land on.
 */
const editing = useAnnotationEditing({
  annotations: computed(() => body.value.annotations ?? []),
  selectedId: selectedAnnotationId,
  enabled: computed(() => !annotations.isArmed.value),
  onChange: (id, patch) => patchAnnotation(id, patch),
})

// One surface, whichever is drawing on it. Reshaping wins while it is
// happening, since a tool cannot be armed at the same time.
useDrawOverlay(computed(() => editing.scene.value ?? annotations.scene.value))

// Esc drops the armed tool before it does anything else — the reflex when a
// tool is live is "get me out of this", not "leave this view".
useHotkeys([
  {
    key: 'esc',
    preventDefault: false,
    handler: () => {
      if (annotations.isArmed.value) annotations.disarm()
    },
  },
  { key: 'mod+z', handler: () => history.undo() },
  { key: 'mod+shift+z', handler: () => history.redo() },
  // What Windows reaches for, and harmless everywhere else.
  { key: 'mod+y', handler: () => history.redo() },
  { key: 'p', handler: () => annotations.arm('pin') },
  { key: 'l', handler: () => annotations.arm('line') },
  { key: 'r', handler: () => annotations.arm('route') },
  { key: 'o', handler: () => annotations.arm('polygon') },
  { key: 'e', handler: () => annotations.arm('rectangle') },
  { key: 'i', handler: () => annotations.arm('circle') },
  { key: 't', handler: () => annotations.arm('isochrone') },
  { key: 'd', handler: () => annotations.arm('doodle') },
])

function patchAnnotation(id: string, patch: Partial<CanvasAnnotation>) {
  body.value = {
    ...body.value,
    annotations: (body.value.annotations ?? []).map(annotation =>
      annotation.id === id ? { ...annotation, ...patch } : annotation,
    ),
  }
}

/** Fly to a mark. A canvas outgrows one screen quickly. */
function zoomToAnnotation(annotation: CanvasAnnotation) {
  const feature = annotationFeature(annotation)
  if (!feature) return
  const [minLng, minLat, maxLng, maxLat] = turf.bbox(feature as never)
  const strategy = mapStore.getMapStrategy()
  if (minLng === maxLng && minLat === maxLat) {
    strategy?.flyTo({ center: [minLng, minLat], zoom: 16 })
    return
  }
  strategy?.fitBounds({ minLng, minLat, maxLng, maxLat }, { padding: 96 })
}

function removeAnnotation(id: string) {
  if (selectedAnnotationId.value === id) selectedAnnotationId.value = null
  body.value = {
    ...body.value,
    annotations: (body.value.annotations ?? []).filter(a => a.id !== id),
  }
}

// Draw the working copy, so reordering and toggling read on the map at once.
// Claiming the canvas keeps the main map from drawing its saved version
// underneath the copy being edited.
canvasesStore.editingCanvasId = props.id
onScopeDispose(() => {
  canvasesStore.editingCanvasId = null
})

const { fitToLayer } = useCanvasRendering(
  computed(() =>
    canvas.value
      ? [
          {
            id: props.id,
            body: body.value,
            selectedAnnotationId: selectedAnnotationId.value,
            suppressedAnnotationId: editing.suppressedId.value,
          },
        ]
      : [],
  ),
  { key: 'canvas-editor' },
)

// ── Layer stack ──────────────────────────────────────────────────────────────

const layers = computed({
  get: () => body.value.layers,
  set: (next: CanvasLayer[]) => {
    body.value = { ...body.value, layers: next }
  },
})

function patchLayer(id: string, patch: Partial<CanvasLayer>) {
  layers.value = layers.value.map(l =>
    l.id === id ? ({ ...l, ...patch } as CanvasLayer) : l,
  )
}

function addLayer(layer: CanvasLayer) {
  layers.value = [...layers.value, layer]
  // Show what was just added. The render pass has to put it on the map first,
  // so this waits a tick rather than racing it.
  nextTick(() => fitToLayer(props.id, layer))
}

async function removeLayer(id: string) {
  layers.value = layers.value.filter(l => l.id !== id)
}

/** Style layers open the layer editor; data layers open their own settings. */
function editLayer(layer: CanvasLayer) {
  if (layer.kind === 'style') {
    router.push({
      name: AppRoute.LAYER_EDITOR,
      params: { id: layer.id },
      query: { canvas: props.id },
    })
    return
  }
  if (layer.kind === 'data') {
    editingDataLayerId.value = layer.id
  }
}

// ── Data layer settings ──────────────────────────────────────────────────────

const editingDataLayerId = ref<string | null>(null)

const editingDataLayer = computed<CanvasDataLayer | null>(() => {
  const found = layers.value.find(l => l.id === editingDataLayerId.value)
  return found?.kind === 'data' ? found : null
})

const dataSettingsOpen = computed({
  get: () => editingDataLayer.value !== null,
  set: (value: boolean) => {
    if (!value) editingDataLayerId.value = null
  },
})

function patchDataLayer(patch: Partial<CanvasDataLayer>) {
  if (!editingDataLayerId.value) return
  patchLayer(editingDataLayerId.value, patch as Partial<CanvasLayer>)
}


// ── Adding layers ────────────────────────────────────────────────────────────

const sourcesOpen = ref(false)
const addOpen = ref(false)
const pickerStep = ref<'library' | 'collection' | 'route' | null>(null)

function newLayerId() {
  return `cl-${Math.random().toString(36).slice(2, 10)}`
}

function createStyleLayer() {
  router.push({ name: AppRoute.LAYER_EDITOR_NEW, query: { canvas: props.id } })
}

/**
 * A source from the global library becomes a layer on this canvas: tiled
 * sources as a style layer, GeoJSON as a data layer pointed at the URL rather
 * than inlining it — some of these datasets are tens of megabytes.
 */
function addLibrarySource(source: DataSourceDefinition) {
  if (source.layer.type === 'style') {
    addLayer({
      id: newLayerId(),
      kind: 'style',
      name: source.name,
      visible: true,
      configuration: { ...source.layer.configuration },
    })
    return
  }

  addLayer({
    id: newLayerId(),
    kind: 'data',
    name: source.name,
    visible: true,
    render: source.layer.render,
    url: source.layer.url,
    data: { type: 'FeatureCollection', features: [] },
    origin: { format: 'geojson', filename: source.provider },
    style: defaultStyleFor(source.layer.render),
  })
}

/** A file or URL the sources browser already read and parsed. */
function addImportedData(result: {
  name: string
  collection: unknown
  format: string
}) {
  const collection = result.collection as CanvasDataLayer['data']
  const render = inferRender(countGeometries(collection))
  addLayer({
    id: newLayerId(),
    kind: 'data',
    name: result.name,
    visible: true,
    render,
    data: collection,
    origin: { format: result.format as CanvasDataOrigin['format'] },
    style: defaultStyleFor(render),
  })
}

function openPicker(step: 'library' | 'collection' | 'route') {
  pickerStep.value = step
  addOpen.value = true
}

/** The add-layer menu: a list of routes in, so a dropdown rather than a dialog. */
const addMenuItems = computed(() => [
  { type: 'label' as const, label: t('canvases.add.groups.data') },
  {
    type: 'item' as const,
    id: 'sources',
    label: t('canvases.add.options.sources.title'),
    icon: DatabaseIcon,
    onSelect: () => (sourcesOpen.value = true),
  },
  {
    type: 'item' as const,
    id: 'style',
    label: t('canvases.add.options.style.title'),
    icon: PenLineIcon,
    onSelect: createStyleLayer,
  },
  { type: 'separator' as const },
  { type: 'label' as const, label: t('canvases.add.groups.yours') },
  {
    type: 'item' as const,
    id: 'collection',
    label: t('canvases.add.options.collection.title'),
    icon: BookmarkIcon,
    onSelect: () => openPicker('collection'),
  },
  {
    type: 'item' as const,
    id: 'route',
    label: t('canvases.add.options.route.title'),
    icon: RouteIcon,
    onSelect: () => openPicker('route'),
  },
  {
    type: 'item' as const,
    id: 'library',
    label: t('canvases.add.options.library.title'),
    icon: Layers3Icon,
    onSelect: () => openPicker('library'),
  },
  {
    type: 'item' as const,
    id: 'people',
    label: t('canvases.add.options.people.title'),
    icon: UsersIcon,
    onSelect: () =>
      addLayer({ id: newLayerId(), kind: 'people', visible: true }),
  },
])

/**
 * The canvas's own map appearance, in force while it is open. Absent means it
 * follows whatever the app is set to.
 */
const mapSettings = useCanvasMapSettings(
  computed(() => body.value.mapSettings),
)

function setMapSettings(next: CanvasMapSettings | undefined) {
  body.value = { ...body.value, mapSettings: next }
}

/** Starting a canvas's own set from what the app is showing right now. */
function adoptMapSettings() {
  setMapSettings(mapSettings.currentSettings())
}

// ── Camera ───────────────────────────────────────────────────────────────────

/** Pin the canvas to the view it should open at. */
function saveCamera() {
  const camera = mapStore.mapCamera
  const center = camera.center as [number, number] | { lng: number; lat: number }
  body.value = {
    ...body.value,
    camera: {
      center: Array.isArray(center) ? center : [center.lng, center.lat],
      zoom: camera.zoom,
      bearing: camera.bearing,
      pitch: camera.pitch,
    },
  }
  appService.toast.success(t('canvases.cameraSaved'))
}

// ── Save ─────────────────────────────────────────────────────────────────────

const renameOpen = ref(false)

/**
 * A canvas saves itself.
 *
 * Nothing here is a document you finish and file — it is a map you arrange
 * while looking at it, and a Save button in front of that is a chance to
 * lose work rather than a safeguard. Writes are debounced so a drag is one
 * save rather than sixty, and a change made mid-save queues the next one.
 */
const SAVE_DEBOUNCE_MS = 900
let saveTimer: ReturnType<typeof setTimeout> | undefined
/** A change arrived while a save was in flight; go round again after it. */
let saveAgain = false

async function save() {
  if (!canvas.value) return
  if (saving.value) {
    saveAgain = true
    return
  }

  clearTimeout(saveTimer)
  saveTimer = undefined
  const attempted = JSON.stringify(body.value)
  saving.value = true
  try {
    const saved = await canvasesService.saveBody(canvas.value, body.value)
    // `pristine` records what actually reached the server, not what the
    // working copy holds now — it may have moved on while this was away.
    if (saved) pristine.value = attempted
  } finally {
    saving.value = false
    if (saveAgain) {
      saveAgain = false
      if (isDirty.value) void save()
    }
  }
}

watch(
  body,
  () => {
    if (!canvas.value || !isDirty.value) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS)
  },
  { deep: true },
)

// Closing the editor shouldn't drop the last second of work.
onScopeDispose(() => {
  clearTimeout(saveTimer)
  if (isDirty.value) void save()
})

/** Leaving is just a navigation now: whatever was open is already saved. */
function close() {
  router.push({ name: AppRoute.LIBRARY_CANVASES })
}

const displayName = computed(() => canvasesService.displayName(canvas.value))
</script>

<template>
  <DetailPanelLayout show-back-button @back="close">
    <template #title>
      <button
        class="flex items-center gap-2 min-w-0 group"
        @click="renameOpen = true"
      >
        <p class="text-lg font-semibold truncate">{{ displayName }}</p>
        <LockIcon
          v-if="canvas?.scheme === 'user-e2ee'"
          class="size-3.5 shrink-0 text-muted-foreground"
        />
        <PencilIcon
          class="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
        />
      </button>
    </template>

    <template #actions>
      <Button
        variant="ghost"
        size="icon"
        class="size-8"
        :title="t('canvases.saveCamera')"
        :aria-label="t('canvases.saveCamera')"
        @click="saveCamera"
      >
        <CrosshairIcon class="size-4" />
      </Button>
      <!-- A canvas saves itself; this only says where that got to. -->
      <span
        class="flex items-center gap-1.5 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <Spinner v-if="saving" class="size-3" />
        {{ saving ? t('canvases.saving') : isDirty ? '' : t('canvases.saved') }}
      </span>
    </template>

    <div v-if="loading && !canvas" class="py-12 flex justify-center">
      <Spinner />
    </div>

    <div v-else-if="!canvas" class="py-12">
      <EmptyState :icon="LayersIcon" :title="t('canvases.notFound')" />
    </div>

    <div v-else class="space-y-3">
      <div class="flex items-center gap-2.5">
        <ItemIcon
          :icon="canvas.icon ?? 'MapIcon'"
          :color="(canvas.iconColor as ThemeColor) ?? 'iris'"
          size="md"
        />
        <p class="text-sm text-muted-foreground flex-1 min-w-0">
          {{ canvas.description || t('canvases.noDescription') }}
        </p>
      </div>

      <ResponsiveDropdown :items="addMenuItems" align="start">
        <template #trigger>
          <Button variant="outline" size="sm" class="w-full">
            <PlusIcon class="size-3.5" />
            {{ t('canvases.add.trigger') }}
          </Button>
        </template>
      </ResponsiveDropdown>

      <!-- Bottom of the list is the top of the map, matching how the layer
           library already reads. -->
      <p v-if="layers.length" class="text-[11px] text-muted-foreground pt-1">
        {{ t('canvases.layers.order') }}
      </p>

      <draggable
        v-if="layers.length"
        v-model="layers"
        item-key="id"
        handle=".canvas-layer-handle"
        :animation="150"
        class="space-y-1.5"
      >
        <template #item="{ element }">
          <CanvasLayerRow
            :layer="element"
            @toggle="visible => patchLayer(element.id, { visible })"
            @edit="editLayer(element)"
            @remove="removeLayer(element.id)"
          />
        </template>
      </draggable>

      <!-- Annotations count as content: a canvas with three pins on it is
           not empty, whatever its layer list says. -->
      <EmptyState
        v-else-if="!body.annotations?.length"
        :icon="LayersIcon"
        :title="t('canvases.layers.empty')"
        :description="t('canvases.layers.emptyHint')"
        class="py-8"
      />

      <div class="pt-3 space-y-1.5">
        <p class="text-[11px] text-muted-foreground">
          {{ t('canvases.mapSettings.title') }}
        </p>
        <CanvasMapSettingsPanel
          :model-value="body.mapSettings"
          @update:model-value="setMapSettings"
          @adopt="adoptMapSettings"
        />
      </div>

      <div v-if="body.annotations?.length" class="pt-2 space-y-1.5">
        <p class="text-[11px] text-muted-foreground">
          {{ t('canvases.annotations.title') }}
        </p>
        <CanvasAnnotationRow
          v-for="annotation in body.annotations"
          :key="annotation.id"
          :annotation="annotation"
          :expanded="selectedAnnotationId === annotation.id"
          @toggle-expanded="
            selectedAnnotationId =
              selectedAnnotationId === annotation.id ? null : annotation.id
          "
          @update="patch => patchAnnotation(annotation.id, patch)"
          @remove="removeAnnotation(annotation.id)"
          @zoom-to="zoomToAnnotation(annotation)"
        />
      </div>
    </div>

    <AddCanvasLayerDialog
      v-model:open="addOpen"
      :step="pickerStep"
      @add="addLayer"
    />
    <CanvasDataSourcesDialog
      v-model:open="sourcesOpen"
      @add-library="addLibrarySource"
      @add-file="addImportedData"
    />
    <CanvasDialog v-model:open="renameOpen" :canvas="canvas" />
    <CanvasDataLayerSettings
      v-model:open="dataSettingsOpen"
      :layer="editingDataLayer"
      @update="patchDataLayer"
    />

    <!-- Over the map, not in the panel: drawing is what you do most here. -->
    <Teleport v-if="canvas" to="body">
      <!-- Centred over the *map*, not the viewport: on desktop the sheet
           takes the left 26rem, and a toolbar centred on the window sits
           half-over it and collides with the sheet's own controls. -->
      <div
        class="fixed z-40 top-3 inset-x-0 md:left-104 pointer-events-none flex justify-center px-3"
      >
        <CanvasToolbar
          :tool="annotations.tool.value"
          :color="annotations.color.value"
          :can-finish="annotations.canFinish.value"
          :can-undo="history.canUndo.value"
          :can-route="annotations.canRoute.value"
          :doodle-width="annotations.doodleWidth.value"
          @update:doodle-width="v => (annotations.doodleWidth.value = v)"
          :can-undo-edit="history.canUndo.value"
          :can-redo-edit="history.canRedo.value"
          :vertex-count="annotations.vertexCount.value"
          :route-mode="annotations.routeMode.value"
          :is-snapping="annotations.isSnapping.value"
          @arm="annotations.arm"
          @update:color="value => (annotations.color.value = value)"
          @update:route-mode="value => (annotations.routeMode.value = value)"
          @finish="annotations.finish"
          @undo="history.undo"
          @undo-edit="history.undo"
          @redo-edit="history.redo"
        />
      </div>
    </Teleport>
  </DetailPanelLayout>
</template>
