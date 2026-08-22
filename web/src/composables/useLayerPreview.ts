/**
 * Renders a layer draft on the live map while it is being edited.
 *
 * Style editing is guesswork without this: `line-blur: 2` or
 * `raster-saturation: -0.4` mean nothing until you see them on the map you
 * are actually using. So the editor keeps a throwaway copy of the draft on
 * the map under a preview id, replaces it on every (debounced) change, and
 * tears both the layer and its source down on unmount.
 *
 * The preview id is deliberately NOT the draft's own layer id: editing an
 * existing layer would otherwise fight with the real one already on the map.
 * The real layer is hidden for the duration and restored afterwards.
 */

import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { useMapStore } from '@/stores/map.store'
import { MapEngine, type Layer } from '@/types/map.types'
import {
  draftToConfiguration,
  validateDraft,
  type LayerDraft,
} from '@/lib/map-style/draft'

const PREVIEW_PREFIX = 'layer-preview'

/** Debounce so dragging a slider doesn't rebuild the source 60 times a second. */
const APPLY_DELAY_MS = 180

export function useLayerPreview(
  draft: Ref<LayerDraft>,
  options: { enabled: Ref<boolean>; hideLayerId?: Ref<string | undefined> } = {
    enabled: ref(true),
  },
) {
  const mapStore = useMapStore()

  const previewLayerId = `${PREVIEW_PREFIX}-${Math.random().toString(36).slice(2, 8)}`
  const previewSourceId = `${previewLayerId}-source`

  /** Set when the map refused the draft — surfaced next to the preview toggle. */
  const error = ref<string | null>(null)

  let timer: ReturnType<typeof setTimeout> | undefined
  let applied = false

  function previewLayer(): Layer {
    const configuration = draftToConfiguration({
      ...draft.value,
      layerId: previewLayerId,
      source: { ...draft.value.source, id: previewSourceId },
    })
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
    if (!strategy || !applied) return
    try {
      strategy.removeLayer(previewLayerId)
      strategy.removeSource(previewSourceId)
    } catch {
      // The style may have been swapped out from under us (basemap change),
      // which already took the preview with it.
    }
    applied = false
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
    // produce console noise, so wait until it could actually render.
    if (validateDraft(draft.value).some(i => i.field !== 'name')) {
      teardown()
      error.value = null
      return
    }

    try {
      strategy.addLayer(previewLayer(), true)
      applied = true
      error.value = null
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
    teardown()
    const id = options.hideLayerId?.value
    if (id) mapStore.getMapStrategy()?.toggleLayerVisibility(id, true)
  })

  return { error, previewLayerId }
}
