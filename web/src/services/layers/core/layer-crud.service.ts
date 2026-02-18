/**
 * Layer CRUD Service
 * 
 * Handles basic Create, Read, Update, Delete operations for layers and layer groups.
 * This service communicates with the backend API for persistence.
 */

import { api } from '@/lib/api'
import type { Layer, LayerGroup } from '@/types/map.types'

export function useLayerCrudService() {
  // ============================================================================
  // LAYER CRUD OPERATIONS
  // ============================================================================

  async function getLayers() {
    const { data } = await api.get<Layer[]>('/library/layers')
    return data
  }

  async function createLayer(
    layer: Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
  ) {
    const { data } = await api.post<Layer>('/library/layers', layer)
    return data
  }

  async function updateLayer(id: string, updates: Partial<Layer>) {
    const { data } = await api.put<Layer>(`/library/layers/${id}`, updates)
    return data
  }

  async function deleteLayer(id: string) {
    await api.delete(`/library/layers/${id}`)
  }

  // ============================================================================
  // LAYER GROUP CRUD OPERATIONS
  // ============================================================================

  async function getLayerGroups() {
    const { data } = await api.get<LayerGroup[]>('/library/layers/groups')
    return data
  }

  async function createLayerGroup(
    group: Omit<LayerGroup, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
  ) {
    const { data } = await api.post<LayerGroup>('/library/layers/groups', group)
    return data
  }

  async function updateLayerGroup(id: string, updates: Partial<LayerGroup>) {
    const { data } = await api.put<LayerGroup>(
      `/library/layers/groups/${id}`,
      updates,
    )
    return data
  }

  async function deleteLayerGroup(id: string) {
    await api.delete(`/library/layers/groups/${id}`)
  }

  // ============================================================================
  // REORDERING OPERATIONS
  // ============================================================================

  async function reorderLayers(
    items: { id: string; order: number; groupId?: string | null }[],
  ): Promise<boolean> {
    try {
      await api.put('/library/layers/reorder', { items })
      return true
    } catch (error) {
      console.error('Failed to reorder layers:', error)
      return false
    }
  }

  async function moveLayer(
    layerId: string,
    targetGroupId: string | null,
    targetOrder: number,
  ) {
    const { data } = await api.put(`/library/layers/${layerId}/move`, {
      targetGroupId,
      targetOrder,
    })
    return data
  }

  async function moveLayerGroup(groupId: string, targetOrder: number) {
    const { data } = await api.put(`/library/layers/groups/${groupId}/move`, {
      targetOrder,
    })
    return data
  }

  return {
    // Layer operations
    getLayers,
    createLayer,
    updateLayer,
    deleteLayer,
    
    // Layer group operations
    getLayerGroups,
    createLayerGroup,
    updateLayerGroup,
    deleteLayerGroup,
    
    // Reordering operations
    reorderLayers,
    moveLayer,
    moveLayerGroup,
  }
}
