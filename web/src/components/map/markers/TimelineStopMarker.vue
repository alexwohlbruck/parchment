<script setup lang="ts">
import PoiMarker from './PoiMarker.vue'

defineProps<{
  /** 0-based index in the stops sequence — kept for parity with the sheet. */
  index?: number
}>()
</script>

<template>
  <!-- Visits carry no place category, so every stop wears the default tint. -->
  <PoiMarker icon-name="MapPin" category="default" />
</template>
