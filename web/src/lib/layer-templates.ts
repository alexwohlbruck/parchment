/**
 * Membership rules for the default (system) layer templates.
 *
 * Templates live in `server/src/constants/default-layers` and are read-only.
 * What a user *can* decide is whether a template is in their library at all,
 * and that decision is a single `hidden` flag in the sidecar state — `null`
 * meaning "never decided", which hands it back to the template's
 * `installedByDefault`. That's what keeps a store-only bundle (Terrain, Time
 * Zones, Air Quality, Wildfires, OSM Notes) out of a fresh library without a
 * per-user row existing for it.
 *
 * Membership cascades down the template tree, so removing a group takes its
 * subgroups and layers with it and adding it back brings them along, all off
 * one state row. Everything here is pure so the rules can be tested without a
 * Pinia store, a server or a map.
 */

import type { DefaultUserStateRow } from '@/services/layers/core/layer-crud.service'
import type { DefaultStateType } from '@/services/layers/core/layer-crud.service'

/** The parts of a template these rules read. */
export interface DefaultTemplateLike {
  templateId: string
  name: string
  description?: string
  icon?: string | null
  order?: number
  integrationId?: string | null
  installedByDefault?: boolean
}

export interface GroupTemplateLike extends DefaultTemplateLike {
  parentGroupId?: string | null
}

export interface LayerTemplateLike extends DefaultTemplateLike {
  groupId?: string | null
  isSubLayer?: boolean
}

/** Look up the user's sidecar row for a template, or null if they have none. */
export type StateLookup = (templateId: string) => DefaultUserStateRow | null

/**
 * One row in the layer store: a pre-defined bundle the user can add to their
 * library. A bundle is either a top-level default group (which brings its
 * subgroups and layers with it) or a standalone default layer.
 */
export interface LayerStoreItem {
  templateId: string
  type: DefaultStateType
  name: string
  description?: string
  icon?: string | null
  /** How many layers the bundle puts in the library. */
  layerCount: number
  added: boolean
}

/**
 * The user's own decision about a template, falling back to whether a fresh
 * library ships with it.
 */
export function isTemplateAdded(
  template: DefaultTemplateLike,
  state: DefaultUserStateRow | null,
): boolean {
  if (state?.hidden != null) return !state.hidden
  return template.installedByDefault ?? true
}

/** A group's parent, after any re-parenting the user has done. */
function effectiveParentId(
  template: GroupTemplateLike,
  state: DefaultUserStateRow | null,
): string | null {
  return state?.parentGroupId ?? template.parentGroupId ?? null
}

/** A layer's group, after any re-grouping the user has done. */
function effectiveGroupId(
  template: LayerTemplateLike,
  state: DefaultUserStateRow | null,
): string | null {
  return state?.groupId ?? template.groupId ?? null
}

/**
 * Template ids of the default groups currently in the library. A group only
 * counts as added when every default ancestor is too — a parent that isn't a
 * template is a user-owned group, which is always present.
 */
export function resolveAddedGroupIds(
  groupTemplates: GroupTemplateLike[],
  getGroupState: StateLookup,
): Set<string> {
  const byId = new Map(groupTemplates.map(t => [t.templateId, t]))
  const added = new Set<string>()
  const resolving = new Set<string>()

  function resolve(template: GroupTemplateLike): boolean {
    const id = template.templateId
    if (added.has(id)) return true
    if (resolving.has(id)) return false // guard against a cyclic parent chain
    resolving.add(id)
    try {
      const state = getGroupState(id)
      if (!isTemplateAdded(template, state)) return false
      const parentId = effectiveParentId(template, state)
      const parent = parentId ? byId.get(parentId) : undefined
      if (parent && !resolve(parent)) return false
      added.add(id)
      return true
    } finally {
      resolving.delete(id)
    }
  }

  for (const template of groupTemplates) resolve(template)
  return added
}

/**
 * Whether a layer template is in the library. A layer inside a removed default
 * group goes with it, whatever its own state row says.
 */
