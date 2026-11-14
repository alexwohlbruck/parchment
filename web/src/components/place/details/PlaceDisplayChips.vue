<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { Place, DisplayChip } from '@/types/place.types'
import { resolveIconByName } from '@/lib/place/osm-tag-icons'
import { createSearchResultsRoute } from '@/lib/search/search-result'
import { useCategoryStore } from '@/stores/category.store'

const props = defineProps<{
  place: Partial<Place>
}>()

const router = useRouter()
const categoryStore = useCategoryStore()

/** General display chips (not routed to a specific section like diet) */
const generalChips = computed((): DisplayChip[] =>
  (props.place.displayChips ?? []).filter(c => !c.section)
)

function searchChip(chip: DisplayChip) {
  if (!chip.searchId) return
  const category = categoryStore.getCategoryById(chip.searchId)
  router.push(createSearchResultsRoute({
    categoryId: chip.searchId,
    categoryName: category?.name ?? chip.label,
    categoryIconCategory: category?.iconCategory,
  }))
}
</script>

<template>
  <div v-if="generalChips.length > 0" class="flex flex-wrap gap-1.5">
    <component
      :is="chip.searchId ? 'button' : 'span'"
      v-for="chip in generalChips"
      :key="`${chip.key}_${chip.value}`"
      :type="chip.searchId ? 'button' : undefined"
      class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
      :class="[
        chip.sentiment === 'negative' ? 'text-muted-foreground' : 'bg-muted text-foreground',
        chip.searchId && 'cursor-pointer transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      ]"
      @click="searchChip(chip)"
    >
      <component :is="resolveIconByName(chip.icon)" class="size-3" />
      <span>{{ chip.label }}</span>
    </component>
  </div>
</template>
