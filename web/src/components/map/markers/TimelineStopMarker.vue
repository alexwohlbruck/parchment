<script setup lang="ts">
import { computed } from 'vue'
import { MapPinIcon } from 'lucide-vue-next'
import { getCategoryMarkerTint } from '@/lib/place-colors'
import { useThemeStore } from '@/stores/theme.store'

defineProps<{
  /** 0-based index in the stops sequence — kept for parity with the sheet. */
  index?: number
}>()

const themeStore = useThemeStore()

// Dawarich visits don't carry a place category, so all stops use the
// "default" tint from the shared category palette — same colour search
// results / saved places use for uncategorised pins.
const tint = computed(() => getCategoryMarkerTint('default', themeStore.isDark))
</script>

<template>
  <!-- Mirrors SearchResultMapIcon: 22px circle wearing the category's plate,
       ring and glyph. Keeps the timeline visually consistent with
       search-result and saved-place pins. -->
  <div
    class="size-[22px] border-[1.5px] rounded-full flex items-center justify-center shadow-md select-none"
    :style="{ backgroundColor: tint.plate, borderColor: tint.ring, color: tint.ink }"
  >
    <MapPinIcon class="size-3" />
  </div>
</template>
