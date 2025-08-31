<script setup lang="ts">
import { ref } from 'vue'
import {
  LockIcon,
  DollarSignIcon,
  StarIcon,
  ClockIcon,
  ArrowUpDownIcon,
  MapPinIcon,
} from 'lucide-vue-next'
import { Chip, type ChipOption } from '@/components/ui/chip'

// Filter state
const selectedAccess = ref<string[]>([])
const selectedPrice = ref<string>('')
const selectedRating = ref<number | ''>('')
const selectedSort = ref<string>('relevance')
const openNow = ref<boolean>(false)

// Access options
const accessOptions: ChipOption[] = [
  { label: 'Public', value: 'public' },
  { label: 'Private', value: 'private' },
  { label: 'Customers Only', value: 'customers' },
  { label: 'Members Only', value: 'members' },
  { label: 'Permit Required', value: 'permit' },
  { label: 'No Access', value: 'no' },
]

// Price options
const priceOptions: ChipOption[] = [
  { label: 'Free', value: 'free' },
  { label: '$', value: 'low' },
  { label: '$$', value: 'medium' },
  { label: '$$$', value: 'high' },
  { label: '$$$$', value: 'very_high' },
]

// Rating options
const ratingOptions: ChipOption[] = [
  { label: '1+ Stars', value: 1 },
  { label: '2+ Stars', value: 2 },
  { label: '3+ Stars', value: 3 },
  { label: '4+ Stars', value: 4 },
  { label: '5 Stars', value: 5 },
]

// Sort options
const sortOptions: ChipOption[] = [
  { label: 'Relevance', value: 'relevance' },
  { label: 'Distance', value: 'distance' },
  { label: 'Rating', value: 'rating' },
  { label: 'Price', value: 'price' },
]

// Emit filter changes to parent
const emit = defineEmits<{
  filtersChanged: [
    filters: {
      access: string[]
      price: string
      rating: number | ''
      openNow: boolean
      sort: string
    },
  ]
}>()

// Watch for filter changes and emit to parent
function emitFiltersChanged() {
  emit('filtersChanged', {
    access: selectedAccess.value,
    price: selectedPrice.value,
    rating: selectedRating.value,
    openNow: openNow.value,
    sort: selectedSort.value,
  })
}

// Handle filter updates
function handleAccessUpdate(value: string[]) {
  selectedAccess.value = value
  emitFiltersChanged()
}

function handlePriceUpdate(value: string) {
  selectedPrice.value = value
  emitFiltersChanged()
}

function handleRatingUpdate(value: number) {
  selectedRating.value = value
  emitFiltersChanged()
}

function handleOpenNowUpdate(value: boolean) {
  openNow.value = value
  emitFiltersChanged()
}

function handleSortUpdate(value: string) {
  selectedSort.value = value
  emitFiltersChanged()
}

// Reset all filters
function resetFilters() {
  selectedAccess.value = []
  selectedPrice.value = ''
  selectedRating.value = ''
  selectedSort.value = 'relevance'
  openNow.value = false
  emitFiltersChanged()
}

// Expose reset function to parent
defineExpose({
  resetFilters,
})
</script>

<template>
  <div class="flex flex-row gap-1 items-start pb-1">
    <!-- Sort -->
    <!-- TODO: Handle filter updates -->
    <!-- @update:dropdown-value="handleSortUpdate" -->
    <Chip
      :icon="ArrowUpDownIcon"
      label="Sort"
      variant="dropdown"
      size="xs"
      :options="sortOptions"
      :dropdown-value="selectedSort"
      :force-icon="true"
      :show-clear="false"
    />

    <Chip
      :icon="LockIcon"
      label="Access"
      variant="dropdown"
      size="xs"
      :options="accessOptions"
      :multiple="true"
      :dropdown-value="selectedAccess"
    />

    <!-- Price Filter -->
    <Chip
      :icon="DollarSignIcon"
      label="Price"
      variant="dropdown"
      size="xs"
      :options="priceOptions"
      :dropdown-value="selectedPrice"
    />

    <!-- Rating Filter -->
    <Chip
      :icon="StarIcon"
      label="Rating"
      variant="dropdown"
      size="xs"
      :options="ratingOptions"
      :dropdown-value="selectedRating"
    />

    <!-- Open Now Toggle -->
    <Chip
      :icon="ClockIcon"
      label="Open Now"
      variant="toggle"
      size="xs"
      :model-value="openNow"
    />
  </div>
</template>
