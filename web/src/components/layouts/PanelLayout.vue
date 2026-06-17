<script setup lang="ts">
/**
 * Basic panel layout with default padding.
 * Use this for standard content in LeftSheet/BottomSheet. The host sheet's
 * drag handle / action buttons float as an overlay (they take no layout
 * space), so the same top inset works whether or not the sheet shows its
 * chrome bar — content sits just below the handle, and a pinned-header view
 * docks its sticky header under the chrome via `--sheet-sticky-top`.
 */
</script>

<template>
  <!-- min-h-full (not h-full): fills the sheet when content is short, but
       GROWS with tall content so it stays the containing block for sticky
       children. With h-full the box capped at one viewport and sticky headers
       unstuck once content scrolled past it. -->
  <div class="min-h-full flex flex-col pt-6 md:pt-4 pb-4 px-3">
    <slot />
  </div>
</template>
