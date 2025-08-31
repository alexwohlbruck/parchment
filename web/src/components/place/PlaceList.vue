<script setup lang="ts">
import PlaceListItem from './PlaceListItem.vue'
import { Separator } from '@/components/ui/separator'
import type { Place } from '@/types/place.types'
import { Spinner } from '@/components/ui/spinner'

const props = defineProps<{
  places: Place[]
  loading?: boolean
}>()

const emit = defineEmits<{
  'place-hover': [placeId: string]
  'place-leave': []
}>()
</script>

<template>
  <div class="w-full">
    <!-- Loading State -->
    <div
      v-if="loading"
      class="flex flex-col h-full items-center justify-center"
    >
      <Spinner />
    </div>

    <!-- Empty State -->
    <div
      v-else-if="places.length === 0"
      class="flex flex-col items-center justify-center py-12 space-y-3"
    >
      <div
        class="w-12 h-12 bg-muted/50 rounded-full flex items-center justify-center"
      >
        <svg
          class="w-6 h-6 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </div>
      <div class="text-center space-y-0.5">
        <p class="text-base font-semibold text-foreground">No places found</p>
        <p class="text-sm text-muted-foreground">
          Try adjusting your search or exploring a different area
        </p>
      </div>
    </div>

    <!-- Results List -->
    <div v-else class="space-y-2">
      <PlaceListItem
        v-for="place in places"
        :key="place.id"
        :place="place"
        @mouseenter="emit('place-hover', place.id)"
        @mouseleave="emit('place-leave')"
      />
    </div>
  </div>
</template>
