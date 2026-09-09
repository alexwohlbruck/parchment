<script setup lang="ts">
import PlaceListItem from './PlaceListItem.vue'
import type { Place } from '@/types/place.types'
import { PlaceCardSkeleton } from '@/components/place/card'
import { SkeletonList } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchXIcon } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  places: Place[]
  loading?: boolean
  showIcon?: boolean
  /** The list is empty because the app is offline, not because the search found nothing. */
  offline?: boolean
}>(), {
  showIcon: true,
  offline: false,
})

const emit = defineEmits<{
  'place-hover': [placeId: string]
  'place-leave': []
  retry: []
}>()
</script>

<template>
  <div class="w-full">
    <!-- Skeleton loading cards -->
    <SkeletonList v-if="loading" :count="6" v-slot="{ index }">
      <PlaceCardSkeleton :seed="index" />
    </SkeletonList>

    <EmptyState
      v-else-if="places.length === 0"
      :icon="SearchXIcon"
      title="No places found"
      description="Try adjusting your search or exploring a different area"
      :offline="offline"
      @retry="emit('retry')"
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
