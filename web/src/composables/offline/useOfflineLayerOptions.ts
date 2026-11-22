import { computed, shallowRef } from 'vue'
import { useMapService } from '@/services/map/map.service'
import { ensureRegions, proxyBase } from '@/services/layers/features/portolan/portolan-client'
import { useLayersStore } from '@/stores/layers.store'
import { withElevationFormat } from '@/lib/map-elevation/elevated-lines'
import { buildLayerOptions, type StyleSourceSpec } from '@/lib/offline/layer-options'
import type { PortolanIndexEntry } from '@/types/portolan.types'

/** Every font stack the style's labels name, as MapLibre asks for them. */
function fontstacks(layers: any[]): string[] {
  const stacks = new Set<string>()
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return
    if (value.length && value.every(v => typeof v === 'string') && value[0] !== 'literal') {
      stacks.add(value.join(','))
      return
    }
    value.forEach(visit)
  }
  for (const layer of layers) visit(layer.layout?.['text-font'])
  return [...stacks]
}

/** What the download sheet can offer, read from the map as it is drawn now. */
export function useOfflineLayerOptions() {
  const mapService = useMapService()
  const layersStore = useLayersStore()

  const feeds = shallowRef<PortolanIndexEntry[]>([])
  void ensureRegions().then(list => (feeds.value = list))

  const options = computed(() => {
    const map = mapService.isMapReady.value ? mapService.mapStrategy?.mapInstance : null
    const style = map?.getStyle?.()
    if (!map || !style) return []

    // A TileJSON source only knows its tiles once loaded, so ask the live source.
    const styleSources: Record<string, StyleSourceSpec> = {}
    for (const [id, spec] of Object.entries(style.sources ?? {})) {
      const live = (map.getSource(id) as { tiles?: unknown } | undefined)?.tiles
      const declared = (spec as { tiles?: unknown }).tiles
      const tiles = [live, declared].find(Array.isArray) as string[] | undefined
      styleSources[id] = { ...(spec as StyleSourceSpec), tiles }
    }

    return buildLayerOptions({
      styleSources,
      glyphs: style.glyphs,
      sprite: typeof style.sprite === 'string' ? style.sprite : undefined,
      fontstacks: fontstacks(style.layers ?? []),
      layers: layersStore.userLayers,
      groups: layersStore.allLayerGroups,
      portolan: { base: proxyBase(), feeds: feeds.value, tileQuery: withElevationFormat },
    })
  })

  const visibleIds = computed(() => {
    const ids = new Set<string>()
    for (const group of layersStore.allLayerGroups) if (group.visible) ids.add(group.id)
    for (const layer of layersStore.userLayers) if (layer.visible) ids.add(layer.id)
    return ids
  })

  return { options, visibleIds }
}
