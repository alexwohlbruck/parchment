<script setup lang="ts">
import {
  ArrowUpDownIcon,
  SlidersHorizontalIcon,
  XIcon,
  MapIcon,
  LocateFixedIcon,
} from 'lucide-vue-next'
import ResponsiveDropdown, { type MenuItemDefinition } from '@/components/responsive/ResponsiveDropdown.vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { FilterDef, SortDef } from '@/config/search-filters'
import type { ChipOption } from '@/components/ui/chip'
import { computed, ref } from 'vue'

const props = defineProps<{
  filterDefs: FilterDef[]
  filterValues: Record<string, any>
  filterOptions: Record<string, ChipOption[]>
  sortOptions: SortDef[]
  sortBy: string
  searchContext: 'map' | 'nearby'
  hasGeolocation: boolean
}>()

const emit = defineEmits<{
  'update:filter': [id: string, value: any]
  'update:sortBy': [value: string]
  'update:searchContext': [value: 'map' | 'nearby']
}>()

const sortOpen = ref(false)
const filterOpen = ref(false)

// ── Sort menu items ─────────────────────────────────────────────────────

const sortMenuItems = computed<MenuItemDefinition[]>(() =>
  props.sortOptions.map(s => ({
    type: 'item' as const,
    id: s.id,
    label: s.label,
    active: props.sortBy === s.id,
    onSelect: () => emit('update:sortBy', s.id),
  })),
)

const sortLabel = computed(() => {
  const selected = props.sortOptions.find(s => s.id === props.sortBy)
  return selected?.label ?? 'Sort'
})

// ── Filter menu items ───────────────────────────────────────────────────

const activeFilterCount = computed(() =>
  props.filterDefs.filter(def => {
    const value = props.filterValues[def.id] ?? def.defaultValue
    if (value === null || value === undefined) return false
    if (value === def.defaultValue) return false
    if (Array.isArray(value) && value.length === 0) return false
    return true
  }).length,
)

const filterMenuItems = computed<MenuItemDefinition[]>(() =>
  props.filterDefs.map(def => {
    if (def.type === 'toggle') {
      return {
        type: 'item' as const,
        id: def.id,
        label: def.label,
        active: !!getFilterValue(def),
        keepOpen: true,
        onSelect: () => emit('update:filter', def.id, !getFilterValue(def)),
      }
    }

    const options = getFilterOptions(def)
    return {
      type: 'submenu' as const,
      id: def.id,
      label: def.label,
      active: isFilterActive(def),
      searchable: options.length > 15,
      items: options.map(opt => ({
        type: 'item' as const,
        id: `${def.id}:${opt.value}`,
        label: opt.label,
        active: isOptionSelected(def, opt.value),
        keepOpen: true,
        onSelect: () => handleDropdownSelect(def, opt.value),
      })),
    }
  }),
)

// ── Active filter chips ─────────────────────────────────────────────────

const activeFilterChips = computed(() => {
  const chips: { id: string; label: string; value: any; def: FilterDef }[] = []
  for (const def of props.filterDefs) {
    const value = props.filterValues[def.id] ?? def.defaultValue
    if (value === null || value === undefined) continue
    if (value === def.defaultValue) continue
    if (Array.isArray(value) && value.length === 0) continue

    if (def.type === 'toggle') {
      chips.push({ id: def.id, label: def.label, value: true, def })
    } else if (def.type === 'multi-select' && Array.isArray(value)) {
      const options = getFilterOptions(def)
      for (const v of value) {
        const opt = options.find(o => o.value === v)
        chips.push({
          id: def.id,
          label: `${def.label}: ${opt?.label ?? v}`,
          value: v,
          def,
        })
      }
    } else {
      const options = getFilterOptions(def)
      const opt = options.find(o => String(o.value) === String(value))
      chips.push({
        id: def.id,
        label: `${def.label}: ${opt?.label ?? value}`,
        value,
        def,
      })
    }
  }
  return chips
})

// ── Helpers ─────────────────────────────────────────────────────────────

function getFilterValue(def: FilterDef): any {
  return props.filterValues[def.id] ?? def.defaultValue
}

function getFilterOptions(def: FilterDef): ChipOption[] {
  return props.filterOptions[def.id] ?? def.getOptions?.([]) ?? []
}

