/**
 * Unit tests for the default-template membership rules.
 *
 * The behaviour worth pinning down is the three-way `hidden`: `null` defers to
 * the template's `installedByDefault` (how a store-only bundle stays out of a
 * fresh library), `true` is a removal, `false` is the user adding it back. On
 * top of that, membership cascades down the template tree — a removed group
 * takes its subgroups and layers with it — which is what lets the store add or
 * remove a whole bundle off a single state row.
 */

import { describe, test, expect } from 'vitest'
import type { DefaultUserStateRow } from '@/services/layers/core/layer-crud.service'
import {
  buildLayerStoreItems,
  collectGroupLayerTemplateIds,
  collectGroupSubtree,
  isLayerTemplateAdded,
  isTemplateAdded,
  resolveAddedGroupIds,
  type GroupTemplateLike,
  type LayerTemplateLike,
} from './layer-templates'

function state(patch: Partial<DefaultUserStateRow> = {}): DefaultUserStateRow {
  return {
    userId: 'me',
    templateId: 'x',
    type: 'group',
    hidden: null,
    visible: null,
    order: null,
    enabled: null,
    showInLayerSelector: null,
    groupId: null,
    parentGroupId: null,
    createdAt: '',
    updatedAt: '',
    ...patch,
  }
}

/** Builds a lookup over `{ templateId: patch }`. */
function lookup(rows: Record<string, Partial<DefaultUserStateRow>>) {
  return (templateId: string) =>
    rows[templateId] ? state({ templateId, ...rows[templateId] }) : null
}

const none = () => null

const GROUPS: GroupTemplateLike[] = [
  { templateId: 'g:transit', name: 'Transit', order: 2, parentGroupId: null },
  {
    templateId: 'g:terrain',
    name: 'Terrain',
    order: 4,
    parentGroupId: null,
    installedByDefault: false,
  },
  {
    templateId: 'g:terrain:contours',
    name: 'Contours',
    order: 0,
    parentGroupId: 'g:terrain',
  },
  {
    templateId: 'g:loom',
    name: 'Loom',
    order: 3,
    parentGroupId: null,
    integrationId: 'loom',
  },
]

const LAYERS: LayerTemplateLike[] = [
  { templateId: 'l:rail', name: 'Rail', order: 0, groupId: 'g:transit' },
  { templateId: 'l:hillshade', name: 'Hillshade', order: 1, groupId: 'g:terrain' },
  {
    templateId: 'l:contour-lines',
    name: 'Contour lines',
    order: 2,
    groupId: 'g:terrain:contours',
  },
  { templateId: 'l:traffic', name: 'Traffic', order: 10, groupId: null },
  {
    templateId: 'l:notes',
    name: 'OSM Notes',
    order: 14,
    groupId: null,
    installedByDefault: false,
  },
  {
    templateId: 'l:aqi',
    name: 'AQI',
    order: 5,
    groupId: 'g:terrain',
    isSubLayer: true,
  },
]

describe('isTemplateAdded', () => {
  const optIn = { templateId: 'g:terrain', name: 'Terrain', installedByDefault: false }
  const shipped = { templateId: 'g:transit', name: 'Transit' }

  test('a template with no state row follows installedByDefault', () => {
    expect(isTemplateAdded(shipped, null)).toBe(true)
    expect(isTemplateAdded(optIn, null)).toBe(false)
  })

  test('a null hidden is not a decision — it still follows the template', () => {
    expect(isTemplateAdded(optIn, state({ hidden: null, order: 3 }))).toBe(false)
  })

  test('hidden: true removes a shipped template', () => {
    expect(isTemplateAdded(shipped, state({ hidden: true }))).toBe(false)
  })

  test('hidden: false adds a store-only template', () => {
    expect(isTemplateAdded(optIn, state({ hidden: false }))).toBe(true)
  })
})

