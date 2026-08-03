<script setup lang="ts">
import PlaceListItem from './PlaceListItem.vue'
import type { Place } from '@/types/place.types'
import { PlaceCardSkeleton } from '@/components/place/card'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchXIcon } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  places: Place[]
  loading?: boolean
  showIcon?: boolean
}>(), {
  showIcon: true,
})

const emit = defineEmits<{
  'place-hover': [placeId: string]
  'place-leave': []
}>()
</script>

<template>
  <div class="w-full">
    <!-- Skeleton loading cards -->
    <div v-if="loading" class="space-y-2">
      <PlaceCardSkeleton v-for="i in 6" :key="i" :seed="i" />
    </div>

    <EmptyState
      v-else-if="places.length === 0"
      :icon="SearchXIcon"
      title="No places found"
      description="Try adjusting your search or exploring a different area"
    />

    <!-- Results List -->
    <div v-else class="space-y-2">
      <PlaceListItem
        v-for="place in places"
        :key="place.id"
        :place="place"
        :show-icon="showIcon"
        @mouseenter="emit('place-hover', place.id)"
        @mouseleave="emit('place-leave')"
      />
    </div>
  </div>
</template>
