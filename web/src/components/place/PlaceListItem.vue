<script setup lang="ts">
import type { Place } from '@/types/place.types'
import { PlaceCard } from '@/components/place/card'

/**
 * A search-result row: the richest place presentation, showing everything the
 * record carries. Kept as a named component because "the search result row" is
 * a recurring concept — see `PlaceCard` for every other place surface.
 */
withDefaults(
  defineProps<{
    place: Place
    showIcon?: boolean
  }>(),
  { showIcon: true },
)
</script>

<template>
  <PlaceCard :place="place" variant="row" size="sm" density="rich" :show-icon="showIcon" />
</template>
