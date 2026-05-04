<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue'
import { provideSheetPage } from '@/composables/useSheetPage'

// Stack lifecycle and route reconciliation (path-change clears, view-query
// sync) are owned by the composable now — see `provideSheetPage`.
const { activePage, hasPages, depth, popPage } = provideSheetPage()

const emit = defineEmits<{
  (e: 'update:hasPages', value: boolean): void
}>()

watch(hasPages, v => emit('update:hasPages', v), { immediate: true })

// ─── Scroll preservation per stack frame ──────────────────────────────────
//
// The host is rendered inside the BottomSheet's scrollContainer — a single
// scroll surface shared by every layer. Without intervention, opening a
// sub-page leaves the surface scrolled wherever main was, and going back
// strands main wherever the sub-page left off.
//
// We snapshot the scroll surface's scrollTop on every push and restore it
// on the matching pop. The scroll surface itself stays the same physical
// element — we just swap its scrollTop value as the user navigates the
// stack. Combined with the layout fix below (inactive layer goes
// position:absolute so only the active layer contributes scroll height),
// this gives each page its own effective scroll system without nested
// overflow:auto containers (which fight on mobile).

const hostRef = ref<HTMLElement | null>(null)
let scrollAncestor: HTMLElement | null = null
const scrollStack: number[] = []

function findScrollAncestor(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null
  // BottomSheet annotates its scrollContainer with `data-sheet-scroll` so
  // we can target it explicitly. Falls back to walking up looking for any
  // overflow-y-set ancestor — useful if a future host wraps us in a
  // different scrollable container.
  const tagged = el.closest('[data-sheet-scroll]') as HTMLElement | null
  if (tagged) return tagged

  let cur: HTMLElement | null = el.parentElement
  while (cur) {
    const overflow = getComputedStyle(cur).overflowY
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') {
      return cur
    }
    cur = cur.parentElement
  }
  return null
}

onMounted(() => {
  scrollAncestor = findScrollAncestor(hostRef.value)
})

watch(depth, (newDepth, oldDepth) => {
  if (!scrollAncestor) return

  if (newDepth > oldDepth) {
    // Push: snapshot the scroll position the user was at, then jump to the
    // top of the incoming sub-page. nextTick so the new layer is in the
    // DOM and the scroll surface knows its post-push content height.
    scrollStack.push(scrollAncestor.scrollTop)
    nextTick(() => {
      if (scrollAncestor) scrollAncestor.scrollTop = 0
    })
  } else if (newDepth < oldDepth) {
    // Pop: put the user back where they were on the layer they just
    // returned to. Restore on nextTick so main has been promoted back to
    // in-flow first (its scrollHeight needs to be valid before we set
    // scrollTop, otherwise the browser clamps the value).
    const saved = scrollStack.pop()
    if (saved !== undefined) {
      nextTick(() => {
        if (scrollAncestor) scrollAncestor.scrollTop = saved
      })
    }
  }
})
</script>

<template>
  <!--
    Layout strategy:
      - Main layer is ALWAYS mounted (never v-if'd), so widget data fetches
        survive a sub-page round-trip — no skeleton flash on back-nav.
      - When a sub-page is active, main goes `position: absolute` so it
        contributes nothing to the parent's scroll height. The sub-page is
        the only in-flow child, and the scroll surface sees only its
        height. When no sub-page is active, main is back in flow and
        determines the height as usual.
      - The Vue Transition handles sub-page enter/leave (slide + fade);
        main animates via its own CSS transition triggered by the .pushed
        class. They overlap visually during the swap because main paints
        on top of sub-page (positioned elements paint after static ones),
        giving the cohesive cross-fade.
      - During sub-page LEAVE, the sub-page itself goes position:absolute
        (via leave-active class) so it doesn't shove main down while
        animating off. Without this, popping briefly stacks both vertically.
  -->
  <div ref="hostRef" class="sheet-page-host">
    <div
      class="sheet-page-layer sheet-page-main"
      :class="{ 'sheet-page-main-pushed': hasPages }"
      :inert="hasPages"
    >
      <slot />
    </div>

    <Transition name="sheet-page">
      <component
        v-if="activePage"
        :is="activePage.component"
        v-bind="activePage.props"
        :key="`${activePage.name}:${activePage.query ? JSON.stringify(activePage.query) : ''}`"
        class="sheet-page-layer sheet-page-sub"
        @back="popPage"
      />
    </Transition>
  </div>
</template>

<style>
.sheet-page-host {
  position: relative;
}

.sheet-page-layer {
  min-width: 0;
}

/* Main layer animates between in-flow / out-of-flow states via the .pushed
   modifier. The transition is on transform/opacity only; the position-
   property change is instant (browsers don't interpolate position), but
   visually the element stays at 0,0 because the host is position:relative
   and `inset: 0` matches its in-flow location. */
.sheet-page-main {
  transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1),
              opacity 0.35s cubic-bezier(0.32, 0.72, 0, 1);
}

.sheet-page-main-pushed {
  position: absolute;
  inset: 0;
  transform: translateX(-10%);
  opacity: 0;
  pointer-events: none;
}

/* Sub-page is in normal flow when settled (so its content drives the
   parent's scroll height) and goes position:absolute only while leaving,
   so the back-transition doesn't briefly stack it below main.

   Min-height keeps a short sub-page filling the visible drawer instead of
   floating as a tiny box at the top with empty space below. Tall sub-pages
   grow past it and scroll naturally — min-height doesn't cap. We use
   `100dvh` so iOS Safari's collapsing address bar doesn't force the page
   ~80px taller than the visible viewport (creating the very empty-scroll
   gap this rule is meant to eliminate). `100vh` is the fallback for
   browsers that don't yet support dynamic viewport units. */
.sheet-page-sub {
  min-height: 100vh;
  min-height: 100dvh;
}

.sheet-page-enter-active,
.sheet-page-leave-active {
  transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1),
              opacity 0.35s cubic-bezier(0.32, 0.72, 0, 1);
}

.sheet-page-leave-active {
  position: absolute;
  inset: 0;
}

.sheet-page-enter-from {
  transform: translateX(20%);
  opacity: 0;
}

.sheet-page-leave-to {
  transform: translateX(20%);
  opacity: 0;
}
</style>
