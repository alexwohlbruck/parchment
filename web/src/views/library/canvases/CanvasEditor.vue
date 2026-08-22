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
import { computed, onScopeDispose, ref, watch } from 'vue'
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
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import { useCanvasRendering } from '@/composables/useCanvasRendering'
import DetailPanelLayout from '@/components/layouts/DetailPanelLayout.vue'
import CanvasLayerRow from '@/components/library/canvas/CanvasLayerRow.vue'
import AddCanvasLayerDialog from '@/components/library/canvas/AddCanvasLayerDialog.vue'
import CanvasDialog from '@/components/library/canvas/CanvasDialog.vue'
import { ItemIcon } from '@/components/ui/item-icon'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import type { ThemeColor } from '@/lib/utils'
import {
  emptyCanvasBody,
  type CanvasBody,
  type CanvasLayer,
} from '@/types/canvas.types'
import {
  CrosshairIcon,
  LayersIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
} from 'lucide-vue-next'

const props = defineProps<{ id: string }>()

const router = useRouter()
const { t } = useI18n()
const canvasesStore = useCanvasesStore()
const canvasesService = useCanvasesService()
const collectionsService = useCollectionsService()
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
  body.value = structuredClone(canvas.value?.body ?? emptyCanvasBody())
  pristine.value = JSON.stringify(body.value)
}

watch(canvas, load, { immediate: true })

// A cold load (opened from a link, or after a reload) has neither the canvas
// nor the collections it references.
;(async () => {
  await Promise.all([
    canvasesService.fetchCanvasById(props.id),
    collectionsService.fetchCollections(),
  ])
  loading.value = false
})()

const isDirty = computed(() => JSON.stringify(body.value) !== pristine.value)
const { allowLeave } = useUnsavedChanges(isDirty)

// Draw the working copy, so reordering and toggling read on the map at once.
// Claiming the canvas keeps the main map from drawing its saved version
// underneath the copy being edited.
canvasesStore.editingCanvasId = props.id
onScopeDispose(() => {
  canvasesStore.editingCanvasId = null
})

useCanvasRendering(
  computed(() => (canvas.value ? [{ id: props.id, body: body.value }] : [])),
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
}

async function removeLayer(id: string) {
  layers.value = layers.value.filter(l => l.id !== id)
}

function editStyleLayer(layer: CanvasLayer) {
  if (layer.kind !== 'style') return
  router.push({
    name: AppRoute.LAYER_EDITOR,
    params: { id: layer.id },
    query: { canvas: props.id },
  })
}

function createStyleLayer() {
  router.push({
    name: AppRoute.LAYER_EDITOR_NEW,
    query: { canvas: props.id },
  })
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

const addOpen = ref(false)
const renameOpen = ref(false)

async function save() {
  if (!canvas.value || saving.value) return
  saving.value = true
  try {
    const saved = await canvasesService.saveBody(canvas.value, body.value)
    if (saved) {
      pristine.value = JSON.stringify(body.value)
      appService.toast.success(t('canvases.saved'))
    }
  } finally {
    saving.value = false
  }
}

async function close() {
  // Saving before leaving is the common intent, so offer it rather than
  // making Discard the only way out of the confirm.
  if (isDirty.value) {
    const shouldSave = await appService.confirm({
      title: t('canvases.close.title'),
      description: t('canvases.close.description'),
      continueText: t('general.save'),
      cancelText: t('general.unsavedChanges.discard'),
    })
    if (shouldSave) await save()
  }
  allowLeave()
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
      <Button size="sm" :disabled="!isDirty || saving" @click="save">
        <Spinner v-if="saving" class="size-3.5" />
        {{ t('general.save') }}
      </Button>
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

      <Button variant="outline" size="sm" class="w-full" @click="addOpen = true">
        <PlusIcon class="size-3.5" />
        {{ t('canvases.add.trigger') }}
      </Button>

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
            @edit="editStyleLayer(element)"
            @remove="removeLayer(element.id)"
          />
        </template>
      </draggable>

      <EmptyState
        v-else
        :icon="LayersIcon"
        :title="t('canvases.layers.empty')"
        :description="t('canvases.layers.emptyHint')"
        class="py-8"
      />
    </div>

    <AddCanvasLayerDialog
      v-model:open="addOpen"
      @add="addLayer"
      @create-style="createStyleLayer"
    />
    <CanvasDialog v-model:open="renameOpen" :canvas="canvas" />
  </DetailPanelLayout>
</template>
