<script setup lang="ts">
/**
 * Create or edit a custom layer, in the sheet rather than a dialog.
 *
 * Living in the sheet is the point: the map stays visible, and the draft is
 * rendered on it while you work, so a colour or a dash pattern is judged
 * against the basemap you'll actually see it on instead of imagined from
 * JSON. Saving is explicit — nothing is written until you press Save.
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { AppRoute } from '@/router'
import { useLayersStore } from '@/stores/layers.store'
import { useCanvasesStore } from '@/stores/library/canvases.store'
import { useCanvasesService } from '@/services/library/canvases.service'
import { useAppService } from '@/services/app.service'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import { useLayerPreview } from '@/composables/useLayerPreview'
import {
  createLayerDraft,
  draftToLayerFields,
  layerToDraft,
  validateDraft,
  withGeneratedIds,
  type LayerDraft,
} from '@/lib/map-style/draft'
import type { ImportCandidate } from '@/lib/map-style/import'
import { candidateToDraft } from '@/lib/map-style/import'
import DetailPanelLayout from '@/components/layouts/DetailPanelLayout.vue'
import SourceForm from '@/components/map/layers/editor/SourceForm.vue'
import StyleForm from '@/components/map/layers/editor/StyleForm.vue'
import ImportStyleDialog from '@/components/map/layers/editor/ImportStyleDialog.vue'
import JsonField from '@/components/map/layers/editor/JsonField.vue'
import EditorSection from '@/components/map/layers/editor/EditorSection.vue'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { IconPicker } from '@/components/ui/icon-picker'
import { Spinner } from '@/components/ui/spinner'
import { MapEngine, type Layer } from '@/types/map.types'
import { newCanvasId, type CanvasStyleLayer } from '@/types/canvas.types'
import { DownloadIcon, EyeIcon, EyeOffIcon } from 'lucide-vue-next'

const props = defineProps<{ id?: string }>()

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const layersStore = useLayersStore()
const canvasesStore = useCanvasesStore()
const canvasesService = useCanvasesService()
const appService = useAppService()
const { layers } = storeToRefs(layersStore)

/**
 * The same editor serves two destinations. With `?canvas=<id>` it authors a
 * layer that belongs to that canvas; without it, one that belongs to the
 * library. Everything between loading and saving is identical, which is the
 * point of keeping the draft independent of where it lands.
 */
const canvasId = computed(() => (route.query.canvas as string) || null)
const canvas = computed(() =>
  canvasId.value ? canvasesStore.getCanvasById(canvasId.value) : undefined,
)

/** The canvas layer being edited, when this is a canvas-scoped edit. */
const canvasLayer = computed(() => {
  if (!canvas.value || !props.id) return undefined
  const found = canvas.value.body?.layers.find(l => l.id === props.id)
  return found?.kind === 'style' ? found : undefined
})

const existing = computed<Layer | undefined>(() => {
  if (canvasId.value) {
    const layer = canvasLayer.value
    return layer
      ? ({
          id: layer.id,
          name: layer.name,
          icon: layer.icon,
          visible: layer.visible,
          engine: layer.engine,
          showInLayerSelector: false,
          configuration: layer.configuration,
        } as unknown as Layer)
      : undefined
  }
  return props.id ? layers.value.find(l => l.id === props.id) : undefined
})

const draft = ref<LayerDraft>(createLayerDraft())
/** Snapshot of the draft as loaded, to tell edited from untouched. */
const pristine = ref('')

function load() {
  draft.value = existing.value
    ? layerToDraft(existing.value)
    : createLayerDraft()
  pristine.value = JSON.stringify(draft.value)
}

// The layer list arrives asynchronously on a cold load, so reload when the
// row we're editing appears.
watch(existing, load, { immediate: true })

const isDirty = computed(() => JSON.stringify(draft.value) !== pristine.value)
const { allowLeave } = useUnsavedChanges(isDirty)

// ── Live preview ─────────────────────────────────────────────────────────────

const previewEnabled = ref(true)
const hiddenLayerId = computed(() =>
  previewEnabled.value ? existing.value?.configuration?.id : undefined,
)
const { error: previewError } = useLayerPreview(draft, {
  enabled: previewEnabled,
  hideLayerId: hiddenLayerId,
})

// ── Save ─────────────────────────────────────────────────────────────────────

const issues = computed(() => validateDraft(draft.value))
const saving = ref(false)
const tab = ref('source')

