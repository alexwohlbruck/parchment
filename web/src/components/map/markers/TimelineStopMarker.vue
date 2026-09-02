<script setup lang="ts">
import { computed } from 'vue'
import { MapPinIcon } from 'lucide-vue-next'
import { categoryMarkerPaint } from '@/lib/place-colors'
import { markerCss } from '@/lib/map-marker'
import { useThemeStore } from '@/stores/theme.store'

defineProps<{
  /** 0-based index in the stops sequence — kept for parity with the sheet. */
  index?: number
}>()

const themeStore = useThemeStore()

// Dawarich visits don't carry a place category, so all stops use the
// "default" tint from the shared category palette — same colour search
// results / saved places use for uncategorised pins.
const css = computed(() =>
  markerCss(categoryMarkerPaint('default', themeStore.isDark), 'disc'),
)
</script>

<template>
  <!-- The same marker a search result wears, out of `map-marker` rather than a
       second copy of its sizes — which is what this used to be. -->
  <div class="shadow-md select-none" :style="css.plate">
    <MapPinIcon :style="css.glyph" />
  </div>
</template>
