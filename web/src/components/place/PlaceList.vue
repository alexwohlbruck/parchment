<script setup lang="ts">
import PlaceListItem from './PlaceListItem.vue'
import type { Place } from '@/types/place.types'

const props = defineProps<{
  places: Place[]
  loading?: boolean
}>()
</script>

<template>
  <div class="w-full">
    <div v-if="loading" class="flex items-center justify-center py-8">
      <div
        class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"
      ></div>
    </div>

    <div
      v-else-if="places.length === 0"
      class="text-center py-8 text-muted-foreground"
    >
      No places found
    </div>

    <div v-else>
      <template v-for="place in places" :key="place.id">
        <PlaceListItem :place="place" />
        <Separator v-if="place !== places[places.length - 1]" />
      </template>
    </div>
  </div>
</template>
