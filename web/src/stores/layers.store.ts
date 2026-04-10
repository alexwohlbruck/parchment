import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Layer, LayerGroup, LayerGroupWithLayers } from '@/types/map.types'
import { LayerType, MapEngine } from '@/types/map.types'
import {
  useLayerCrudService,
  type DefaultUserStateRow,
  type DefaultStatePatch,
  type DefaultStateType,
} from '@/services/layers/core/layer-crud.service'
import { useLayersService } from '@/services/layers/layers.service'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useStorage } from '@vueuse/core'
import { jsonSerializer } from '@/lib/storage'
import {
  CORE_LAYERS,
  CORE_LAYER_IDS,
  serverUrl,
} from '@/constants/layer.constants'

/**
 * Fields on a layer that, when modified, trigger a clone-on-modify of the
 * default template. Changing any other field (visibility, order, groupId,
 * enabled) is considered a "light override" and stored in the sidecar state
 * rather than creating a clone.
 */
const LAYER_CONTENT_FIELDS = new Set<keyof Layer>([
  'name',
  'icon',
  'configuration',
  'fadeBasemap',
  'type',
  'engine',
  'isSubLayer',
  'showInLayerSelector',
  'integrationId',
])

const GROUP_CONTENT_FIELDS = new Set<keyof LayerGroup>([
  'name',
  'icon',
  'fadeBasemap',
  'showInLayerSelector',
  'integrationId',
])

function isTemplateId(id: string): boolean {
  return typeof id === 'string' && id.startsWith('default:')
}

function hasContentChanges(
  patch: Partial<Layer | LayerGroup>,
  contentFields: Set<string>,
): boolean {
  return Object.keys(patch).some(k => contentFields.has(k))
}