describe('resolveAddedGroupIds', () => {
  test('ships the default groups and withholds the store-only ones', () => {
    const added = resolveAddedGroupIds(GROUPS, none)

    expect(added.has('g:transit')).toBe(true)
    expect(added.has('g:terrain')).toBe(false)
  })

  test('a subgroup of a withheld group is withheld with it', () => {
    expect(resolveAddedGroupIds(GROUPS, none).has('g:terrain:contours')).toBe(false)
  })

  test('adding the root brings its subgroups along, with no row of their own', () => {
    const added = resolveAddedGroupIds(
      GROUPS,
      lookup({ 'g:terrain': { hidden: false } }),
    )

    expect(added.has('g:terrain')).toBe(true)
    expect(added.has('g:terrain:contours')).toBe(true)
  })

  test('removing a root removes a subgroup the user had explicitly added', () => {
    const added = resolveAddedGroupIds(
      GROUPS,
      lookup({
        'g:terrain': { hidden: true },
        'g:terrain:contours': { hidden: false },
      }),
    )

    expect(added.has('g:terrain:contours')).toBe(false)
  })

  test('a group re-parented under a removed group goes with its new parent', () => {
    const added = resolveAddedGroupIds(
      GROUPS,
      lookup({
        'g:transit': { hidden: true },
        'g:terrain': { hidden: false },
        'g:terrain:contours': { parentGroupId: 'g:transit' },
      }),
    )

    expect(added.has('g:terrain:contours')).toBe(false)
  })

  test('a cyclic parent chain resolves to removed rather than hanging', () => {
    const cyclic: GroupTemplateLike[] = [
      { templateId: 'a', name: 'A', parentGroupId: 'b' },
      { templateId: 'b', name: 'B', parentGroupId: 'a' },
    ]

    expect(resolveAddedGroupIds(cyclic, none).size).toBe(0)
  })
})

describe('isLayerTemplateAdded', () => {
  const groupIds = new Set(GROUPS.map(g => g.templateId))

  function added(rows: Record<string, Partial<DefaultUserStateRow>> = {}) {
    const get = lookup(rows)
    const addedGroups = resolveAddedGroupIds(GROUPS, get)
    return (template: LayerTemplateLike) =>
      isLayerTemplateAdded(template, get, addedGroups, groupIds)
  }

  const byId = (id: string) => LAYERS.find(l => l.templateId === id)!

  test('a layer in a shipped group is in the library', () => {
    expect(added()(byId('l:rail'))).toBe(true)
  })

  test('a layer in a withheld group is not, despite its own default', () => {
    expect(added()(byId('l:hillshade'))).toBe(false)
  })

  test('adding the group adds its layers without a row per layer', () => {
    expect(added({ 'g:terrain': { hidden: false } })(byId('l:hillshade'))).toBe(true)
  })

  test('a layer the user deleted stays out when the group comes back', () => {
    const get = added({
      'g:terrain': { hidden: false },
      'l:hillshade': { hidden: true },
    })

    expect(get(byId('l:hillshade'))).toBe(false)
  })

  test('an ungrouped store-only layer follows only its own state', () => {
    expect(added()(byId('l:notes'))).toBe(false)
    expect(added({ 'l:notes': { hidden: false } })(byId('l:notes'))).toBe(true)
  })

  test('a layer moved into a user-owned group is not cascaded on', () => {
    // 'user-group-1' is a real DB row, not a template — it is always present,
    // so the layer's own state is the only thing that decides.
    expect(
      added({ 'l:hillshade': { groupId: 'user-group-1' } })(byId('l:hillshade')),
    ).toBe(true)
  })
})

describe('collectGroupSubtree', () => {
  test('returns the root and everything beneath it', () => {
    expect(collectGroupSubtree('g:terrain', GROUPS, none)).toEqual([
      'g:terrain',
      'g:terrain:contours',
    ])
  })

  test('a leaf group is just itself', () => {
    expect(collectGroupSubtree('g:transit', GROUPS, none)).toEqual(['g:transit'])
  })

  test('a group re-parented into its own subtree terminates', () => {
    // Reachable by dragging a group onto one of its own descendants.
    const get = lookup({ 'g:terrain': { parentGroupId: 'g:terrain:contours' } })

    expect(collectGroupSubtree('g:terrain', GROUPS, get)).toEqual([
      'g:terrain',
      'g:terrain:contours',
    ])
  })
})

