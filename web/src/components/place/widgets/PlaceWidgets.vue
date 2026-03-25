<script setup lang="ts">
import { toRef } from 'vue'
import type { Place } from '@/types/place.types'
import { useWidgets } from '@/composables/useWidgets'
import { widgetComponents } from './index'
import { Skeleton } from '@/components/ui/skeleton'

const props = defineProps<{
  place: Partial<Place>
}>()

const placeRef = toRef(props, 'place')
const { widgetStates } = useWidgets(placeRef)
</script>

<template>
  <template v-for="descriptor in place.widgets" :key="descriptor.type">
    <!-- Skeleton placeholder while loading -->
    <Skeleton
      v-if="widgetStates.get(descriptor.type)?.loading"
      class="rounded-lg"
      :style="{ minHeight: descriptor.estimatedHeight + 'px' }"
    />

    <!-- Render widget component when data is loaded -->
    <component
      v-else-if="widgetStates.get(descriptor.type)?.data"
      :is="widgetComponents[descriptor.type]"
      :data="widgetStates.get(descriptor.type)!.data!"
      :descriptor="descriptor"
      :place="place"
    />
  </template>
</template>
