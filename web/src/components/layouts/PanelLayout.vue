<script setup lang="ts">
/**
 * Basic panel layout with default padding.
 * Use this for standard content in LeftSheet/BottomSheet.
 */
import { inject, computed, type Ref } from 'vue'

// When the host sheet shows its opaque chrome bar (a pinned-header view like
// Directions), the bar already clears the drag handle / close button, so the
// top inset is just breathing room. Otherwise the content scrolls under the
// transparent chrome and needs a larger inset to sit below the drag handle.
const chromeBar = inject<Ref<boolean> | null>('sheetChromeBar', null)
const topPadding = computed(() => (chromeBar?.value ? 'pt-2' : 'pt-6 md:pt-4'))
</script>

<template>
  <div class="h-full flex flex-col pb-4 px-3" :class="topPadding">
    <slot />
  </div>
</template>
