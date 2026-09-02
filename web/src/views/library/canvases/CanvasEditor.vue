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
import { computed, nextTick, onScopeDispose, provide, ref, watch } from 'vue'
import { useHotkeys } from '@/composables/useHotkeys'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { AppRoute } from '@/router'
import { useCanvasesStore } from '@/stores/library/canvases.store'
import { useCanvasesService } from '@/services/library/canvases.service'
import { useCollectionsService } from '@/services/library/collections.service'
import { useMapStore } from '@/stores/map.store'
import { useCanvasRendering } from '@/composables/useCanvasRendering'
import * as turf from '@turf/turf'
import { useCanvasAnnotations } from '@/composables/useCanvasAnnotations'
import { useCanvasDrawStyle } from '@/composables/useCanvasDrawStyle'
import { useAnnotationEditing } from '@/composables/useAnnotationEditing'
import { useCanvasHistory } from '@/composables/useCanvasHistory'
import { useCanvasMapSettings } from '@/composables/useCanvasMapSettings'
import type { CanvasMapSettings } from '@/types/canvas.types'
import CanvasContextMenu from '@/components/library/canvas/CanvasContextMenu.vue'
import { useDrawOverlay } from '@/composables/useDrawOverlay'
import { annotationFeature } from '@/lib/canvas-annotations'
import { useRoutesService } from '@/services/library/routes.service'
import DetailPanelLayout from '@/components/layouts/DetailPanelLayout.vue'
import AddCanvasLayerDialog from '@/components/library/canvas/AddCanvasLayerDialog.vue'
import CanvasDialog from '@/components/library/canvas/CanvasDialog.vue'
import CanvasDataLayerSettings from '@/components/library/canvas/CanvasDataLayerSettings.vue'
import CanvasDataSourcesDialog from '@/components/library/canvas/CanvasDataSourcesDialog.vue'
import CanvasStackList from '@/components/library/canvas/CanvasStackList.vue'
import {
  CANVAS_STACK,
  type AnnotationRowProps,
  type LayerRowProps,
} from '@/components/library/canvas/canvas-stack-context'
import CanvasToolbar from '@/components/library/canvas/CanvasToolbar.vue'
import CanvasToolOptions from '@/components/library/canvas/CanvasToolOptions.vue'
import ResponsiveDropdown from '@/components/responsive/ResponsiveDropdown.vue'
import {
  countGeometries,
  defaultStyleFor,
  inferRender,
} from '@/lib/map-style/data-presets'
import type { DataSourceDefinition } from '@/lib/data-sources/catalogue'
import { ItemIcon } from '@/components/ui/item-icon'
import { SectionHeader } from '@/components/ui/section-header'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { CloudCheckIcon } from '@/components/ui/icons'
import type { ThemeColor } from '@/lib/utils'
import {
  cloneCanvasBody,
  emptyCanvasBody,
  type CanvasAnnotation,
  type CanvasBody,
  type CanvasDataLayer,
  type CanvasDataOrigin,
  type CanvasGroup,
  type CanvasLayer,
} from '@/types/canvas.types'
import {
  addToStack,
  canvasStack,
  dissolveGroup,
  groupOptions,
  moveInStack,
  parentGroupId,
  removeFromStack,
  type StackAnnotation,
  type StackChange,
  type StackLayer,
} from '@/lib/canvas-stack'
import {
  BookmarkIcon,
  CloudUploadIcon,
  DatabaseIcon,
  Layers3Icon,
  FolderPlusIcon,
  LayersIcon,
  LockIcon,
  PenLineIcon,
  PlusIcon,
  RouteIcon,
  ShapesIcon,
  UsersIcon,
} from 'lucide-vue-next'

const props = defineProps<{ id: string }>()

const router = useRouter()
const { t } = useI18n()
const canvasesStore = useCanvasesStore()
const canvasesService = useCanvasesService()
const collectionsService = useCollectionsService()
const routesService = useRoutesService()
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
/**
 * The row the panel is pointed at, whichever kind it is. A selected mark also
 * opens into its properties and takes the map's halo; a selected layer just
 * reads as selected, since editing one happens elsewhere.
 */
const selectedId = ref<string | null>(null)

/** Only a mark can be the selected *annotation*, which is what the map wants. */
const selectedAnnotationId = computed(() =>
  (body.value.annotations ?? []).some(a => a.id === selectedId.value)
    ? selectedId.value
    : null,
)

/**
 * How each tool is set to draw. Selecting a mark copies its style here, so
 * the next one of its kind matches what you just pointed at.
 */
