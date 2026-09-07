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
       unstuck once content scrolled past it.

       The mobile inset only exists to keep the first row out from under the
       sheet's floating handle and buttons. A view that pins a header claims
       the chrome bar instead — which both paints that strip and raises
       `--sheet-sticky-top` — so the inset gives way to it exactly then, and
       the header docks with nothing above it. -->
  <div
    class="min-h-full flex flex-col pb-4 px-3
           pt-[max(0px,calc(1.5rem_-_var(--sheet-sticky-top,0px)))] md:pt-4"
  >
    <slot />
  </div>
</template>
