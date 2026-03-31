<script setup lang="ts">
import { toRef } from 'vue'
import type { Place } from '@/types/place.types'
import { WidgetDataType } from '@/types/place.types'
import { useWidgets } from '@/composables/useWidgets'
import { widgetComponents } from './index'
import { Skeleton } from '@/components/ui/skeleton'

const props = defineProps<{
  place: Partial<Place>
}>()

const placeRef = toRef(props, 'place')
const { widgetStates, descriptorKey } = useWidgets(placeRef)
</script>

<template>
  <template v-for="descriptor in place.widgets" :key="descriptorKey(descriptor)">
    <!--
      ASYNC widgets  — fetched from the API after page load; show a skeleton while loading.
      STATIC widgets — data is embedded in the descriptor; render immediately, no skeleton.
    -->

    <!-- Skeleton placeholder — only for async widgets while loading -->
    <Skeleton
      v-if="descriptor.dataType === WidgetDataType.ASYNC && widgetStates.get(descriptorKey(descriptor))?.loading"
      class="rounded-lg"
      :style="{ minHeight: descriptor.estimatedHeight + 'px' }"
    />

    <!-- Render widget component when data is available (async or static) -->
    <component
      v-else-if="widgetStates.get(descriptorKey(descriptor))?.data"
      :is="widgetComponents[descriptor.type]"
      :data="widgetStates.get(descriptorKey(descriptor))!.data!"
      :descriptor="descriptor"
      :place="place"
    />
  </template>
</template>
