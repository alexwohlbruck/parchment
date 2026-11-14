<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Chip } from '@/components/ui/chip'
import { CountBadge } from '@/components/ui/count-badge'
import { ItemIcon } from '@/components/ui/item-icon'
import { loadPlaceTypeLabels } from '@/services/place/place-types.service'
import {
  placeTypeFacets,
  type PlaceTypeLabels,
} from '@/lib/library/place-type-filter'
import type { Bookmark } from '@/types/library.types'

const props = defineProps<{ places: Bookmark[] }>()
const selected = defineModel<string[]>({ required: true })

const { t } = useI18n()
const labels = shallowRef<PlaceTypeLabels>({})

onMounted(async () => {
  labels.value = await loadPlaceTypeLabels()
})

const facets = computed(() => placeTypeFacets(props.places, labels.value))

watch(facets, list => {
  const kept = selected.value.filter(key => list.some(f => f.key === key))
  if (kept.length !== selected.value.length) selected.value = kept
})

function toggle(key: string, on: boolean) {
  selected.value = on
    ? [...selected.value, key]
    : selected.value.filter(k => k !== key)
}
</script>

<template>
  <div
    v-if="facets.length"
    role="group"
    :aria-label="t('library.collections.filterByType')"
    class="flex gap-1.5 overflow-x-auto scrollbar-hidden -mx-1 px-1 py-0.5"
  >
    <Chip
      v-for="facet in facets"
      :key="facet.key"
      variant="toggle"
      size="sm"
      class="shrink-0"
      :label="facet.label"
      :model-value="selected.includes(facet.key)"
      @update:model-value="toggle(facet.key, $event)"
    >
      <template #leading>
        <ItemIcon
          :icon="facet.icon"
          :icon-pack="facet.iconPack"
          :color="facet.color"
          size="xs"
          shape="circle"
        />
      </template>
      <template #trailing>
        <CountBadge :count="facet.count" />
      </template>
    </Chip>
  </div>
</template>
