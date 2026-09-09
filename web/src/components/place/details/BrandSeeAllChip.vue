<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import type { Place } from '@/types/place.types'
import { ItemIcon } from '@/components/ui/item-icon'

const props = defineProps<{
  place: Partial<Place>
}>()

const { t } = useI18n()
const router = useRouter()

// Prefer the server-resolved brand; fall back to reading the OSM tags directly
// (mirrors server/src/lib/brand.ts so the chip works even before enrichment).
const brand = computed(() => {
  if (props.place.brand) return props.place.brand
  const tags = props.place.tags
  if (!tags) return null
  const wikidata = tags['brand:wikidata'] || undefined
  const name = tags['brand'] || undefined
  if (!wikidata && !name) return null
  const brandKey = wikidata
    ? wikidata
    : `name:${name!.trim().toLowerCase().replace(/\s+/g, ' ')}`
  return { brandKey, name: (name ?? wikidata) as string, wikidata }
})

const coordinates = computed(() => props.place?.geometry?.value?.center ?? null)

function handleClick() {
  const b = brand.value
  if (!b) return
  const query: Record<string, string> = {
    brandKey: b.brandKey,
    brandName: b.name,
  }
  if (coordinates.value) {
    query.lat = String(coordinates.value.lat)
    query.lng = String(coordinates.value.lng)
  }
  router.push({ name: AppRoute.SEARCH_RESULTS, query })
}
</script>

<template>
  <button
    v-if="brand"
    class="inline-flex items-center gap-1.5 rounded-full border pl-0.5 pr-2.5 py-0.5 bg-background transition-colors hover:bg-muted self-start"
    @click="handleClick"
  >
    <ItemIcon
      icon="Store"
      icon-pack="lucide"
      :image-url="(brand as any).logoUrl"
      size="xs"
      shape="circle"
      variant="solid"
      class="shadow-sm"
    />
    <span class="text-xs font-medium">{{ t('place.brand.seeAll', { name: brand.name }) }}</span>
  </button>
</template>