/** Jump to the tab holding the first problem, so Save never fails silently. */
function tabForIssue(field: string) {
  return field.startsWith('source') || field === 'sourceLayer' || field === 'name'
    ? 'source'
    : 'options'
}

async function save() {
  if (issues.value.length) {
    tab.value = tabForIssue(issues.value[0].field)
    appService.toast.error(
      t(`layers.editor.errors.${issues.value[0].message}`),
    )
    return
  }

  saving.value = true
  try {
    const seed = props.id ?? `layer-${Date.now()}`
    const fields = draftToLayerFields(withGeneratedIds(draft.value, seed))
    const wasEditing = !!existing.value

    if (canvasId.value) {
      await saveToCanvas(fields)
    } else if (existing.value) {
      await layersStore.updateLayer(existing.value.id, fields)
    } else {
      await layersStore.addLayer({
        ...fields,
        order: layersStore.layers.length,
        groupId: null,
      } as Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'>)
    }

    pristine.value = JSON.stringify(draft.value)
    allowLeave()
    appService.toast.success(
      t(
        wasEditing
          ? 'layers.editor.saved'
          : canvasId.value
            ? 'layers.editor.addedToCanvas'
            : 'layers.editor.created',
        { name: fields.name },
      ),
    )
    router.push(destination.value)
  } catch (e) {
    appService.toast.error(t('layers.editor.saveFailed'))
    console.error('Failed to save layer', e)
  } finally {
    saving.value = false
  }
}

/** Where Save and Back return to — the canvas that sent us, or the library. */
const destination = computed(() =>
  canvasId.value
    ? { name: AppRoute.CANVAS_EDITOR, params: { id: canvasId.value } }
    : { name: AppRoute.LIBRARY_LAYERS },
)

/**
 * Write the draft into the canvas's layer stack. The canvas holds the layer
 * itself, not a reference to a library row, so a canvas stays self-contained
 * and its layers can be styled without touching the library.
 */
async function saveToCanvas(fields: ReturnType<typeof draftToLayerFields>) {
  const target = canvas.value
  if (!target) return
  const layer: CanvasStyleLayer = {
    id: props.id ?? newCanvasId('cl'),
    kind: 'style',
    name: fields.name,
    icon: fields.icon,
    visible: fields.visible,
    configuration: fields.configuration as Record<string, unknown>,
    engine: fields.engine,
  }
  const layers = target.body?.layers ?? []
  const index = layers.findIndex(l => l.id === layer.id)
  const next = index === -1
    ? [...layers, layer]
    : layers.map((l, i) => (i === index ? layer : l))
  await canvasesService.saveBody(target, { ...target.body, layers: next })
}

function close() {
  router.push(destination.value)
}

// ── Import ───────────────────────────────────────────────────────────────────

const importOpen = ref(false)

function applyImport(candidate: ImportCandidate) {
  const imported = candidateToDraft(candidate)
  // Keep whatever the user already typed as a name — an import that lands
  // mid-edit shouldn't overwrite it with a style-layer id.
  draft.value = { ...imported, name: draft.value.name || imported.name }
  tab.value = 'style'
}

// ── Options ──────────────────────────────────────────────────────────────────

function toggleEngine(engine: MapEngine, enabled: boolean) {
  const engines = enabled
    ? [...new Set([...draft.value.engines, engine])]
    : draft.value.engines.filter(e => e !== engine)
  // An empty list would mean "no engine can draw this", i.e. invisible
  // everywhere; the spec reads an empty array as "all", so normalise.
  draft.value = { ...draft.value, engines: engines.length ? engines : [engine] }
}

const title = computed(() =>
  existing.value ? t('layers.editor.editTitle') : t('layers.editor.newTitle'),
)
</script>

<template>
  <DetailPanelLayout show-back-button @back="close">
    <template #title>
      <p class="text-lg font-semibold truncate">{{ title }}</p>
    </template>

    <template #actions>
      <Button
        variant="ghost"
        size="icon"
        class="size-8"
        :title="t(previewEnabled ? 'layers.editor.previewOn' : 'layers.editor.previewOff')"
        :aria-label="t(previewEnabled ? 'layers.editor.previewOn' : 'layers.editor.previewOff')"
        @click="previewEnabled = !previewEnabled"
      >
        <EyeIcon v-if="previewEnabled" class="size-4" />
        <EyeOffIcon v-else class="size-4 text-muted-foreground" />
      </Button>
      <Button size="sm" :disabled="saving" @click="save">
        <Spinner v-if="saving" class="size-3.5" />
        {{ t('general.save') }}
      </Button>
    </template>

    <div class="space-y-4">
      <!-- Identity -->
      <div class="flex items-center gap-2">
        <IconPicker
          :model-value="{ icon: draft.icon ?? 'Layers3Icon', color: 'cobalt' }"
          @update:model-value="v => (draft = { ...draft, icon: v.icon })"
        />
        <Input
          :model-value="draft.name"
          class="h-9"
          :placeholder="t('layers.editor.namePlaceholder')"
          @update:model-value="v => (draft = { ...draft, name: String(v) })"
        />
      </div>

      <p v-if="previewError" class="text-xs text-destructive">
        {{ t('layers.editor.previewFailed', { error: previewError }) }}
      </p>

      <Tabs v-model="tab" class="w-full">
        <TabsList variant="linear" class="w-full">
          <TabsTrigger value="source" variant="linear">
            {{ t('layers.editor.tabs.source') }}
          </TabsTrigger>
          <TabsTrigger value="style" variant="linear">
            {{ t('layers.editor.tabs.style') }}
          </TabsTrigger>
          <TabsTrigger value="options" variant="linear">
            {{ t('layers.editor.tabs.options') }}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="source" class="pt-4">
          <SourceForm v-model="draft" />

          <div class="mt-6 pt-4 border-t flex items-center justify-between gap-2">
            <p class="text-xs text-muted-foreground">
              {{ t('layers.editor.import.prompt') }}
            </p>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-2 shrink-0 text-xs"
              @click="importOpen = true"
            >
              <DownloadIcon class="size-3.5" />
              {{ t('layers.editor.import.trigger') }}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="style" class="pt-4">
          <StyleForm v-model="draft" />
        </TabsContent>

        <TabsContent value="options" class="pt-4 space-y-4">
          <div class="flex items-center justify-between gap-2">
            <div>
              <Label class="text-sm">
                {{ t('layers.meta.fields.showInLayerSelector') }}
              </Label>
              <p class="text-[11px] text-muted-foreground">
                {{ t('layers.editor.options.showInSelectorHint') }}
              </p>
            </div>
            <Switch
              :model-value="draft.showInLayerSelector"
              @update:model-value="v => (draft = { ...draft, showInLayerSelector: v })"
            />
          </div>

          <div class="flex items-center justify-between gap-2">
            <div>
              <Label class="text-sm">{{ t('layers.meta.fields.fadeBasemap') }}</Label>
              <p class="text-[11px] text-muted-foreground">
                {{ t('layers.editor.options.fadeBasemapHint') }}
              </p>
            </div>
            <Switch
              :model-value="draft.fadeBasemap"
              @update:model-value="v => (draft = { ...draft, fadeBasemap: v })"
            />
          </div>

          <div class="space-y-2">
            <Label class="text-sm">{{ t('layers.meta.fields.engine') }}</Label>
            <div class="flex items-center gap-4">
              <label
                v-for="engine in [MapEngine.MAPBOX, MapEngine.MAPLIBRE]"
                :key="engine"
                class="flex items-center gap-2 text-sm capitalize"
              >
                <Checkbox
                  :model-value="draft.engines.includes(engine)"
                  @update:model-value="v => toggleEngine(engine, v === true)"
                />
                {{ engine }}
              </label>
            </div>
          </div>

          <EditorSection :title="t('layers.editor.options.filter')">
            <p class="text-[11px] text-muted-foreground pb-2">
              {{ t('layers.editor.options.filterHint') }}
            </p>
            <JsonField
              :model-value="draft.filter"
              :rows="4"
              placeholder='["==", ["get", "class"], "park"]'
              @update:model-value="v => (draft = { ...draft, filter: v })"
            />
          </EditorSection>

          <EditorSection :title="t('layers.editor.options.rawLayer')">
            <p class="text-[11px] text-muted-foreground pb-2">
              {{ t('layers.editor.options.rawLayerHint') }}
            </p>
            <JsonField
              :model-value="{ paint: draft.paint, layout: draft.layout }"
              :rows="10"
              :nullable="false"
              @update:model-value="
                v => {
                  const next = (v ?? {}) as Record<string, unknown>
                  draft = {
                    ...draft,
                    paint: (next.paint as Record<string, unknown>) ?? {},
                    layout: (next.layout as Record<string, unknown>) ?? {},
                  }
                }
              "
            />
          </EditorSection>
        </TabsContent>
      </Tabs>
    </div>

    <ImportStyleDialog v-model:open="importOpen" @select="applyImport" />
  </DetailPanelLayout>
</template>
