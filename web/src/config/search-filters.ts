import type { Component } from 'vue'
import type { Place } from '@/types/place.types'
import type { ChipOption } from '@/components/ui/chip'
import { isPlaceOpenNow } from '@/lib/place-open.utils'
import { getOsmTagLabel } from '@/lib/osm-tag-labels'
import * as turf from '@turf/turf'
import {
  ClockIcon,
  LockIcon,
  DollarSignIcon,
  TagIcon,
} from 'lucide-vue-next'

// ── Types ────────────────────────────────────────────────────────────────

export type FilterType = 'toggle' | 'select' | 'multi-select'

export interface FilterDef {
  id: string
  type: FilterType
  label: string
  icon: Component
  defaultValue: any
  isAvailable: (places: Place[]) => boolean
  getOptions?: (places: Place[]) => ChipOption[]
  match: (place: Place, value: any) => boolean
  toServerFilter?: (value: any) => Record<string, any> | null
}

export interface SortContext {
  mapCenter: [number, number]
  userLocation: [number, number] | null
}

export interface SortDef {
  id: string
  label: string
  isAvailable: (places: Place[], ctx?: SortContext) => boolean
  compare: (a: Place, b: Place, ctx: SortContext) => number
  serverValue?: string
}

export interface FieldDefinition {
  id: string
  key: string
  type: string
  label: string
  placeholder?: string
  options?: Record<string, string | { title: string }>
}

// ── Helpers ──────────────────────────────────────────────────────────────

function placeCenter(place: Place): [number, number] {
  const c = place.geometry?.value?.center
  return c ? [c.lng, c.lat] : [0, 0]
}

function formatTagLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

function getOptionLabel(opt: string | { title: string }): string {
  if (typeof opt === 'string') return opt
  return opt.title
}

// ── Filter Definitions (hardcoded special filters) ───────────────────────

export const FILTER_DEFINITIONS: FilterDef[] = [
  {
    id: 'openNow',
    type: 'toggle',
    label: 'Open Now',
    icon: ClockIcon,
    defaultValue: false,
    isAvailable: () => true,
    match: (place, active: boolean) => {
      if (!active) return true
      const status = isPlaceOpenNow(place.openingHours?.value)
      return status === true || status === null
    },
    toServerFilter: (active: boolean) =>
      active ? { hasHours: true } : null,
  },
  {
    id: 'access',
    type: 'multi-select',
    label: 'Access',
    icon: LockIcon,
    defaultValue: [],
    isAvailable: () => true,
    getOptions: () => [
      { label: 'Public', value: 'yes' },
      { label: 'Private', value: 'private' },
      { label: 'Permissive', value: 'permissive' },
      { label: 'Customers', value: 'customers' },
      { label: 'Permit Only', value: 'permit' },
      { label: 'Destination Only', value: 'destination' },
    ],
    match: (place, selected: string[]) => {
      if (!selected.length) return true
      return selected.includes(place.tags?.access ?? '')
    },
    toServerFilter: (selected: string[]) =>
      selected.length ? { access: selected } : null,
  },
  {
    id: 'fee',
    type: 'select',
    label: 'Fee',
    icon: DollarSignIcon,
    defaultValue: null,
    isAvailable: () => true,
    getOptions: () => [
      { label: 'Free', value: 'free' },
      { label: 'Paid', value: 'paid' },
    ],
    match: (place, value: string | null) => {
      if (!value) return true
      if (value === 'free') return place.tags?.fee === 'no'
      if (value === 'paid') return place.tags?.fee === 'yes'
      return true
    },
    toServerFilter: (value: string | null) =>
      value ? { fee: value === 'free' ? 'no' : 'yes' } : null,
  },
]

// Tag keys already handled by hardcoded definitions above
const HARDCODED_TAG_KEYS = new Set(['access', 'fee'])

// ── Auto-generated filters from OSM field definitions ────────────────────

const FILTERABLE_FIELD_TYPES = new Set(['combo', 'check', 'semiCombo', 'radio'])

