<script setup lang="ts">
import type { WidgetResponse, WidgetDescriptor, TransitStopInfo, Place } from '@/types/place.types'
import PlaceTransit from '@/components/place/details/PlaceTransit.vue'

const props = defineProps<{
  data: WidgetResponse<TransitStopInfo>
  descriptor: WidgetDescriptor
  place: Partial<Place>
}>()
</script>

<template>
  <PlaceTransit
    :place="place"
    :transitInfo="(data.data.value as TransitStopInfo)"
    :widgetParams="(descriptor.params as Record<string, string>)"
  />
</template>
