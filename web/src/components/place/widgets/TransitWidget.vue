<script setup lang="ts">
import type { WidgetResponse, TransitStopInfo, Place } from '@/types/place.types'
import PlaceTransit from '@/components/place/details/PlaceTransit.vue'

const props = defineProps<{
  data: WidgetResponse<TransitStopInfo>
  place: Partial<Place>
}>()
</script>

<template>
  <PlaceTransit
    :place="place"
    :transitInfo="(data.data.value as TransitStopInfo)"
  />
</template>