export function isLayerTemplateAdded(
  template: LayerTemplateLike,
  getLayerState: StateLookup,
  addedGroupIds: Set<string>,
  groupTemplateIds: Set<string>,
): boolean {
  const state = getLayerState(template.templateId)
  if (!isTemplateAdded(template, state)) return false
  const groupId = effectiveGroupId(template, state)
  if (groupId && groupTemplateIds.has(groupId)) {
    return addedGroupIds.has(groupId)
  }
  return true
}

/**
 * Every default group nested under `rootId`, itself included.
 *
 * `seen` guards the walk: re-parenting is a drag-and-drop away, so a group can
 * end up its own ancestor, and this would otherwise recurse forever.
 */
export function collectGroupSubtree(
  rootId: string,
  groupTemplates: GroupTemplateLike[],
  getGroupState: StateLookup,
  seen: Set<string> = new Set(),
): string[] {
  if (seen.has(rootId)) return []
  seen.add(rootId)

  const ids = [rootId]
  for (const template of groupTemplates) {
    const parentId = effectiveParentId(
      template,
      getGroupState(template.templateId),
    )
    if (parentId === rootId) {
      ids.push(
        ...collectGroupSubtree(
          template.templateId,
          groupTemplates,
          getGroupState,
          seen,
        ),
      )
    }
  }
  return ids
}

/** Layer templates that live inside any of `groupIds`. */
export function collectGroupLayerTemplateIds(
  groupIds: string[],
  layerTemplates: LayerTemplateLike[],
  getLayerState: StateLookup,
): string[] {
  const set = new Set(groupIds)
  return layerTemplates
    .filter(template => {
      const groupId = effectiveGroupId(
        template,
        getLayerState(template.templateId),
      )
      return !!groupId && set.has(groupId)
    })
    .map(template => template.templateId)
}

/**
 * The store catalogue: every bundle root, added or not. Bundles whose
 * integration isn't configured are left out — adding a layer that can't draw
 * anything is a dead end. Not-yet-added bundles sort first so the store leads
 * with what's on offer.
 */
export function buildLayerStoreItems(input: {
  groupTemplates: GroupTemplateLike[]
  layerTemplates: LayerTemplateLike[]
  getGroupState: StateLookup
  getLayerState: StateLookup
  isIntegrationAvailable: (integrationId?: string | null) => boolean
}): LayerStoreItem[] {
  const {
    groupTemplates,
    layerTemplates,
    getGroupState,
    getLayerState,
    isIntegrationAvailable,
  } = input

  const addedGroupIds = resolveAddedGroupIds(groupTemplates, getGroupState)
  const groupTemplateIds = new Set(groupTemplates.map(t => t.templateId))
  const layersById = new Map(layerTemplates.map(t => [t.templateId, t]))

  const items: (LayerStoreItem & { order: number })[] = []

  for (const template of groupTemplates) {
    const state = getGroupState(template.templateId)
    if (effectiveParentId(template, state)) continue // only bundle roots
    if (!isIntegrationAvailable(template.integrationId)) continue

    const subtree = collectGroupSubtree(
      template.templateId,
      groupTemplates,
      getGroupState,
    )
    const memberIds = collectGroupLayerTemplateIds(
      subtree,
      layerTemplates,
      getLayerState,
    )

    items.push({
      templateId: template.templateId,
      type: 'group',
      name: template.name,
      description: template.description,
      icon: template.icon,
      layerCount: memberIds.filter(id =>
        isIntegrationAvailable(layersById.get(id)?.integrationId),
      ).length,
      added: addedGroupIds.has(template.templateId),
      order: state?.order ?? template.order ?? 0,
    })
  }

  for (const template of layerTemplates) {
    const state = getLayerState(template.templateId)
    if (effectiveGroupId(template, state) || template.isSubLayer) continue
    if (!isIntegrationAvailable(template.integrationId)) continue

    items.push({
      templateId: template.templateId,
      type: 'layer',
      name: template.name,
      description: template.description,
      icon: template.icon,
      layerCount: 1,
      added: isLayerTemplateAdded(
        template,
        getLayerState,
        addedGroupIds,
        groupTemplateIds,
      ),
      order: state?.order ?? template.order ?? 0,
    })
  }

  return items
    .sort(
      (a, b) =>
        Number(a.added) - Number(b.added) ||
        a.order - b.order ||
        a.name.localeCompare(b.name),
    )
    .map(({ order, ...item }) => item)
}
