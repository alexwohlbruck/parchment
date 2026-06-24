<script setup lang="ts">
import type { WidgetResponse, BikeshareStatus, Place } from '@/types/place.types'
import PlaceBikeshare from '@/components/place/details/PlaceBikeshare.vue'

defineProps<{
  data: WidgetResponse<BikeshareStatus | null>
  place: Partial<Place>
}>()
</script>

<template>
  <!-- Hidden when the dock has no matching GBFS station (value is null) -->
  <PlaceBikeshare
    v-if="data.data.value"
    :status="(data.data.value as BikeshareStatus)"
  />
</template>
