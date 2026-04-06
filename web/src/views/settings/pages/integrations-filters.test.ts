/**
 * Unit tests for integrations page filter, sort, and search logic
 *
 * Tests the filtering/sorting behavior that lives in Integrations.vue
 * by reproducing the same logic against test data.
 */

import { describe, test, expect } from 'vitest'
import {
  IntegrationCapabilityId,
  IntegrationId,
  IntegrationScope,
} from '@server/types/integration.types'
import type {
  IntegrationDefinition,
  IntegrationRecord,
} from '@server/types/integration.types'

// -- Test data helpers --

function makeDef(
  overrides: Partial<IntegrationDefinition> = {},
): IntegrationDefinition {
  return {
    id: 'test' as IntegrationId,
    name: 'Test',
    description: '',
    color: '#000',
    capabilities: [],
    paid: false,
    cloud: false,
    configSchema: 'apiKeySchema',
    scope: [],
    ...overrides,
  } as IntegrationDefinition
}

function makeRecord(
  overrides: Partial<IntegrationRecord> = {},
): IntegrationRecord {
  return {
    id: 'rec-1',
    userId: null,
    integrationId: 'test' as IntegrationId,
    config: {},
    capabilities: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as IntegrationRecord
}

type IntegrationItem = { integration: IntegrationDefinition; config?: IntegrationRecord }

// -- Reproduce the component's filter/sort logic as pure functions --

function filterByCapabilities(items: IntegrationItem[], caps: string[]): IntegrationItem[] {
  if (caps.length === 0) return items
  return items.filter(({ integration }) =>
    caps.every(cap => integration.capabilities.includes(cap as IntegrationCapabilityId)),
  )
}

function filterByCost(items: IntegrationItem[], cost: string[]): IntegrationItem[] {
  if (cost.length === 0) return items
  return items.filter(({ integration }) =>
    cost.every(v => (v === 'paid' ? integration.paid : !integration.paid)),
  )
}

function filterByHosting(items: IntegrationItem[], hosting: string[]): IntegrationItem[] {
  if (hosting.length === 0) return items
  return items.filter(({ integration }) =>
    hosting.every(v => (v === 'cloud' ? integration.cloud : !integration.cloud)),
  )
}

function filterByScope(items: IntegrationItem[], scope: string[]): IntegrationItem[] {
  if (scope.length === 0) return items
  return items.filter(({ integration }) =>
    scope.every(s => integration.scope?.includes(s as IntegrationScope)),
  )
}

function filterByStatus(items: IntegrationItem[], status: string[]): IntegrationItem[] {
  if (status.length === 0) return items
  return items.filter(({ config }) =>
    status.every(v => (v === 'connected' ? !!config : !config)),
  )
}

function sortItems(
  items: IntegrationItem[],
  field: 'popularity' | 'alphabetical' | 'dateModified',
  ascending: boolean,
): IntegrationItem[] {
  const sorted = [...items]
  if (field === 'alphabetical') {
    sorted.sort((a, b) => {
      const cmp = a.integration.name.localeCompare(b.integration.name)
      return ascending ? cmp : -cmp
    })
  } else if (field === 'dateModified') {
    sorted.sort((a, b) => {
      const aTime = a.config?.updatedAt ? new Date(a.config.updatedAt).getTime() : 0
      const bTime = b.config?.updatedAt ? new Date(b.config.updatedAt).getTime() : 0
      const cmp = bTime - aTime
      return ascending ? cmp : -cmp
    })
  } else {
    if (!ascending) sorted.reverse()
  }
  return sorted
}

// -- Toggle filter helper (matches component's toggleFilter) --

const exclusiveFilters = new Set(['cost', 'hosting', 'scope', 'status'])

function toggleFilter(filter: string, arr: string[], value: string): string[] {
  if (arr.includes(value)) return arr.filter(v => v !== value)
  if (exclusiveFilters.has(filter)) return [value]
  return [...arr, value]
}

// -- Fixtures --

const mapbox: IntegrationItem = {
  integration: makeDef({
    id: IntegrationId.MAPBOX,
    name: 'Mapbox',
    capabilities: [IntegrationCapabilityId.MAP_ENGINE, IntegrationCapabilityId.GEOCODING],
    paid: true,
    cloud: true,
    scope: [IntegrationScope.SYSTEM],
  }),
  config: makeRecord({ id: 'rec-mapbox', integrationId: IntegrationId.MAPBOX, updatedAt: new Date('2025-06-01') }),
}

const nominatim: IntegrationItem = {
  integration: makeDef({
    id: IntegrationId.NOMINATIM,
    name: 'Nominatim',
    capabilities: [IntegrationCapabilityId.GEOCODING],
    paid: false,
    cloud: false,
    scope: [IntegrationScope.SYSTEM],
  }),
}

const foursquare: IntegrationItem = {
  integration: makeDef({
    id: IntegrationId.FOURSQUARE,
    name: 'Foursquare',
    capabilities: [IntegrationCapabilityId.SEARCH, IntegrationCapabilityId.PLACE_INFO],
    paid: true,
    cloud: true,
    scope: [IntegrationScope.SYSTEM, IntegrationScope.USER],
  }),
  config: makeRecord({ id: 'rec-fsq', integrationId: IntegrationId.FOURSQUARE, updatedAt: new Date('2025-08-15') }),
}

const allItems: IntegrationItem[] = [mapbox, nominatim, foursquare]

// -- Tests --

describe('toggleFilter', () => {
  test('adds value when not present (multi-select filter)', () => {
    expect(toggleFilter('capability', [], 'search')).toEqual(['search'])
  })

  test('removes value when present', () => {
    expect(toggleFilter('capability', ['search', 'geocoding'], 'search')).toEqual(['geocoding'])
  })

  test('is idempotent for add then remove', () => {
    const a = toggleFilter('capability', [], 'x')
    const b = toggleFilter('capability', a, 'x')
    expect(b).toEqual([])
  })

  test('exclusive filter swaps value instead of adding', () => {
    expect(toggleFilter('cost', ['free'], 'paid')).toEqual(['paid'])
  })

  test('exclusive filter still toggles off when clicking same value', () => {
    expect(toggleFilter('cost', ['paid'], 'paid')).toEqual([])
  })

  test('multi-select filter accumulates values', () => {
    expect(toggleFilter('capability', ['search'], 'geocoding')).toEqual(['search', 'geocoding'])
  })
})

describe('filterByCapabilities', () => {
  test('returns all items when no capabilities selected', () => {
    expect(filterByCapabilities(allItems, [])).toHaveLength(3)
  })

  test('filters to items that have the selected capability', () => {
    const result = filterByCapabilities(allItems, [IntegrationCapabilityId.GEOCODING])
    expect(result.map(i => i.integration.id)).toEqual([IntegrationId.MAPBOX, IntegrationId.NOMINATIM])
  })

  test('uses AND logic — items must have ALL selected capabilities', () => {
    const result = filterByCapabilities(allItems, [
      IntegrationCapabilityId.MAP_ENGINE,
      IntegrationCapabilityId.GEOCODING,
    ])
    expect(result).toHaveLength(1)
    expect(result[0].integration.id).toBe(IntegrationId.MAPBOX)
  })

  test('returns empty when no items match all capabilities', () => {
    const result = filterByCapabilities(allItems, [
      IntegrationCapabilityId.MAP_ENGINE,
      IntegrationCapabilityId.SEARCH,
    ])
    expect(result).toHaveLength(0)
  })
})

describe('filterByCost', () => {
  test('returns all items when filter is empty', () => {
    expect(filterByCost(allItems, [])).toHaveLength(3)
  })

  test('filters to paid integrations', () => {
    const result = filterByCost(allItems, ['paid'])
    expect(result.every(i => i.integration.paid)).toBe(true)
    expect(result).toHaveLength(2)
  })

  test('filters to free integrations', () => {
    const result = filterByCost(allItems, ['free'])
    expect(result.every(i => !i.integration.paid)).toBe(true)
    expect(result).toHaveLength(1)
  })
})

describe('filterByHosting', () => {
  test('returns all when empty', () => {
    expect(filterByHosting(allItems, [])).toHaveLength(3)
  })

  test('filters to cloud integrations', () => {
    const result = filterByHosting(allItems, ['cloud'])
    expect(result.every(i => i.integration.cloud)).toBe(true)
  })

  test('filters to self-hosted integrations', () => {
    const result = filterByHosting(allItems, ['selfHosted'])
    expect(result.every(i => !i.integration.cloud)).toBe(true)
  })
})

describe('filterByScope', () => {
  test('returns all when empty', () => {
    expect(filterByScope(allItems, [])).toHaveLength(3)
  })

  test('filters to user-scoped integrations', () => {
    const result = filterByScope(allItems, ['user'])
    expect(result).toHaveLength(1)
    expect(result[0].integration.id).toBe(IntegrationId.FOURSQUARE)
  })

  test('filters to system-scoped integrations', () => {
    const result = filterByScope(allItems, ['system'])
    expect(result).toHaveLength(3)
  })
})

describe('filterByStatus', () => {
  test('returns all when empty', () => {
    expect(filterByStatus(allItems, [])).toHaveLength(3)
  })

  test('filters to connected integrations', () => {
    const result = filterByStatus(allItems, ['connected'])
    expect(result.every(i => !!i.config)).toBe(true)
    expect(result).toHaveLength(2)
  })

  test('filters to not-connected integrations', () => {
    const result = filterByStatus(allItems, ['notConnected'])
    expect(result.every(i => !i.config)).toBe(true)
    expect(result).toHaveLength(1)
  })
})

describe('sortItems', () => {
  test('alphabetical ascending', () => {
    const result = sortItems(allItems, 'alphabetical', true)
    expect(result.map(i => i.integration.name)).toEqual(['Foursquare', 'Mapbox', 'Nominatim'])
  })

  test('alphabetical descending', () => {
    const result = sortItems(allItems, 'alphabetical', false)
    expect(result.map(i => i.integration.name)).toEqual(['Nominatim', 'Mapbox', 'Foursquare'])
  })

  test('date modified puts most recently updated first', () => {
    const result = sortItems(allItems, 'dateModified', true)
    // Foursquare (Aug 2025) > Mapbox (Jun 2025) > Nominatim (no config, 0)
    expect(result.map(i => i.integration.name)).toEqual(['Foursquare', 'Mapbox', 'Nominatim'])
  })

  test('date modified descending reverses order', () => {
    const result = sortItems(allItems, 'dateModified', false)
    expect(result.map(i => i.integration.name)).toEqual(['Nominatim', 'Mapbox', 'Foursquare'])
  })

  test('popularity ascending preserves original order', () => {
    const result = sortItems(allItems, 'popularity', true)
    expect(result.map(i => i.integration.name)).toEqual(['Mapbox', 'Nominatim', 'Foursquare'])
  })

  test('popularity descending reverses original order', () => {
    const result = sortItems(allItems, 'popularity', false)
    expect(result.map(i => i.integration.name)).toEqual(['Foursquare', 'Nominatim', 'Mapbox'])
  })
})

describe('combined filters', () => {
  test('capability + cost filters stack', () => {
    let result = filterByCapabilities(allItems, [IntegrationCapabilityId.GEOCODING])
    result = filterByCost(result, ['free'])
    expect(result).toHaveLength(1)
    expect(result[0].integration.id).toBe(IntegrationId.NOMINATIM)
  })

  test('status + hosting filters stack', () => {
    let result = filterByStatus(allItems, ['connected'])
    result = filterByHosting(result, ['cloud'])
    expect(result).toHaveLength(2)
  })

  test('all filters active narrows to specific item', () => {
    let result = filterByCapabilities(allItems, [IntegrationCapabilityId.SEARCH])
    result = filterByCost(result, ['paid'])
    result = filterByHosting(result, ['cloud'])
    result = filterByStatus(result, ['connected'])
    expect(result).toHaveLength(1)
    expect(result[0].integration.id).toBe(IntegrationId.FOURSQUARE)
  })

  test('conflicting filters produce empty results', () => {
    let result = filterByCost(allItems, ['free'])
    result = filterByHosting(result, ['cloud'])
    expect(result).toHaveLength(0)
  })
})