const drawStyle = useCanvasDrawStyle()

const annotations = useCanvasAnnotations({
  styleFor: drawStyle.forTool,
  onCommit(annotation: CanvasAnnotation) {
    body.value = fileInDestination(
      {
        ...body.value,
        annotations: [...(body.value.annotations ?? []), annotation],
      },
      annotation.id,
    )
    // Open the new mark straight away: naming is nearly always the next
    // thing, and hunting for the row you just created is friction.
    selectedId.value = annotation.id
  },
})

// Selecting a mark takes its style onto the toolbar — the quickest way to
// draw another one like it, and the only traffic between the two: changing a
// setting on the bar never reaches back and restyles the mark you selected.
watch(selectedAnnotationId, id => {
  const annotation = (body.value.annotations ?? []).find(a => a.id === id)
  if (annotation) drawStyle.adopt(annotation)
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

/**
 * Who owns ⌘Z while a text field has focus.
 *
 * Finishing a mark opens its row with the name field focused, which is where
 * you want to be — but mousetrap drops every key pressed inside a field, so
 * undo did nothing there while the toolbar button beside it worked. An empty
 * field has no typing of its own to take back, so the canvas takes the key;
 * once something has been typed, the field keeps it and ⌘Z reverts that
 * instead of throwing away the mark it belongs to.
 */
function canvasOwnsUndo(element: Element) {
  if ((element as HTMLElement).isContentEditable) return false
  return !(element as HTMLInputElement).value
}

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
  { key: 'mod+z', allowInInput: canvasOwnsUndo, handler: () => history.undo() },
  {
    key: 'mod+shift+z',
    allowInInput: canvasOwnsUndo,
    handler: () => history.redo(),
  },
  // What Windows reaches for, and harmless everywhere else.
  { key: 'mod+y', allowInInput: canvasOwnsUndo, handler: () => history.redo() },
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
  if (selectedId.value === id) selectedId.value = null
  body.value = removeFromStack(
    {
      ...body.value,
      annotations: (body.value.annotations ?? []).filter(a => a.id !== id),
    },
    id,
  )
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

/** The stack, bottom first — the order it draws in, and the order the layer
 *  library already lists layers in. */
const stack = computed(() => canvasStack(body.value))

/**
 * A drop, from either list. Only the half that says "this arrived" is acted
 * on — acting on the half that says "this left" is what used to lose items
 * mid-drag, since between the two the item belonged nowhere.
 */
function onStackChange(event: StackChange, groupId: string | null = null) {
  const change = event.added ?? event.moved
  if (!change?.element) return
  body.value = moveInStack(body.value, change.element.id, {
    groupId,
    index: change.newIndex,
  })
}

/**
 * What each kind of row binds to. Bound here rather than in the panel because
 * the stack renders at the top level and again inside every group, however
 * deep, and they all have to stay the same row.
 */
function layerProps(entry: StackLayer): LayerRowProps {
  return {
    layer: entry.layer,
    selected: selectedId.value === entry.id,
    onSelect: () => (selectedId.value = entry.id),
    onToggle: (visible: boolean) => patchLayer(entry.id, { visible }),
    onEdit: () => editLayer(entry.layer),
    onRemove: () => removeLayer(entry.id),
  }
}

function annotationProps(entry: StackAnnotation): AnnotationRowProps {
  return {
    annotation: entry.annotation,
    expanded: selectedId.value === entry.id,
    onToggleExpanded: () =>
      (selectedId.value = selectedId.value === entry.id ? null : entry.id),
    onUpdate: (patch: Partial<CanvasAnnotation>) =>
      patchAnnotation(entry.id, patch),
    onRemove: () => removeAnnotation(entry.id),
    onZoomTo: () => zoomToAnnotation(entry.annotation),
  }
}

function patchLayer(id: string, patch: Partial<CanvasLayer>) {
  body.value = {
    ...body.value,
    layers: body.value.layers.map(l =>
      l.id === id ? ({ ...l, ...patch } as CanvasLayer) : l,
    ),
  }
}

function addLayer(layer: CanvasLayer) {
  body.value = fileInDestination(
    { ...body.value, layers: [...body.value.layers, layer] },
    layer.id,
  )
  // Show what was just added. The render pass has to put it on the map first,
  // so this waits a tick rather than racing it.
  nextTick(() => fitToLayer(props.id, layer))
}

async function removeLayer(id: string) {
  if (selectedId.value === id) selectedId.value = null
  body.value = removeFromStack(
    { ...body.value, layers: body.value.layers.filter(l => l.id !== id) },
    id,
  )
}

// ── Groups ───────────────────────────────────────────────────────────────────

/**
 * The group new work is filed in — where the pin and drawing tools aim, and
 * where anything added from the panel lands.
 *
 * Read off the selection rather than set on its own: the row you are pointed
 * at is where you are working. Select a group and marks go in it; select
 * something inside a group and they join it there; select a mark at the top
 * level, or nothing at all, and they go back on the canvas. One control, and
 * no second piece of state to fall out of step with the panel.
 */
const activeGroupId = computed<string | null>(() => {
  const id = selectedId.value
  if (!id) return null
  const groups = body.value.groups ?? []
  if (groups.some(group => group.id === id)) return id
  return parentGroupId(body.value, id)
})

/** Every group, flattened with its depth, for the toolbar's picker. */
const groupChoices = computed(() => groupOptions(stack.value))

/**
 * Put something new where the user is working. A folded destination is opened
 * on the way — a mark that files itself out of sight reads as a mark lost.
 */
function fileInDestination(next: CanvasBody, id: string): CanvasBody {
  const destination = activeGroupId.value
  const filed = addToStack(next, id, destination)
  if (!destination) return filed
  return {
    ...filed,
    groups: (filed.groups ?? []).map(group =>
      group.id === destination ? { ...group, collapsed: false } : group,
    ),
  }
}

function patchGroup(id: string, patch: Partial<CanvasGroup>) {
  body.value = {
    ...body.value,
    groups: (body.value.groups ?? []).map(group =>
      group.id === id ? { ...group, ...patch } : group,
    ),
  }
}

/**
 * A new group lands on top, empty — inside the current destination if there
 * is one, which is how a group ends up inside another group without dragging
 * anything.
 */
function addGroup() {
  const group: CanvasGroup = {
    id: `cg-${Math.random().toString(36).slice(2, 10)}`,
    name: t('canvases.groups.untitled'),
    visible: true,
    children: [],
  }
  body.value = fileInDestination(
    { ...body.value, groups: [...(body.value.groups ?? []), group] },
    group.id,
  )
}

/** Ungrouping keeps what was filed in the group — see `dissolveGroup`. */
function removeGroup(id: string) {
  if (selectedId.value === id) selectedId.value = null
  body.value = dissolveGroup(body.value, id)
}

/**
 * Everything a row needs, handed to the whole tree at once. The stack renders
 * itself at every depth, so passing these down as props would mean each level
 * redeclaring and forwarding all of them.
 */
provide(CANVAS_STACK, {
  layerProps,
  annotationProps,
  isSelected: (id: string) => selectedId.value === id,
  toggleSelected: (id: string) =>
    (selectedId.value = selectedId.value === id ? null : id),
  isDestination: (id: string) => activeGroupId.value === id,
  patchGroup,
  removeGroup,
  onChange: onStackChange,
})

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
  const found = body.value.layers.find(l => l.id === editingDataLayerId.value)
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

/**
 * The add menu. There are two ways to put something on a canvas — reach for
 * something you already have, or bring data in — and they read better apart
 * than as one flat list. A dropdown rather than a dialog: most of these open
 * a picker of their own, and a dialog to choose which dialog is a step too
 * many.
 */
const addMenuItems = computed(() => [
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
  { type: 'separator' as const },
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
])

/**
 * The canvas's own map appearance, in force while it is open. Absent means it
 * follows whatever the app is set to. Called for its effect on the map; the
 * switches themselves live in the header menu.
 */
useCanvasMapSettings(computed(() => body.value.mapSettings))

function setMapSettings(next: CanvasMapSettings | undefined) {
  body.value = { ...body.value, mapSettings: next }
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

/** Anything still to write, whether it is in flight or waiting on the debounce. */
const pending = computed(() => saving.value || isDirty.value)
const saveStatus = computed(() =>
  pending.value ? t('canvases.saving') : t('canvases.saved'),
)
</script>

<template>
  <DetailPanelLayout>
    <template #title>
      <div class="flex items-center gap-2 min-w-0">
        <!-- A canvas saves itself, so where that got to is a property of the
             canvas rather than a control beside it — it rides on its icon,
             the way a status dot rides on an avatar. -->
        <div v-if="canvas" class="relative shrink-0" :title="saveStatus">
          <ItemIcon
            :icon="canvas.icon ?? 'MapIcon'"
            :color="(canvas.iconColor as ThemeColor) ?? 'iris'"
            size="sm"
          />
          <span
            class="absolute -bottom-1 -right-1 rounded-full bg-background p-0.5 text-muted-foreground"
          >
            <CloudUploadIcon v-if="pending" class="size-3 animate-pulse" />
            <CloudCheckIcon v-else class="size-3" />
          </span>
          <span class="sr-only" aria-live="polite">{{ saveStatus }}</span>
        </div>
        <div class="min-w-0">
          <h4 class="text-base font-semibold truncate flex items-center gap-1.5">
            <span class="truncate">{{ displayName }}</span>
            <LockIcon
              v-if="canvas?.scheme === 'user-e2ee'"
              class="size-3 shrink-0 text-muted-foreground"
            />
          </h4>
          <p
            v-if="canvas?.description"
            class="text-xs text-muted-foreground truncate"
          >
            {{ canvas.description }}
          </p>
        </div>
      </div>
    </template>

    <template #actions>
      <CanvasContextMenu
        v-if="canvas"
        :canvas="canvas"
        :map-settings="body.mapSettings"
        @update:map-settings="setMapSettings"
        @edit="renameOpen = true"
        @deleted="close"
      />
    </template>

    <div v-if="loading && !canvas" class="py-12 flex justify-center">
      <Spinner />
    </div>

    <EmptyState
      v-else-if="!canvas"
      :icon="LayersIcon"
      :title="t('canvases.notFound')"
    />

    <div v-else class="space-y-5">
      <section class="space-y-2">
        <SectionHeader size="lg" :title="t('canvases.stack.title')">
          <template #trailing>
            <div class="flex items-center gap-0.5 -mr-1">
              <Button
                variant="ghost"
                size="icon"
                class="size-8"
                :title="t('canvases.groups.add')"
                :aria-label="t('canvases.groups.add')"
                @click="addGroup"
              >
                <FolderPlusIcon class="size-4" />
              </Button>
              <ResponsiveDropdown
                :items="addMenuItems"
                align="end"
                :title="t('canvases.add.trigger')"
              >
                <template #trigger>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-8"
                    :title="t('canvases.add.trigger')"
                    :aria-label="t('canvases.add.trigger')"
                  >
                    <PlusIcon class="size-4" />
                  </Button>
                </template>
              </ResponsiveDropdown>
            </div>
          </template>
        </SectionHeader>

        <!-- Bottom of the list draws first, matching how the layer library
             reads. Every list in the tree shares one sortable group, so a
             drag can cross into and out of a folder at any depth. -->
        <CanvasStackList v-if="stack.length" :entries="stack" />

        <EmptyState
          v-else
          variant="card"
          :icon="LayersIcon"
          :title="t('canvases.stack.empty')"
          :description="t('canvases.stack.emptyHint')"
        >
          <ResponsiveDropdown
            :items="addMenuItems"
            align="center"
            :title="t('canvases.add.trigger')"
          >
            <template #trigger>
              <Button variant="outline" size="sm">
                <PlusIcon class="size-3.5" />
                {{ t('canvases.add.trigger') }}
              </Button>
            </template>
          </ResponsiveDropdown>
        </EmptyState>
      </section>
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
          :can-finish="annotations.canFinish.value"
          :can-undo="history.canUndo.value"
          :can-route="annotations.canRoute.value"
          :can-undo-edit="history.canUndo.value"
          :can-redo-edit="history.canRedo.value"
          :vertex-count="annotations.vertexCount.value"
          :groups="groupChoices"
          :group-id="activeGroupId"
          @update:group-id="id => (selectedId = id)"
          @arm="annotations.arm"
          @finish="annotations.finish"
          @undo="history.undo"
          @undo-edit="history.undo"
          @redo-edit="history.redo"
        >
          <!-- The armed tool's own settings, on the toolbar's second row. -->
          <template #options>
            <CanvasToolOptions
              v-if="annotations.tool.value"
              :tool="annotations.tool.value"
              :style="drawStyle.forTool(annotations.tool.value)"
              :route-mode="annotations.routeMode.value"
              :isochrone-mode="annotations.isochroneMode.value"
              :isochrone-minutes="annotations.isochroneMinutes.value"
              :is-busy="
                annotations.isSnapping.value ||
                annotations.isFetchingIsochrone.value
              "
              @update:style="
                patch => drawStyle.set(annotations.tool.value!, patch)
              "
              @update:route-mode="value => (annotations.routeMode.value = value)"
              @update:isochrone-mode="
                value => (annotations.isochroneMode.value = value)
              "
              @update:isochrone-minutes="
                value => (annotations.isochroneMinutes.value = value)
              "
            />
          </template>
        </CanvasToolbar>
      </div>
    </Teleport>
  </DetailPanelLayout>
</template>
