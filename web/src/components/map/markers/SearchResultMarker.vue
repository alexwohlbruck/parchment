<script setup lang="ts">
import { computed } from 'vue'
import PoiMarker from './PoiMarker.vue'
import {
  getSearchResultIconName,
  getSearchResultIconPack,
  getSearchResultCategory,
} from '@/lib/search/search-result'
import type { MarkerShape } from '@/lib/map-marker'
import type { Place } from '@/types/place.types'

const { place, isHovered, shape = 'disc' } = defineProps<{
  place: Place
  isHovered?: boolean
  /** How the marker draws. Transit results read better as a square plate. */
  shape?: MarkerShape
}>()

const emit = defineEmits<{
  click: [place: Place, event: MouseEvent]
  mouseenter: [place: Place, event: MouseEvent]
  mouseleave: [place: Place, event: MouseEvent]
}>()

const iconName = computed(() => getSearchResultIconName(place))
const iconPack = computed(() => getSearchResultIconPack(place))
const category = computed(() => getSearchResultCategory(place))
</script>

<template>
  <PoiMarker
    :icon-name="iconName"
    :icon-pack="iconPack"
    :category="category"
    :shape="shape"
    :is-hovered="isHovered"
    @click="emit('click', place, $event)"
    @mouseenter="emit('mouseenter', place, $event)"
    @mouseleave="emit('mouseleave', place, $event)"
  />
</template>
