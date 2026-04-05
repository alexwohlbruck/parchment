<script setup lang="ts">
import { computed } from 'vue'
import type { Place, DisplayChip } from '@/types/place.types'
import { resolveIconByName } from '@/lib/osm-tag-icons'

const props = defineProps<{
  place: Partial<Place>
}>()

/** General display chips (not routed to a specific section like diet) */
const generalChips = computed((): DisplayChip[] =>
  (props.place.displayChips ?? []).filter(c => !c.section)
)
</script>

<template>
  <div v-if="generalChips.length > 0" class="flex flex-wrap gap-1.5">
    <span
      v-for="chip in generalChips"
      :key="`${chip.key}_${chip.value}`"
      class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs"
      :class="chip.sentiment === 'negative' ? 'text-muted-foreground' : 'bg-muted text-foreground'"
    >
      <component :is="resolveIconByName(chip.icon)" class="size-3" />
      <span>{{ chip.label }}</span>
    </span>
  </div>
</template>