export function generateFiltersFromFields(fields: FieldDefinition[]): FilterDef[] {
  const seen = new Set<string>()
  return fields
    .filter(field => {
      if (!FILTERABLE_FIELD_TYPES.has(field.type)) return false
      if (HARDCODED_TAG_KEYS.has(field.key)) return false
      if (field.type !== 'check' && !field.options) return false
      if (seen.has(field.key)) return false
      seen.add(field.key)
      return true
    })
    .map(field => {
      if (field.type === 'check') return createCheckFilter(field)
      if (field.type === 'semiCombo') return createSemiComboFilter(field)
      return createComboFilter(field)
    })
}

function createCheckFilter(field: FieldDefinition): FilterDef {
  return {
    id: `tag:${field.key}`,
    type: 'toggle',
    label: field.label || getOsmTagLabel(field.key),
    icon: TagIcon,
    defaultValue: false,
    isAvailable: () => true,
    match: (place, active: boolean) => {
      if (!active) return true
      return place.tags?.[field.key] === 'yes'
    },
    toServerFilter: (active: boolean) =>
      active ? { [`tag:${field.key}`]: 'yes' } : null,
  }
}

function allComboOptions(options: Record<string, string | { title: string }>): ChipOption[] {
  return Object.entries(options)
    .map(([k, label]) => ({
      label: getOptionLabel(label) || formatTagLabel(k),
      value: k,
    }))
}

function createComboFilter(field: FieldDefinition): FilterDef {
  const options = field.options || {}
  return {
    id: `tag:${field.key}`,
    type: 'select',
    label: getOsmTagLabel(field.key),
    icon: TagIcon,
    defaultValue: null,
    isAvailable: () => true,
    getOptions: () => allComboOptions(options),
    match: (place, value: string | null) => {
      if (!value) return true
      return place.tags?.[field.key] === value
    },
    toServerFilter: (value: string | null) =>
      value ? { [`tag:${field.key}`]: value } : null,
  }
}

function createSemiComboFilter(field: FieldDefinition): FilterDef {
  const options = field.options || {}
  return {
    id: `tag:${field.key}`,
    type: 'multi-select',
    label: getOsmTagLabel(field.key),
    icon: TagIcon,
    defaultValue: [],
    isAvailable: () => true,
    getOptions: () => allComboOptions(options),
    match: (place, selected: string[]) => {
      if (!selected.length) return true
      const val = place.tags?.[field.key]
      if (!val) return false
      const placeValues = val.split(';').map(v => v.trim())
      return selected.some(s => placeValues.includes(s))
    },
  }
}

// ── Sort Definitions ─────────────────────────────────────────────────────

export const SORT_DEFINITIONS: SortDef[] = [
  {
    id: 'relevance',
    label: 'Best match',
    isAvailable: () => true,
    compare: () => 0,
    serverValue: 'relevance',
  },
  {
    id: 'nearby',
    label: 'Nearby',
    isAvailable: (_places, ctx) => ctx?.userLocation != null,
    compare: (a, b, { userLocation }) => {
      if (!userLocation) return 0
      const distA = turf.distance(userLocation, placeCenter(a))
      const distB = turf.distance(userLocation, placeCenter(b))
      return distA - distB
    },
  },
  {
    id: 'distance',
    label: 'Near map center',
    isAvailable: () => true,
    compare: (a, b, { mapCenter }) => {
      const distA = turf.distance(mapCenter, placeCenter(a))
      const distB = turf.distance(mapCenter, placeCenter(b))
      return distA - distB
    },
    serverValue: 'distance',
  },
  {
    id: 'rating',
    label: 'Top rated',
    isAvailable: (places) =>
      places.some(p => p.ratings?.rating?.value != null),
    compare: (a, b) => {
      const rA = a.ratings?.rating?.value ?? -1
      const rB = b.ratings?.rating?.value ?? -1
      return rB - rA
    },
  },
]