function handleDropdownSelect(def: FilterDef, value: any) {
  if (def.type === 'multi-select') {
    const current = Array.isArray(getFilterValue(def)) ? [...getFilterValue(def)] : []
    const idx = current.indexOf(value)
    if (idx >= 0) {
      current.splice(idx, 1)
    } else {
      current.push(value)
    }
    emit('update:filter', def.id, current)
  } else {
    const currentValue = getFilterValue(def)
    emit('update:filter', def.id, currentValue === value ? null : value)
  }
}

function removeFilterChip(chip: { id: string; value: any; def: FilterDef }) {
  if (chip.def.type === 'toggle') {
    emit('update:filter', chip.id, false)
  } else if (chip.def.type === 'multi-select') {
    const current = Array.isArray(getFilterValue(chip.def)) ? [...getFilterValue(chip.def)] : []
    emit('update:filter', chip.id, current.filter((v: any) => v !== chip.value))
  } else {
    emit('update:filter', chip.id, null)
  }
}

function clearAllFilters() {
  for (const def of props.filterDefs) {
    emit('update:filter', def.id, def.defaultValue)
  }
}

function isFilterActive(def: FilterDef): boolean {
  const value = getFilterValue(def)
  if (value === null || value === undefined) return false
  if (value === def.defaultValue) return false
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

function isOptionSelected(def: FilterDef, optionValue: any): boolean {
  const value = getFilterValue(def)
  if (def.type === 'multi-select') {
    return Array.isArray(value) && value.includes(optionValue)
  }
  return String(value) === String(optionValue)
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <!-- Row 1: Sort + Filters -->
    <div class="flex flex-row gap-1.5 items-center overflow-visible">
      <!-- Sort -->
      <ResponsiveDropdown
        :items="sortMenuItems"
        :open="sortOpen"
        title="Sort"
        content-class="w-40"
        @update:open="sortOpen = $event"
      >
        <template #trigger="{ open }">
          <Button
            variant="outline"
            size="xs"
            class="rounded-full gap-1 bg-background"
            @click="open"
          >
            <ArrowUpDownIcon class="size-3.5" />
            <span>{{ sortLabel }}</span>
          </Button>
        </template>
      </ResponsiveDropdown>

      <!-- Search context toggle -->
      <Button
        v-if="hasGeolocation"
        variant="outline"
        size="xs"
        class="rounded-full gap-1 bg-background"
        @click="emit('update:searchContext', searchContext === 'nearby' ? 'map' : 'nearby')"
      >
        <LocateFixedIcon v-if="searchContext === 'nearby'" class="size-3.5" />
        <MapIcon v-else class="size-3.5" />
        <span>{{ searchContext === 'nearby' ? 'Near me' : 'This area' }}</span>
      </Button>

      <!-- Filters -->
      <ResponsiveDropdown
        v-if="filterDefs.length > 0"
        :items="filterMenuItems"
        :open="filterOpen"
        title="Filters"
        content-class="w-48"
        @update:open="filterOpen = $event"
      >
        <template #trigger="{ open }">
          <Button
            variant="outline"
            size="xs"
            class="rounded-full gap-1 bg-background relative overflow-visible"
            @click="open"
          >
            <SlidersHorizontalIcon class="size-3.5" />
            <span>Filters</span>
            <Badge
              v-if="activeFilterCount > 0"
              variant="primary"
              class="absolute -top-1.5 -right-1.5 px-1 py-0 text-[10px] min-w-4 h-4 justify-center"
            >
              {{ activeFilterCount }}
            </Badge>
          </Button>
        </template>
      </ResponsiveDropdown>
    </div>

    <!-- Row 2: Active filter chips (removable) -->
    <div
      v-if="activeFilterChips.length > 0"
      class="flex items-center gap-1.5 flex-wrap"
    >
      <button
        v-for="chip in activeFilterChips"
        :key="`${chip.id}:${chip.value}`"
        class="inline-flex items-center gap-1 rounded-full border border-border bg-background text-foreground px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors cursor-pointer"
        @click="removeFilterChip(chip)"
      >
        {{ chip.label }}
        <XIcon class="size-3" />
      </button>
      <button
        class="text-xs text-muted-foreground hover:text-foreground transition-colors px-1 cursor-pointer"
        @click="clearAllFilters"
      >
        Clear all
      </button>
    </div>
  </div>
</template>
