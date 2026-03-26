<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import type { Place, NearbyCategory } from '@/types/place.types'
import PlaceTypeChip from './PlaceTypeChip.vue'

const props = defineProps<{
  place: Partial<Place>
}>()

const router = useRouter()

const categories = computed(() => props.place.nearbyCategories || [])

const coordinates = computed(() => {
  if (!props.place?.geometry) return null
  return props.place.geometry.value.center
})

function handleCategoryClick(cat: NearbyCategory) {
  const query: Record<string, string> = {
    categoryId: cat.presetId,
    categoryName: cat.name,
  }

  // Scope the search near the place's coordinates
  if (coordinates.value) {
    query.lat = String(coordinates.value.lat)
    query.lng = String(coordinates.value.lng)
  }

  router.push({
    name: AppRoute.SEARCH_RESULTS,
    query,
  })
}
</script>

<template>
  <div v-if="categories.length" class="flex flex-col gap-2">
    <h3 class="text-sm font-semibold text-muted-foreground">Find nearby</h3>
    <div class="flex flex-wrap gap-1.5">
    <PlaceTypeChip
      v-for="cat in categories"
      :key="cat.presetId"
      :preset-id="cat.presetId"
      :name="cat.name"
      :icon="cat.icon"
      :icon-pack="cat.iconPack"
      :icon-category="cat.iconCategory"
      @click="handleCategoryClick(cat)"
    />
    </div>
  </div>
</template>
