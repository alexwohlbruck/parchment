/**
 * Layer CRUD Service
 *
 * Handles Create, Read, Update, Delete operations for user-owned layers and
 * layer groups, plus the sidecar that records what the user has done with the
 * read-only default templates.
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
  /**
   * Whether the user removed this template from their library. `null` means
   * they never said either way, so the template's `installedByDefault` decides.
   */
  hidden: boolean | null
  visible: boolean | null
  order: number | null
  enabled: boolean | null
  showInLayerSelector: boolean | null
  groupId: string | null
  parentGroupId: string | null
  createdAt: string
  updatedAt: string
}

export interface DefaultStatePatch {
  hidden?: boolean | null
  visible?: boolean | null
  order?: number | null
  enabled?: boolean | null
  showInLayerSelector?: boolean | null
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
  // DEFAULT TEMPLATES + STATE SIDECAR
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

    // Default templates + state
    getDefaultTemplates,
    getDefaultUserState,
    upsertDefaultUserState,
    clearDefaultUserState,
  }
}
