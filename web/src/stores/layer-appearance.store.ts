import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import { useLayersStore } from '@/stores/layers.store'
import { useLayersService } from '@/services/layers/layers.service'
import type { MapStrategy } from '@/services/map/providers/map.strategy'
import type { LayerGroup } from '@/types/map.types'
import {
  appearanceGroupVisibility,
  LAYER_APPEARANCES,
  resolveAppearance,
} from '@/lib/map/layer-appearances'

/** Which appearance each built-in layer shows, kept across sessions, and the child groups that follow from it. */
export const useLayerAppearanceStore = defineStore('layer-appearance', () => {
  const layersStore = useLayersStore()
  const layersService = useLayersService()
  const chosen = useStorage<Record<string, string>>('layer-appearances', {})

  function appearanceOf(layerId: string) {
    return resolveAppearance(layerId, chosen.value[layerId])
  }

  const findGroup = (id: string) => layersStore.allLayerGroups.find(g => g.id === id)

  function setGroupVisible(group: LayerGroup, visible: boolean, mapStrategy?: MapStrategy) {
    return layersService.toggleLayerGroupVisibility(
      group,
      visible,
      layersStore,
      layersStore.layers,
      mapStrategy,
      layersStore.allLayerGroups,
    )
  }

  /** Brings a layer's child groups in line with its switch and its appearance. */
  async function apply(layerId: string, mapStrategy?: MapStrategy) {
    const layer = findGroup(layerId)
    const appearance = appearanceOf(layerId)
    if (!layer || !appearance) return
    for (const [groupId, visible] of appearanceGroupVisibility(layerId, layer.visible, appearance)) {
      const group = findGroup(groupId)
      if (group && group.visible !== visible) await setGroupVisible(group, visible, mapStrategy)
    }
  }

  async function setAppearance(layerId: string, appearanceId: string, mapStrategy?: MapStrategy) {
    chosen.value = { ...chosen.value, [layerId]: appearanceId }
    await apply(layerId, mapStrategy)
  }

  async function setLayerVisible(layer: LayerGroup, visible: boolean, mapStrategy?: MapStrategy) {
    await setGroupVisible(layer, visible, mapStrategy)
    await apply(layer.id, mapStrategy)
  }

  async function applyAll(mapStrategy?: MapStrategy) {
    for (const layerId of Object.keys(LAYER_APPEARANCES)) await apply(layerId, mapStrategy)
  }

  return { appearanceOf, setAppearance, setLayerVisible, applyAll }
})