describe('collectGroupLayerTemplateIds', () => {
  test('collects layers across the whole subtree', () => {
    const subtree = collectGroupSubtree('g:terrain', GROUPS, none)

    expect(collectGroupLayerTemplateIds(subtree, LAYERS, none)).toEqual([
      'l:hillshade',
      'l:contour-lines',
      'l:aqi',
    ])
  })

  test('follows a layer the user moved out of the group', () => {
    const get = lookup({ 'l:hillshade': { groupId: 'g:transit' } })

    expect(
      collectGroupLayerTemplateIds(['g:terrain'], LAYERS, get),
    ).not.toContain('l:hillshade')
  })
})

describe('buildLayerStoreItems', () => {
  type IntegrationCheck = (integrationId?: string | null) => boolean
  const always: IntegrationCheck = () => true

  function build(
    rows: Record<string, Partial<DefaultUserStateRow>> = {},
    isIntegrationAvailable: IntegrationCheck = always,
  ) {
    const get = lookup(rows)
    return buildLayerStoreItems({
      groupTemplates: GROUPS,
      layerTemplates: LAYERS,
      getGroupState: get,
      getLayerState: get,
      isIntegrationAvailable,
    })
  }

  test('lists every bundle root, added or not', () => {
    expect(build().map(i => i.templateId)).toEqual([
      // not added first, then by order
      'g:terrain',
      'l:notes',
      'g:transit',
      'g:loom',
      'l:traffic',
    ])
  })

  test('leaves out subgroups, grouped layers and sub-layers', () => {
    const ids = build().map(i => i.templateId)

    expect(ids).not.toContain('g:terrain:contours')
    expect(ids).not.toContain('l:hillshade')
    expect(ids).not.toContain('l:aqi')
  })

  test('counts every layer in the bundle, nested ones included', () => {
    const terrain = build().find(i => i.templateId === 'g:terrain')

    expect(terrain?.layerCount).toBe(3)
  })

  test('omits bundles whose integration is not configured', () => {
    const ids = build({}, id => id !== 'loom').map(i => i.templateId)

    expect(ids).not.toContain('g:loom')
  })

  test('does not count layers the missing integration would have supplied', () => {
    const withIntegrationLayer = buildLayerStoreItems({
      groupTemplates: GROUPS,
      layerTemplates: [
        ...LAYERS,
        {
          templateId: 'l:firms',
          name: 'Fire hotspots',
          groupId: 'g:terrain',
          integrationId: 'firms',
        },
      ],
      getGroupState: none,
      getLayerState: none,
      isIntegrationAvailable: id => id !== 'firms',
    })

    expect(
      withIntegrationLayer.find(i => i.templateId === 'g:terrain')?.layerCount,
    ).toBe(3)
  })

  test('a removed bundle comes back as available to add', () => {
    const transit = build({ 'g:transit': { hidden: true } }).find(
      i => i.templateId === 'g:transit',
    )

    expect(transit?.added).toBe(false)
  })

  test('carries the template copy through for the dialog', () => {
    const items = buildLayerStoreItems({
      groupTemplates: [
        {
          templateId: 'g:terrain',
          name: 'Terrain',
          description: 'Hillshading and contours.',
          icon: 'MountainSnowIcon',
          installedByDefault: false,
        },
      ],
      layerTemplates: [],
      getGroupState: none,
      getLayerState: none,
      isIntegrationAvailable: always,
    })

    expect(items[0]).toMatchObject({
      type: 'group',
      name: 'Terrain',
      description: 'Hillshading and contours.',
      icon: 'MountainSnowIcon',
      layerCount: 0,
      added: false,
    })
  })
})
