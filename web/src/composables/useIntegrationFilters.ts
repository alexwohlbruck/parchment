/**
 * Filter + sort state for the Integrations settings page. Extracted from
 * Integrations.vue so the component can focus on rendering — everything
 * filter-shaped lives here.
 *
 * Usage:
 *   const filters = useIntegrationFilters()
 *   // bind `filters.searchQuery`, `filters.costFilter`, etc. to the UI
 *   // consume `filters.filteredIntegrations` in the template
 */
import { computed, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import {
  IntegrationCapabilityId,
  IntegrationScope,
} from '@/types/integrations.types'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { fuzzyFilter } from '@/lib/utils'

export type SortField = 'popularity' | 'alphabetical' | 'dateModified'

export interface ActiveFilter {
  key: string
  category: string
  label: string
}

/**
 * Parse a `?capability=foo&capability=bar` (or comma-separated) query param
 * into a list of valid `IntegrationCapabilityId` values. Lets other pages
 * deep-link into the integrations page with a capability filter applied
 * (e.g. the Timeline empty state preselects "Location History").
 */
function readCapabilityQuery(value: unknown): string[] {
  const validIds = new Set<string>(Object.values(IntegrationCapabilityId))
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []
  return raw
    .map((s) => String(s).trim())
    .filter((s) => validIds.has(s))
}

export function useIntegrationFilters() {
  const { t } = useI18n()
  const route = useRoute()
  const integrationStore = useIntegrationsStore()
  const { allIntegrations } = storeToRefs(integrationStore)

  // Search
  const searchQuery = ref('')

  // Filter state — seed `selectedCapabilities` from `?capability=` so other
  // pages can deep-link into a pre-filtered view.
  const selectedCapabilities = ref<string[]>(
    readCapabilityQuery(route.query.capability),
  )
  const costFilter = ref<string[]>([])
  const hostingFilter = ref<string[]>([])
  const scopeFilter = ref<string[]>([])
  const statusFilter = ref<string[]>([])
  const encryptionFilter = ref<string[]>([])

  // Sort
  const sortField = ref<SortField>('alphabetical')
  const sortAscending = ref(true)

  // All capability options (used to populate the capabilities submenu)
  const allCapabilities = computed(() =>
    Object.values(IntegrationCapabilityId).map(id => ({
      id,
      label: t(`settings.integrations.capabilities.${id}`),
    })),
  )

  // Name → ref map, for generic toggle/remove handlers
  const filterRefs: Record<string, Ref<string[]>> = {
    capability: selectedCapabilities,
    cost: costFilter,
    hosting: hostingFilter,
    scope: scopeFilter,
    status: statusFilter,
    encryption: encryptionFilter,
  }

  // Single-select: picking a value replaces any previous value in the category
  const exclusiveFilters = new Set([
    'cost',
    'hosting',
    'scope',
    'status',
    'encryption',
  ])

  function toggleFilter(filter: string, value: string) {
    const arr = filterRefs[filter]
    if (!arr) return
    if (arr.value.includes(value)) {
      arr.value = arr.value.filter(v => v !== value)
    } else if (exclusiveFilters.has(filter)) {
      arr.value = [value]
    } else {
      arr.value = [...arr.value, value]
    }
  }

  function removeFilter(chip: ActiveFilter) {
    const arr = filterRefs[chip.category]
    if (!arr) return
    arr.value = arr.value.filter(v => v !== chip.key.split(':')[1])
  }

  const activeFilterChips = computed<ActiveFilter[]>(() => {
    const chips: ActiveFilter[] = []

    for (const v of costFilter.value) {
      chips.push({
        key: `cost:${v}`,
        category: 'cost',
        label:
          v === 'paid'
            ? t('settings.integrations.filter.paid')
            : t('settings.integrations.filter.free'),
      })
    }
    for (const v of hostingFilter.value) {
      chips.push({
        key: `hosting:${v}`,
        category: 'hosting',
        label:
          v === 'cloud'
            ? t('settings.integrations.filter.cloud')
            : t('settings.integrations.filter.selfHosted'),
      })
    }
    for (const v of scopeFilter.value) {
      chips.push({
        key: `scope:${v}`,
        category: 'scope',
        label:
          v === 'system'
            ? t('settings.integrations.filter.system')
            : t('settings.integrations.filter.user'),
      })
    }
    for (const v of statusFilter.value) {
      chips.push({
        key: `status:${v}`,
        category: 'status',
        label:
          v === 'connected'
            ? t('settings.integrations.filter.connected')
            : t('settings.integrations.filter.notConnected'),
      })
    }
    for (const v of encryptionFilter.value) {
      chips.push({
        key: `encryption:${v}`,
        category: 'encryption',
        label:
          v === 'e2ee'
            ? t('settings.integrations.filter.endToEnd')
            : t('settings.integrations.filter.serverManaged'),
      })
    }
    for (const v of selectedCapabilities.value) {
      chips.push({
        key: `cap:${v}`,
        category: 'capability',
        label: t(`settings.integrations.capabilities.${v}`),
      })
    }

    return chips
  })

  function clearAllFilters() {
    costFilter.value = []
    hostingFilter.value = []
    scopeFilter.value = []
    statusFilter.value = []
    encryptionFilter.value = []
    selectedCapabilities.value = []
  }

  // Chips below the toolbar — exclude capabilities (they have their own row)
  const dropdownFilterChips = computed(() =>
    activeFilterChips.value.filter(c => c.category !== 'capability'),
  )

  const totalFilterCount = computed(() => activeFilterChips.value.length)

  const hasActiveFilters = computed(
    () => searchQuery.value.trim() !== '' || activeFilterChips.value.length > 0,
  )

  const filteredIntegrations = computed(() => {
    let items = [...allIntegrations.value]

    if (selectedCapabilities.value.length > 0) {
      items = items.filter(({ integration }) =>
        selectedCapabilities.value.every(cap =>
          integration.capabilities.includes(cap as IntegrationCapabilityId),
        ),
      )
    }

    if (costFilter.value.length > 0) {
      items = items.filter(({ integration }) =>
        costFilter.value.every(v =>
          v === 'paid' ? integration.paid : !integration.paid,
        ),
      )
    }

    if (hostingFilter.value.length > 0) {
      items = items.filter(({ integration }) =>
        hostingFilter.value.every(v =>
          v === 'cloud' ? integration.cloud : !integration.cloud,
        ),
      )
    }

    if (scopeFilter.value.length > 0) {
      items = items.filter(({ integration }) =>
        scopeFilter.value.every(s =>
          integration.scope?.includes(s as IntegrationScope),
        ),
      )
    }

    if (statusFilter.value.length > 0) {
      items = items.filter(({ config }) =>
        statusFilter.value.every(v => (v === 'connected' ? !!config : !config)),
      )
    }

    // Encryption filter — matches by supportedSchemes on the integration.
    // Default is ['server-key'] for integrations that haven't declared otherwise.
    if (encryptionFilter.value.length > 0) {
      items = items.filter(({ integration }) => {
        const supported = integration.supportedSchemes ?? ['server-key']
        return encryptionFilter.value.every(v =>
          v === 'e2ee'
            ? supported.includes('user-e2ee')
            : supported.includes('server-key'),
        )
      })
    }

    if (searchQuery.value.trim()) {
      const searchItems = items.map(item => ({
        ...item,
        _name: item.integration.name,
        _description: item.integration.description || '',
      }))
      const filtered = fuzzyFilter(searchItems, searchQuery.value.trim(), {
        keys: ['_name', '_description'],
      })
      items = filtered.map(
        ({ _name, _description, ...rest }) => rest,
      ) as typeof items
    }

    if (sortField.value === 'alphabetical') {
      items.sort((a, b) => {
        const cmp = a.integration.name.localeCompare(b.integration.name)
        return sortAscending.value ? cmp : -cmp
      })
    } else if (sortField.value === 'dateModified') {
      items.sort((a, b) => {
        const aTime = a.config?.updatedAt
          ? new Date(a.config.updatedAt).getTime()
          : 0
        const bTime = b.config?.updatedAt
          ? new Date(b.config.updatedAt).getTime()
          : 0
        const cmp = bTime - aTime
        return sortAscending.value ? cmp : -cmp
      })
    } else if (!sortAscending.value) {
      // Popularity uses the store's natural order; reverse for descending.
      items.reverse()
    }

    return items
  })

  return {
    // Search
    searchQuery,
    // Filter state (bound directly from the template)
    selectedCapabilities,
    costFilter,
    hostingFilter,
    scopeFilter,
    statusFilter,
    encryptionFilter,
    // Sort state
    sortField,
    sortAscending,
    // Derived
    allCapabilities,
    activeFilterChips,
    dropdownFilterChips,
    totalFilterCount,
    hasActiveFilters,
    filteredIntegrations,
    // Actions
    toggleFilter,
    removeFilter,
    clearAllFilters,
  }
}
