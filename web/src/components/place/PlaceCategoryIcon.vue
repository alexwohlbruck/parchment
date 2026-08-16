<script setup lang="ts">
import { computed } from 'vue'
import type { Place } from '@/types/place.types'
import { ItemIcon } from '@/components/ui/item-icon'
import {
  getSearchResultIconName,
  getSearchResultIconPack,
  getSearchResultCategory,
} from '@/lib/search.utils'
import { getCategoryColor } from '@/lib/place-colors'
import { useThemeStore } from '@/stores/theme.store'

/**
 * A place's POI icon in its category colour — the tinted circle the place
 * header wears next to the category label. Any surface that identifies a
 * place by its category (the header, the map context menu) renders this so
 * the same place looks the same everywhere.
 */
const props = defineProps<{
  place?: Partial<Place> | null
}>()

const themeStore = useThemeStore()

const icon = computed(() =>
  props.place ? getSearchResultIconName(props.place as Place) : 'MapPin',
)

const iconPack = computed(() =>
  props.place
    ? getSearchResultIconPack(props.place as Place)
    : ('lucide' as const),
)

const color = computed(() =>
  getCategoryColor(
    props.place ? getSearchResultCategory(props.place as Place) : 'default',
    themeStore.isDark,
  ),
)
</script>

<template>
  <ItemIcon
    :icon="icon"
    :icon-pack="iconPack"
    :custom-color="color"
    size="xs"
    variant="solid"
    shape="circle"
    class="!size-5"
  />
</template>
