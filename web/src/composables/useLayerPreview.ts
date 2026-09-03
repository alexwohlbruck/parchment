/**
 * Renders a layer draft on the live map while it is being edited.
 *
 * Style editing is guesswork without this: `line-blur: 2` or
 * `raster-saturation: -0.4` mean nothing until you see them on the map you
 * are actually using. So the editor keeps a throwaway copy of the draft on
 * the map under a preview id, replaces it on every (debounced) change, and
 * tears both the layer and its source down on unmount.
 *
 * Source and layer are managed separately rather than handed to
 * `addLayer(layer, overwrite)` as one object. Two reasons, both of which show
 * up immediately when you drag a slider:
 *
 *   - The engine refuses to drop a source a layer is still using, so the
 *     overwrite path failed and then threw "there is already a source with
 *     ID …" on the way back in.
 *   - Rebuilding the source refetches every tile. Style edits leave the data
 *     alone, so the source is only touched when the data it points at
 *     actually changes.
 *
 * The first time a source resolves to real data the camera flies to it — a
 * layer you have just pasted a URL for is rarely under the current view.
 */

import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { useMapStore } from '@/stores/map.store'
import { MapEngine, type Layer } from '@/types/map.types'
import {
  draftToConfiguration,
  draftToSourceSpec,
  validateDraft,
  type LayerDraft,
} from '@/lib/map-style/draft'
import { resolveSourceBounds, sourceDataKey } from '@/lib/map-style/bounds'

const PREVIEW_PREFIX = 'layer-preview'

/** Debounce so dragging a slider doesn't rebuild the layer 60 times a second. */
const APPLY_DELAY_MS = 180

export interface LayerPreviewOptions {
  enabled: Ref<boolean>
  /** A layer already on the map to hide while its copy is being edited. */
  hideLayerId?: Ref<string | undefined>
  /** Fly to the data the first time a new source resolves. Default true. */
  fitOnFirstData?: boolean
}

export function useLayerPreview(
  draft: Ref<LayerDraft>,
  options: LayerPreviewOptions = { enabled: ref(true) },
) {
  const mapStore = useMapStore()

  const previewLayerId = `${PREVIEW_PREFIX}-${Math.random().toString(36).slice(2, 8)}`
  const previewSourceId = `${previewLayerId}-source`

  /** Set when the map refused the draft — surfaced next to the preview toggle. */
  const error = ref<string | null>(null)

  let timer: ReturnType<typeof setTimeout> | undefined
  let layerApplied = false
  /** The source spec currently on the map, so we only rebuild on real changes. */
  let appliedSourceSpec: string | null = null
  /** Data keys we have already flown to, so the camera moves once per source. */
  const fitted = new Set<string>()
  let fitRequest: AbortController | undefined

  function previewLayer(): Layer {
    // The source is named, not inlined: this composable owns its lifecycle.
    const configuration = {
      ...draftToConfiguration(draft.value),
      id: previewLayerId,
      source: previewSourceId,
    }
    return {
      id: previewLayerId,
      name: draft.value.name || previewLayerId,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      showInLayerSelector: false,
      visible: true,
      order: 0,
      groupId: null,
      configuration,
    } as unknown as Layer
  }

  function teardown() {
    const strategy = mapStore.getMapStrategy()
    if (!strategy) return
    try {
      // Layer first — the engine won't drop a source still in use.
      if (layerApplied) strategy.removeLayer(previewLayerId)
      if (appliedSourceSpec !== null) strategy.removeSource(previewSourceId)
    } catch {
      // The style may have been swapped out from under us (basemap change),
      // which already took the preview with it.
    }
    layerApplied = false
    appliedSourceSpec = null
  }

  /** Fly to the layer's data, once per distinct source. */
  async function fitToData() {
    if (options.fitOnFirstData === false) return
    const key = sourceDataKey(draft.value.source)
    if (fitted.has(key)) return
    fitted.add(key)

    fitRequest?.abort()
    fitRequest = new AbortController()
    const bounds = await resolveSourceBounds(
      draft.value.source,
      fitRequest.signal,
    )
    // The draft may have moved on while we were fetching, and the preview may
    // have been switched off — either way, don't yank the camera.
    if (!bounds || !options.enabled.value) return
    if (sourceDataKey(draft.value.source) !== key) return

    mapStore.getMapStrategy()?.fitBounds(
      {
        minLng: bounds.minLng,
        minLat: bounds.minLat,
        maxLng: bounds.maxLng,
        maxLat: bounds.maxLat,
      },
      { padding: 80, duration: 900 },
    )
  }

  function apply() {
    const strategy = mapStore.getMapStrategy()
    if (!strategy) return

    if (!options.enabled.value) {
      teardown()
      error.value = null
      return
    }

    // A half-finished draft (no tiles yet, unparsed GeoJSON) would only
    // produce console noise, so wait until it could actually render. The name
    // is the one thing that doesn't stop it drawing.
    if (validateDraft(draft.value).some(i => i.field !== 'name')) {
      teardown()
      error.value = null
      return
    }

    try {
      const sourceSpec = draftToSourceSpec(draft.value.source)
      const { id: _id, ...sourceOptions } = sourceSpec
      const serialised = JSON.stringify(sourceOptions)

      if (serialised !== appliedSourceSpec) {
        // Drop the layer before the source it depends on, then rebuild both.
        if (layerApplied) strategy.removeLayer(previewLayerId)
        layerApplied = false
        if (appliedSourceSpec !== null) strategy.removeSource(previewSourceId)
        strategy.addSource(previewSourceId, sourceOptions)
        appliedSourceSpec = serialised
      }

      // `overwrite` replaces the layer in place; the source is untouched.
      strategy.addLayer(previewLayer(), true)
      layerApplied = true
      error.value = null

      void fitToData()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(apply, APPLY_DELAY_MS)
  }

  watch(draft, schedule, { deep: true, immediate: true })
  watch(options.enabled, apply)

  // Hide the layer being edited so the preview isn't drawn over its own
  // unedited self.
  watch(
    () => options.hideLayerId?.value,
    (id, previous) => {
      const strategy = mapStore.getMapStrategy()
      if (!strategy) return
      if (previous) strategy.toggleLayerVisibility(previous, true)
      if (id) strategy.toggleLayerVisibility(id, false)
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    clearTimeout(timer)
    fitRequest?.abort()
    teardown()
    const id = options.hideLayerId?.value
    if (id) mapStore.getMapStrategy()?.toggleLayerVisibility(id, true)
  })

  return { error, previewLayerId }
}
