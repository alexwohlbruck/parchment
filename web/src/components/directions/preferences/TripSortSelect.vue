<script setup lang="ts">
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TRIP_SORTS, type TripSort } from '@/lib/preferences/navigation-preferences'

const model = defineModel<TripSort>({ required: true })

defineProps<{ triggerClass?: string; itemClass?: string }>()
</script>

<template>
  <Select :model-value="model" @update:model-value="model = $event as TripSort">
    <SelectTrigger :class="triggerClass">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="sort in TRIP_SORTS" :key="sort" :value="sort" :class="itemClass">
        {{ $t(`directions.sort.${sort}`) }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
