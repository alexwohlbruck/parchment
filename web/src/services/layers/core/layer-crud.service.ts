/**
 * Layer CRUD Service
 *
 * Handles Create, Read, Update, Delete operations for user-owned layers and
 * layer groups, plus the default-template state sidecar and clone operations.
 *
 * Important: the server returns ONLY user-owned rows from /library/layers.
 * Default templates are fetched separately via getDefaultTemplates() and
 * composed with the user state in the store.
 */

import { api } from '@/lib/api'
import type { Layer, LayerGroup } from '@/types/map.types'

export type DefaultStateType = 'layer' | 'group'

export interface DefaultUserStateRow {
  userId: string
  templateId: string
  type: DefaultStateType
  hidden: boolean
  visible: boolean | null
  order: number | null
  enabled: boolean | null
  groupId: string | null
  parentGroupId: string | null
  createdAt: string
  updatedAt: string
}

export interface DefaultStatePatch {
  hidden?: boolean
  visible?: boolean | null
  order?: number | null
  enabled?: boolean | null
  groupId?: string | null
  parentGroupId?: string | null
}

export function useLayerCrudService() {
  // ============================================================================
  // USER-OWNED LAYER CRUD
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
  // USER-OWNED LAYER GROUP CRUD
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
  // REORDERING
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

  async function moveLayerGroup(
    groupId: string,
    targetOrder: number,
    targetParentGroupId?: string | null,
  ) {
    const { data } = await api.put(`/library/layers/groups/${groupId}/move`, {
      targetOrder,
      targetParentGroupId,
    })
    return data
  }

  // ============================================================================
  // DEFAULT TEMPLATES + STATE SIDECAR + CLONE/RESTORE
  // ============================================================================

  async function getDefaultTemplates() {
    const { data } = await api.get<{
      layers: any[]
      groups: any[]
    }>('/library/layers/defaults')
    return data
  }

  async function getDefaultUserState() {
    const { data } = await api.get<DefaultUserStateRow[]>(
      '/library/layers/default-state',
    )
    return data
  }

  async function upsertDefaultUserState(
    templateId: string,
    type: DefaultStateType,
    patch: DefaultStatePatch,
  ) {
    const { data } = await api.put<DefaultUserStateRow>(
      '/library/layers/default-state',
      { templateId, type, ...patch },
    )
    return data
  }

  async function clearDefaultUserState(
    templateId: string,
    type: DefaultStateType,
  ) {
    await api.delete('/library/layers/default-state', {
      data: { templateId, type },
    } as any)
  }

  async function cloneDefaultLayer(
    templateId: string,
    patch: Partial<Layer> = {},
  ) {
    const { data } = await api.post<Layer>('/library/layers/default-clone/layer', {
      templateId,
      patch,
    })
    return data
  }

  async function cloneDefaultGroup(
    templateId: string,
    patch: Partial<LayerGroup> = {},
  ) {
    const { data } = await api.post<LayerGroup>(
      '/library/layers/default-clone/group',
      { templateId, patch },
    )
    return data
  }

  async function restoreDefaults() {
    const { data } = await api.post<{ success: boolean; cleared: number }>(
      '/library/layers/restore-defaults',
    )
    return data
  }

  return {
    // Layer CRUD
    getLayers,
    createLayer,
    updateLayer,
    deleteLayer,

    // Layer group CRUD
    getLayerGroups,
    createLayerGroup,
    updateLayerGroup,
    deleteLayerGroup,

    // Reordering
    reorderLayers,
    moveLayer,
    moveLayerGroup,

    // Default templates + state + clone
    getDefaultTemplates,
    getDefaultUserState,
    upsertDefaultUserState,
    clearDefaultUserState,
    cloneDefaultLayer,
    cloneDefaultGroup,
    restoreDefaults,
  }
}