export const useLayersStore = defineStore('layers', () => {
  const layersService = useLayersService()
  const crudService = useLayerCrudService()
  const integrationsStore = useIntegrationsStore()

  // ==========================================================================
  // PERSISTED CACHES
  // ==========================================================================

  const cachedUserLayers = useStorage<Layer[] | null>(
    'parchment-user-layers',
    null,
    undefined,
    { serializer: jsonSerializer },
  )
  const cachedUserGroups = useStorage<LayerGroup[] | null>(
    'parchment-layer-groups',
    null,
    undefined,
    { serializer: jsonSerializer },
  )
  const cachedDefaultTemplates = useStorage<{
    layers: any[]
    groups: any[]
  } | null>('parchment-default-templates', null, undefined, {
    serializer: jsonSerializer,
  })
  const cachedDefaultState = useStorage<DefaultUserStateRow[] | null>(
    'parchment-default-state',
    null,
    undefined,
    { serializer: jsonSerializer },
  )

  // Visibility overrides are stored as small flat maps in localStorage, keyed
  // by layer/group ID. Visibility is ephemeral UI state — we never persist it
  // to the server or to the structural `defaultState` sidecar (which would
  // force a full JSON re-serialization on every toggle). This keeps toggles
  // cheap and makes them survive page refresh without a network round-trip.
  const layerVisibilityOverrides = useStorage<Record<string, boolean>>(
    'parchment-layer-visibility',
    {},
    undefined,
    { serializer: jsonSerializer },
  )
  const groupVisibilityOverrides = useStorage<Record<string, boolean>>(
    'parchment-group-visibility',
    {},
    undefined,
    { serializer: jsonSerializer },
  )

  function getLayerVisibilityOverride(id: string): boolean | undefined {
    const map = layerVisibilityOverrides.value
    if (!map) return undefined
    return map[id]
  }
  function getGroupVisibilityOverride(id: string): boolean | undefined {
    const map = groupVisibilityOverrides.value
    if (!map) return undefined
    return map[id]
  }

  // ==========================================================================
  // REACTIVE STATE
  // ==========================================================================

  // User-owned DB rows (custom layers + clones of defaults). Never contains
  // template-backed defaults.
  const userOwnedLayers = ref<Layer[]>(
    Array.isArray(cachedUserLayers.value) ? cachedUserLayers.value : [],
  )
  const userOwnedGroups = ref<LayerGroup[]>(
    Array.isArray(cachedUserGroups.value) ? cachedUserGroups.value : [],
  )

  // Server-side default templates (loaded once per session; refreshed in bg).
  const defaultLayerTemplates = ref<any[]>(
    cachedDefaultTemplates.value?.layers ?? [],
  )
  const defaultGroupTemplates = ref<any[]>(
    cachedDefaultTemplates.value?.groups ?? [],
  )

  // User's sidecar state for default templates (overrides + tombstones).
  const defaultState = ref<DefaultUserStateRow[]>(
    Array.isArray(cachedDefaultState.value) ? cachedDefaultState.value : [],
  )

  const isSyncing = ref(false)
  const isLoadingLayers = ref(false)

  // Fast lookup: `${templateId}|${type}` → state row
  const defaultStateIndex = computed(() => {
    const map = new Map<string, DefaultUserStateRow>()
    for (const row of defaultState.value) {
      map.set(`${row.templateId}|${row.type}`, row)
    }
    return map
  })

  function getDefaultLayerState(templateId: string) {
    return defaultStateIndex.value.get(`${templateId}|layer`) ?? null
  }
  function getDefaultGroupState(templateId: string) {
    return defaultStateIndex.value.get(`${templateId}|group`) ?? null
  }

  // ==========================================================================
  // CORE LAYERS (hardcoded, client-side only)
  // ==========================================================================

  const coreLayers = computed(() => {
    return CORE_LAYERS.map((layerTemplate, index) => ({
      ...layerTemplate,
      id: Object.values(CORE_LAYER_IDS)[index],
      userId: 'core',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      origin: 'core' as const,
    }))
  })

  // ==========================================================================
  // MERGED COMPOSITION (templates + user state → visible defaults)
  // ==========================================================================

  // Stable placeholder timestamps for template-projected rows. We intentionally
  // do NOT allocate `new Date()` per projection call — doing so produces a new
  // string on every computed re-eval, which breaks downstream shallow-equality
  // checks and can trigger spurious re-renders in watchers that depend on the
  // projected layer/group identity.
  const TEMPLATE_PLACEHOLDER_TIMESTAMP = '1970-01-01T00:00:00.000Z'

  /**
   * Project a default layer template into a Layer object with user state
   * applied. Returns null if the user has tombstoned the template (hidden).
   */
  function projectDefaultLayer(template: any): Layer | null {
    const state = getDefaultLayerState(template.templateId)
    if (state?.hidden) return null
    const visibilityOverride = getLayerVisibilityOverride(template.templateId)
    return {
      id: template.templateId,
      name: template.name,
      // `type` is the `LayerType` enum value carried straight from the
      // server template. Features like the street view control, transit
      // label fade, and friends handling all branch on this value, so we
      // must not normalize or downcast it to 'custom' here.
      type: template.type ?? LayerType.CUSTOM,
      engine: template.engine ?? [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      showInLayerSelector: template.showInLayerSelector,
      visible: visibilityOverride ?? state?.visible ?? template.visible,
      fadeBasemap: template.fadeBasemap ?? false,
      icon: template.icon ?? null,
      order: state?.order ?? template.order,
      groupId: state?.groupId !== undefined && state?.groupId !== null
        ? state.groupId
        : (template.groupId ?? null),
      configuration: template.configuration,
      isSubLayer: template.isSubLayer ?? false,
      enabled: state?.enabled ?? true,
      integrationId: template.integrationId ?? null,
      origin: 'default',
      userId: 'template',
      createdAt: TEMPLATE_PLACEHOLDER_TIMESTAMP,
      updatedAt: TEMPLATE_PLACEHOLDER_TIMESTAMP,
    } as unknown as Layer
  }

  function projectDefaultGroup(template: any): LayerGroup | null {
    const state = getDefaultGroupState(template.templateId)
    if (state?.hidden) return null
    const visibilityOverride = getGroupVisibilityOverride(template.templateId)
    return {
      id: template.templateId,
      name: template.name,
      showInLayerSelector: template.showInLayerSelector,
      visible: visibilityOverride ?? state?.visible ?? template.visible,
      fadeBasemap: template.fadeBasemap ?? false,
      icon: template.icon ?? undefined,
      order: state?.order ?? template.order,
      parentGroupId:
        state?.parentGroupId !== undefined && state?.parentGroupId !== null
          ? state.parentGroupId
          : (template.parentGroupId ?? null),
      integrationId: template.integrationId ?? null,
      origin: 'default',
      userId: 'template',
      createdAt: TEMPLATE_PLACEHOLDER_TIMESTAMP,
      updatedAt: TEMPLATE_PLACEHOLDER_TIMESTAMP,
    } as unknown as LayerGroup
  }

  const mergedLayers = computed<Layer[]>(() => {
    const projected: Layer[] = []
    for (const template of defaultLayerTemplates.value) {
      const p = projectDefaultLayer(template)
      if (p) projected.push(p)
    }
    const customs = Array.isArray(userOwnedLayers.value)
      ? userOwnedLayers.value.map(l => {
          const override = getLayerVisibilityOverride(l.id)
          return {
            ...l,
            origin: 'custom' as const,
            visible: override ?? l.visible,
          }
        })
      : []
    return [...projected, ...customs]
  })

  const mergedGroups = computed<LayerGroup[]>(() => {
    const projected: LayerGroup[] = []
    for (const template of defaultGroupTemplates.value) {
      const p = projectDefaultGroup(template)
      if (p) projected.push(p)
    }
    const customs = Array.isArray(userOwnedGroups.value)
      ? userOwnedGroups.value.map(g => {
          const override = getGroupVisibilityOverride(g.id)
          return {
            ...g,
            origin: 'custom' as const,
            visible: override ?? g.visible,
          }
        })
      : []
    return [...projected, ...customs]
  })

  // ==========================================================================
  // INTEGRATION FILTERING
  // ==========================================================================

  // Precompute the set of configured integration IDs (lowercased) once per
  // dependency change rather than re-scanning the `configuredIntegrations`
  // array for every layer on every merge. This turns a previously O(n*m)
  // filter into O(n + m).
  const configuredIntegrationSet = computed(() => {
    const set = new Set<string>()
    for (const i of integrationsStore.configuredIntegrations) {
      set.add(i.id.toLowerCase())
    }
    return set
  })

  function isIntegrationAvailable(integrationId?: string | null) {
    if (!integrationId) return true
    return configuredIntegrationSet.value.has(integrationId.toLowerCase())
  }

  const filteredMergedLayers = computed(() => {
    const set = configuredIntegrationSet.value
    return mergedLayers.value.filter(l => {
      if (!l.integrationId) return true
      return set.has(l.integrationId.toLowerCase())
    })
  })

  const allLayerGroups = computed(() => {
    const set = configuredIntegrationSet.value
    return mergedGroups.value.filter(g => {
      if (!g.integrationId) return true
      return set.has(g.integrationId.toLowerCase())
    })
  })

  // Kept for backwards compatibility: alias used by many components.
  const layerGroups = allLayerGroups

  // Used by navigation / layer rendering: core + merged (filtered).
  const layers = computed<Layer[]>(() => [
    ...coreLayers.value,
    ...filteredMergedLayers.value,
  ])

  // Kept for backwards compat: some code reads `userLayers` directly.
  // In the new architecture this is just the full merged list.
  const userLayers = filteredMergedLayers

  // ==========================================================================
  // GROUP TREE / SETTINGS VIEWS
  // ==========================================================================

  interface GroupTreeNode extends LayerGroup {
    layers: Layer[]
    children: GroupTreeNode[]
  }

  function buildGroupNode(group: LayerGroup): GroupTreeNode {
    return {
      ...group,
      layers: filteredMergedLayers.value
        .filter(l => l.groupId === group.id)
        .sort((a, b) => a.order - b.order),
      children: allLayerGroups.value
        .filter(g => g.parentGroupId === group.id)
        .sort((a, b) => a.order - b.order)
        .map(buildGroupNode),
    }
  }

  const groupTree = computed(() => {
    const topLevel = allLayerGroups.value.filter(g => !g.parentGroupId)
    return topLevel.sort((a, b) => a.order - b.order).map(buildGroupNode)
  })

  // Precompute total layer counts for every group in a single pass, rather
  // than recursively walking the group tree each time a template asks for a
  // count. With nested groups and dozens of layers, the old implementation
  // was O(groups * groups * layers) per render. This is O(layers + groups).
  const groupLayerCountMap = computed(() => {
    const directCounts = new Map<string, number>()
    for (const layer of filteredMergedLayers.value) {
      if (!layer.groupId) continue
      directCounts.set(
        layer.groupId,
        (directCounts.get(layer.groupId) ?? 0) + 1,
      )
    }

    const childrenByParent = new Map<string, string[]>()
    for (const group of allLayerGroups.value) {
      if (!group.parentGroupId) continue
      const list = childrenByParent.get(group.parentGroupId) ?? []
      list.push(group.id)
      childrenByParent.set(group.parentGroupId, list)
    }

    const totals = new Map<string, number>()
    const inProgress = new Set<string>()
    function computeTotal(groupId: string): number {
      const cached = totals.get(groupId)
      if (cached !== undefined) return cached
      if (inProgress.has(groupId)) return 0 // guard against cycles
      inProgress.add(groupId)
      let total = directCounts.get(groupId) ?? 0
      const children = childrenByParent.get(groupId) ?? []
      for (const childId of children) total += computeTotal(childId)
      inProgress.delete(groupId)
      totals.set(groupId, total)
      return total
    }

    for (const group of allLayerGroups.value) computeTotal(group.id)
    return totals
  })

  function getGroupTotalLayerCount(groupId: string): number {
    return groupLayerCountMap.value.get(groupId) ?? 0
  }

  const ungroupedLayers = computed(() =>
    filteredMergedLayers.value
      .filter(layer => !layer.groupId && !layer.isSubLayer)
      .sort((a, b) => a.order - b.order),
  )

  const sortedGroups = computed(() =>
    allLayerGroups.value.slice().sort((a, b) => a.order - b.order),
  )

  const groupsWithLayers = computed<LayerGroupWithLayers[]>(() =>
    sortedGroups.value.map(group => ({
      ...group,
      layers: filteredMergedLayers.value
        .filter(layer => layer.groupId === group.id)
        .sort((a, b) => a.order - b.order),
    })),
  )

  const mainReorderableItems = computed(() => {
    const userUngrouped = filteredMergedLayers.value.filter(
      layer => !layer.groupId && !layer.isSubLayer,
    )
    const topLevelGroups = allLayerGroups.value.filter(g => !g.parentGroupId)
    const items: (Layer | LayerGroup)[] = [...userUngrouped, ...topLevelGroups]
    return items.sort((a, b) => a.order - b.order)
  })

  // ==========================================================================
  // LOADING
  // ==========================================================================

  async function loadLayers() {
    const hasCache =
      Array.isArray(cachedUserLayers.value) ||
      Array.isArray(cachedUserGroups.value) ||
      cachedDefaultTemplates.value !== null

    const fetchAll = async () => {
      const [userLayersData, userGroupsData, templates, stateRows] =
        await Promise.all([
          crudService.getLayers(),
          crudService.getLayerGroups(),
          crudService.getDefaultTemplates(),
          crudService.getDefaultUserState(),
        ])
      userOwnedLayers.value = userLayersData
      userOwnedGroups.value = userGroupsData
      defaultLayerTemplates.value = templates.layers ?? []
      defaultGroupTemplates.value = templates.groups ?? []
      defaultState.value = stateRows
      cachedUserLayers.value = userLayersData
      cachedUserGroups.value = userGroupsData
      cachedDefaultTemplates.value = templates
      cachedDefaultState.value = stateRows
    }

    if (hasCache) {
      // Serve from cache, refresh in background.
      fetchAll().catch(error => {
        console.error('Failed to refresh layers:', error)
      })
      return
    }

    isLoadingLayers.value = true
    try {
      await fetchAll()
    } finally {
      isLoadingLayers.value = false
    }
  }

  /**
   * Restore defaults: clear all state sidecar rows (un-hide tombstones,
   * reset visibility/order overrides). User-owned clones remain.
   *
   * Also clears the localStorage visibility override maps — otherwise a user
   * who had toggled off a default layer would see the layer stay off even
   * after restoring defaults, because the sidecar clear doesn't touch the
   * ephemeral visibility cache.
   */
  async function restoreDefaults() {
    try {
      const result = await crudService.restoreDefaults()
      defaultState.value = []
      cachedDefaultState.value = []
      layerVisibilityOverrides.value = {}
      groupVisibilityOverrides.value = {}
      return {
        success: true,
        restoredLayers: result.cleared,
        restoredGroups: 0,
      }
    } catch (error) {
      console.error('Failed to restore defaults:', error)
      return { success: false, restoredLayers: 0, restoredGroups: 0 }
    }
  }

  // ==========================================================================
  // CACHE SYNC HELPERS
  // ==========================================================================

  function syncLayersToCache() {
    cachedUserLayers.value = [...userOwnedLayers.value]
  }
  function syncGroupsToCache() {
    cachedUserGroups.value = [...userOwnedGroups.value]
  }
  function syncStateToCache() {
    cachedDefaultState.value = [...defaultState.value]
  }

  // ==========================================================================
  // STATE SIDECAR UPDATES (for default templates)
  // ==========================================================================

  function upsertLocalState(
    templateId: string,
    type: DefaultStateType,
    patch: DefaultStatePatch,
  ) {
    // Build a new row object rather than mutating the existing one in place.
    // The computed `defaultStateIndex` is built from this array, and in-place
    // mutation of a row doesn't invalidate any memoized computed that depends
    // on row identity (e.g. downstream watchers with shallow equality checks).
    const now = new Date().toISOString()
    const existingIndex = defaultState.value.findIndex(
      r => r.templateId === templateId && r.type === type,
    )
    if (existingIndex !== -1) {
      const existing = defaultState.value[existingIndex]
      const nextRow: DefaultUserStateRow = {
        ...existing,
        ...patch,
        updatedAt: now,
      }
      const nextArr = defaultState.value.slice()
      nextArr[existingIndex] = nextRow
      defaultState.value = nextArr
    } else {
      defaultState.value = [
        ...defaultState.value,
        {
          userId: 'me',
          templateId,
          type,
          hidden: patch.hidden ?? false,
          visible: patch.visible ?? null,
          order: patch.order ?? null,
          enabled: patch.enabled ?? null,
          groupId: patch.groupId ?? null,
          parentGroupId: patch.parentGroupId ?? null,
          createdAt: now,
          updatedAt: now,
        },
      ]
    }
  }

  async function patchDefaultLayerState(
    templateId: string,
    patch: DefaultStatePatch,
  ) {
    upsertLocalState(templateId, 'layer', patch)
    syncStateToCache()
    try {
      await crudService.upsertDefaultUserState(templateId, 'layer', patch)
    } catch (error) {
      console.error('Failed to sync default layer state:', error)
      await loadLayers()
    }
  }

  async function patchDefaultGroupState(
    templateId: string,
    patch: DefaultStatePatch,
  ) {
    upsertLocalState(templateId, 'group', patch)
    syncStateToCache()
    try {
      await crudService.upsertDefaultUserState(templateId, 'group', patch)
    } catch (error) {
      console.error('Failed to sync default group state:', error)
      await loadLayers()
    }
  }

  // ==========================================================================
  // LAYER CRUD — routes to state/clone/userLayers based on id
  // ==========================================================================

  async function addLayer(
    layer: Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
  ) {
    const newLayer = await crudService.createLayer(layer)
    userOwnedLayers.value.push(newLayer)
    syncLayersToCache()
    return newLayer
  }

  async function updateLayer(id: string, updates: Partial<Layer>) {
    if (Object.values(CORE_LAYER_IDS).includes(id as any)) {
      console.warn('Cannot update core layer:', id)
      return
    }

    if (isTemplateId(id)) {
      // Content edits → clone-on-modify
      if (hasContentChanges(updates, LAYER_CONTENT_FIELDS)) {
        const clone = await crudService.cloneDefaultLayer(id, updates)
        userOwnedLayers.value.push(clone)
        // Server created a hidden=true state row; reflect locally
        upsertLocalState(id, 'layer', { hidden: true })
        syncLayersToCache()
        syncStateToCache()
        return clone
      }
      // Light override → sidecar state.
      // NB: `visible` is intentionally NOT forwarded here. Visibility is
      // ephemeral UI state and flows exclusively through
      // `updateLayerVisibility` (localStorage override map). Persisting it to
      // the sidecar would double-write and re-introduce the cross-device
      // "visibility sync" behavior we explicitly removed.
      const patch: DefaultStatePatch = {}
      if ('order' in updates) patch.order = updates.order
      if ('enabled' in updates) patch.enabled = updates.enabled
      if ('groupId' in updates) patch.groupId = updates.groupId
      if (Object.keys(patch).length === 0) return
      await patchDefaultLayerState(id, patch)
      return
    }

    // Normal user-owned layer
    const updatedLayer = await crudService.updateLayer(id, updates)
    const index = userOwnedLayers.value.findIndex(l => l.id === id)
    if (index !== -1) userOwnedLayers.value[index] = updatedLayer
    syncLayersToCache()
    return updatedLayer
  }

  async function removeLayer(id: string) {
    if (Object.values(CORE_LAYER_IDS).includes(id as any)) {
      console.warn('Cannot remove core layer:', id)
      return
    }

    if (isTemplateId(id)) {
      // Hide the default template (tombstone)
      await patchDefaultLayerState(id, { hidden: true })
      return
    }

    await crudService.deleteLayer(id)
    userOwnedLayers.value = userOwnedLayers.value.filter(l => l.id !== id)
    syncLayersToCache()
  }

  // ==========================================================================
  // LAYER GROUP CRUD
  // ==========================================================================

  async function addLayerGroup(
    group: Omit<LayerGroup, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
  ) {
    const newGroup = await crudService.createLayerGroup(group)
    userOwnedGroups.value.push(newGroup)
    syncGroupsToCache()
    return newGroup
  }

  async function updateLayerGroup(id: string, updates: Partial<LayerGroup>) {
    if (isTemplateId(id)) {
      if (hasContentChanges(updates, GROUP_CONTENT_FIELDS)) {
        const clone = await crudService.cloneDefaultGroup(id, updates)
        userOwnedGroups.value.push(clone)
        upsertLocalState(id, 'group', { hidden: true })
        syncGroupsToCache()
        syncStateToCache()
        return clone
      }
      // `visible` is intentionally NOT forwarded here — see updateLayer for
      // the rationale. Group visibility lives in the local override map.
      const patch: DefaultStatePatch = {}
      if ('order' in updates) patch.order = updates.order
      if ('parentGroupId' in updates) patch.parentGroupId = updates.parentGroupId
      if (Object.keys(patch).length === 0) return
      await patchDefaultGroupState(id, patch)
      return
    }

    const updatedGroup = await crudService.updateLayerGroup(id, updates)
    const index = userOwnedGroups.value.findIndex(g => g.id === id)
    if (index !== -1) userOwnedGroups.value[index] = updatedGroup
    syncGroupsToCache()
    return updatedGroup
  }

  async function removeLayerGroup(id: string) {
    if (isTemplateId(id)) {
      // Tombstone the default group itself, and also reassign any layers
      // currently projected into this group out to the top level. Without
      // this, layers whose template or state still points at `id` would
      // effectively become invisible in the UI (the group is hidden so it
      // has no row, but the layers still claim `groupId === id`).
      const orphanedLayers = filteredMergedLayers.value.filter(
        l => l.groupId === id,
      )
      for (const layer of orphanedLayers) {
        if (isTemplateId(layer.id)) {
          await patchDefaultLayerState(layer.id, { groupId: null })
        } else {
          // User-owned clone or custom layer — move via normal CRUD path.
          try {
            const updated = await crudService.updateLayer(layer.id, {
              groupId: null,
            })
            const idx = userOwnedLayers.value.findIndex(l => l.id === layer.id)
            if (idx !== -1) userOwnedLayers.value[idx] = updated
          } catch (error) {
            console.error('Failed to reparent orphaned layer:', error)
          }
        }
      }
      // Also reparent any user-owned child groups out to the top level so
      // the subtree doesn't disappear with the tombstoned parent.
      const orphanedChildren = userOwnedGroups.value.filter(
        g => g.parentGroupId === id,
      )
      for (const child of orphanedChildren) {
        try {
          const updated = await crudService.updateLayerGroup(child.id, {
            parentGroupId: null,
          })
          const idx = userOwnedGroups.value.findIndex(g => g.id === child.id)
          if (idx !== -1) userOwnedGroups.value[idx] = updated
        } catch (error) {
          console.error('Failed to reparent orphaned child group:', error)
        }
      }
      syncLayersToCache()
      syncGroupsToCache()
      await patchDefaultGroupState(id, { hidden: true })
      return
    }

    await crudService.deleteLayerGroup(id)
    // Recursively collect all descendant user-owned group IDs
    function collectDescendantIds(parentId: string): string[] {
      const children = userOwnedGroups.value.filter(
        g => g.parentGroupId === parentId,
      )
      return children.flatMap(c => [c.id, ...collectDescendantIds(c.id)])
    }
    const allIds = new Set([id, ...collectDescendantIds(id)])
    userOwnedGroups.value = userOwnedGroups.value.filter(
      g => !allIds.has(g.id),
    )
    userOwnedLayers.value = userOwnedLayers.value.filter(
      l => !l.groupId || !allIds.has(l.groupId),
    )
    syncGroupsToCache()
    syncLayersToCache()
  }

  // ==========================================================================
  // VISIBILITY (OPTIMISTIC LOCAL UPDATES)
  // ==========================================================================

  // Visibility updates live purely in the local override maps — no DB sync
  // and no mutation of the merged-layer pipeline's source data. This is the
  // single write site that drives every layer/group's visibility regardless
  // of whether it's template-backed or user-owned. Writing a new object
  // triggers the useStorage reactive write + localStorage persistence, so
  // toggles survive page refresh without a network round-trip.
  function updateLayerVisibility(layerId: string, visible: boolean) {
    layerVisibilityOverrides.value = {
      ...(layerVisibilityOverrides.value ?? {}),
      [layerId]: visible,
    }
  }

  function toggleLayerGroupVisibility(groupId: string, visible: boolean) {
    groupVisibilityOverrides.value = {
      ...(groupVisibilityOverrides.value ?? {}),
      [groupId]: visible,
    }
  }

  // ==========================================================================
  // DRAG AND DROP / REORDERING
  // ==========================================================================

  interface ReorderUpdate {
    id: string
    order: number
    groupId?: string | null
  }

  async function syncReorderUpdates(
    userUpdates: ReorderUpdate[],
    stateUpdates: Array<{
      templateId: string
      type: DefaultStateType
      patch: DefaultStatePatch
    }>,
  ) {
    isSyncing.value = true
    try {
      const promises: Promise<any>[] = []
      if (userUpdates.length > 0) {
        promises.push(crudService.reorderLayers(userUpdates))
      }
      for (const u of stateUpdates) {
        upsertLocalState(u.templateId, u.type, u.patch)
        promises.push(
          crudService.upsertDefaultUserState(u.templateId, u.type, u.patch),
        )
      }
      await Promise.all(promises)
      syncLayersToCache()
      syncGroupsToCache()
      syncStateToCache()
    } catch (error) {
      console.error('Failed to sync reorder with server:', error)
      await loadLayers()
    } finally {
      isSyncing.value = false
    }
  }

  async function handleMainReorder(newItems: (Layer | LayerGroup)[]) {
    const userUpdates: ReorderUpdate[] = []
    const stateUpdates: Array<{
      templateId: string
      type: DefaultStateType
      patch: DefaultStatePatch
    }> = []

    newItems.forEach((item, index) => {
      const isLayer = 'groupId' in item
      if (isTemplateId(item.id)) {
        stateUpdates.push({
          templateId: item.id,
          type: isLayer ? 'layer' : 'group',
          patch: isLayer
            ? { order: index, groupId: null }
            : { order: index, parentGroupId: null },
        })
      } else if (isLayer) {
        const layer = userOwnedLayers.value.find(l => l.id === item.id)
        if (layer) {
          layer.order = index
          layer.groupId = null
        }
        userUpdates.push({ id: item.id, order: index, groupId: null })
      } else {
        const group = userOwnedGroups.value.find(g => g.id === item.id)
        if (group) {
          group.order = index
          group.parentGroupId = null
        }
        userUpdates.push({ id: item.id, order: index })
      }
    })

    await syncReorderUpdates(userUpdates, stateUpdates)
  }

  async function handleUngroupedReorder(newLayers: Layer[]) {
    await handleMainReorder(newLayers)
  }

  async function handleGroupReorder(groupId: string, newLayers: Layer[]) {
    const userUpdates: ReorderUpdate[] = []
    const stateUpdates: Array<{
      templateId: string
      type: DefaultStateType
      patch: DefaultStatePatch
    }> = []

    newLayers.forEach((layer, index) => {
      if (isTemplateId(layer.id)) {
        stateUpdates.push({
          templateId: layer.id,
          type: 'layer',
          patch: { order: index, groupId },
        })
      } else {
        const local = userOwnedLayers.value.find(l => l.id === layer.id)
        if (local) {
          local.order = index
          local.groupId = groupId
        }
        userUpdates.push({ id: layer.id, order: index, groupId })
      }
    })

    await syncReorderUpdates(userUpdates, stateUpdates)
  }

  async function handleMixedGroupReorder(
    parentGroupId: string | null,
    newItems: (Layer | LayerGroup)[],
  ) {
    const userUpdates: ReorderUpdate[] = []
    const stateUpdates: Array<{
      templateId: string
      type: DefaultStateType
      patch: DefaultStatePatch
    }> = []

    newItems.forEach((item, index) => {
      const isLayer = 'groupId' in item
      if (isTemplateId(item.id)) {
        stateUpdates.push({
          templateId: item.id,
          type: isLayer ? 'layer' : 'group',
          patch: isLayer
            ? { order: index, groupId: parentGroupId }
            : { order: index, parentGroupId },
        })
      } else if (isLayer) {
        const layer = userOwnedLayers.value.find(l => l.id === item.id)
        if (layer) {
          layer.order = index
          layer.groupId = parentGroupId
        }
        userUpdates.push({ id: item.id, order: index, groupId: parentGroupId })
      } else {
        const group = userOwnedGroups.value.find(g => g.id === item.id)
        if (group) {
          group.order = index
          group.parentGroupId = parentGroupId
        }
        userUpdates.push({ id: item.id, order: index })
      }
    })

    await syncReorderUpdates(userUpdates, stateUpdates)
  }

  async function handleLayerMove(
    layerId: string,
    newGroupId: string | null,
    newIndex: number,
  ) {
    // Template-backed layer → state update
    if (isTemplateId(layerId)) {
      await patchDefaultLayerState(layerId, {
        groupId: newGroupId,
        order: newIndex,
      })
      return
    }

    const movingLayer = userOwnedLayers.value.find(l => l.id === layerId)
    if (!movingLayer) return

    movingLayer.groupId = newGroupId
    movingLayer.order = newIndex

    isSyncing.value = true
    try {
      await crudService.moveLayer(layerId, newGroupId, newIndex)
      syncLayersToCache()
    } catch (error) {
      console.error('Failed to sync layer move:', error)
      await loadLayers()
    } finally {
      isSyncing.value = false
    }
  }

  async function handleGroupMove(
    groupId: string,
    newParentGroupId: string | null,
    newIndex: number,
  ) {
    if (isTemplateId(groupId)) {
      await patchDefaultGroupState(groupId, {
        parentGroupId: newParentGroupId,
        order: newIndex,
      })
      return
    }

    const movingGroup = userOwnedGroups.value.find(g => g.id === groupId)
    if (!movingGroup) return

    movingGroup.parentGroupId = newParentGroupId
    movingGroup.order = newIndex

    isSyncing.value = true
    try {
      await crudService.moveLayerGroup(groupId, newIndex, newParentGroupId)
      syncGroupsToCache()
    } catch (error) {
      console.error('Failed to sync group move:', error)
      await loadLayers()
    } finally {
      isSyncing.value = false
    }
  }

  // ==========================================================================
  // SERVER URL CHANGE WATCHER
  // ==========================================================================

  watch(serverUrl, async (newUrl, oldUrl) => {
    if (newUrl === oldUrl) return

    // Re-fetch default templates so proxy URLs get resolved with the new server
    try {
      const templates = await crudService.getDefaultTemplates()
      defaultLayerTemplates.value = templates.layers ?? []
      defaultGroupTemplates.value = templates.groups ?? []
      cachedDefaultTemplates.value = templates
    } catch (error) {
      console.error('Failed to refresh default templates:', error)
    }

    // Also rewrite any user-owned cloned layers that have proxy URLs pointing
    // at the old server.
    const layersToUpdate = userOwnedLayers.value.filter(layer => {
      if (
        typeof layer.configuration.source === 'object' &&
        layer.configuration.source.tiles
      ) {
        return layer.configuration.source.tiles.some(
          (tileUrl: string) =>
            tileUrl.includes('/proxy/') && tileUrl.includes(oldUrl),
        )
      }
      return false
    })

    for (const layer of layersToUpdate) {
      if (
        typeof layer.configuration.source === 'object' &&
        layer.configuration.source.tiles
      ) {
        const updatedTiles = layer.configuration.source.tiles.map(
          (tileUrl: string) => tileUrl.replace(oldUrl, newUrl),
        )
        await updateLayer(layer.id, {
          configuration: {
            ...layer.configuration,
            source: {
              ...layer.configuration.source,
              tiles: updatedTiles,
            },
          },
        })
      }
    }
  })

  function clearCache() {
    userOwnedLayers.value = []
    userOwnedGroups.value = []
    defaultState.value = []
    defaultLayerTemplates.value = []
    defaultGroupTemplates.value = []
    cachedUserLayers.value = null
    cachedUserGroups.value = null
    cachedDefaultTemplates.value = null
    cachedDefaultState.value = null
  }

  return {
    // Primary reactive state
    layers,
    userLayers,
    coreLayers,
    layerGroups,
    allLayerGroups,
    isSyncing,
    isLoadingLayers,

    // Lower-level state (for debugging / specific consumers)
    userOwnedLayers,
    userOwnedGroups,
    defaultLayerTemplates,
    defaultGroupTemplates,
    defaultState,

    // Settings-panel views
    ungroupedLayers,
    groupsWithLayers,
    mainReorderableItems,
    groupTree,
    getGroupTotalLayerCount,

    // Data operations
    loadLayers,
    restoreDefaults,
    addLayer,
    updateLayer,
    removeLayer,
    addLayerGroup,
    updateLayerGroup,
    removeLayerGroup,

    // Optimistic visibility
    updateLayerVisibility,
    toggleLayerGroupVisibility,

    // Drag and drop
    handleMainReorder,
    handleUngroupedReorder,
    handleGroupReorder,
    handleMixedGroupReorder,
    handleLayerMove,
    handleGroupMove,

    // Cache
    clearCache,
  }
})
