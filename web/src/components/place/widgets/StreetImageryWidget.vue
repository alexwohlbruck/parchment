<script setup lang="ts">
import type { WidgetResponse, StreetImageryPreview, Place } from '@/types/place.types'
import PlaceStreetImagery from '@/components/place/details/PlaceStreetImagery.vue'

defineProps<{
  data: WidgetResponse<StreetImageryPreview | null>
  place: Partial<Place>
}>()
</script>

<template>
  <!-- Hidden when no imagery exists near the place (value is null) -->
  <PlaceStreetImagery
    v-if="data.data.value"
    :preview="data.data.value"
  />
</template>
