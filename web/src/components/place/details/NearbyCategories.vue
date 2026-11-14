<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { createSearchResultsRoute } from '@/lib/search/search-result'
import type { Place, NearbyCategory } from '@/types/place.types'
import PlaceTypeChip from './PlaceTypeChip.vue'
import { SectionHeader } from '@/components/ui/section-header'

const props = defineProps<{
  place: Partial<Place>
}>()

const { t } = useI18n()
const router = useRouter()

const categories = computed(() => props.place.nearbyCategories || [])

function handleCategoryClick(cat: NearbyCategory) {
  router.push(createSearchResultsRoute({
    categoryId: cat.presetId,
    categoryName: cat.name,
    categoryIconCategory: cat.iconCategory,
  }))
}
</script>

<template>
  <div v-if="categories.length" class="flex flex-col gap-2">
    <SectionHeader :title="t('place.nearby.findNearby')" />
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
