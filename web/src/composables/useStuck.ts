import { ref, watch, onUnmounted, type Ref } from 'vue'
import { findScrollAncestor } from '@/lib/scroll'

/**
 * Tracks whether a `position: sticky` element is actually covering content.
 *
 * `stuck` needs both halves to be true: the element can rise no higher than
 * its docked line, and the surface has scrolled at all. The second half
 * matters for a header whose resting position already IS its dock line — it
 * is pinned from the moment it mounts, so without it a border meant to appear
 * on scroll would simply never be off.
 *
 * Pass the element ref you already have, or attach the returned one:
 *
 * ```vue
 * const { stuckRef, stuck } = useStuck()
 * <div ref="stuckRef" class="sticky top-0" :class="stuck && 'border-b'" />
 * ```
 *
 * Stays false when there is no scrollable ancestor, so a view rendered outside
 * a scroll surface simply never reports itself pinned.
 */
export function useStuck(target?: Ref<HTMLElement | null>): {
  stuckRef: Ref<HTMLElement | null>
  stuck: Ref<boolean>
} {
  const stuckRef = target ?? ref<HTMLElement | null>(null)
  const stuck = ref(false)

  let scrollRoot: HTMLElement | null = null
  let raf = 0

  function measure() {
    raf = 0
    const el = stuckRef.value
    if (!el || !scrollRoot) return
    // The sticky top is a CSS variable in sheets, so read the resolved value
    // rather than assuming the element docks at the scroll root's own top.
    const dockTop = parseFloat(getComputedStyle(el).top) || 0
    const rootTop = scrollRoot.getBoundingClientRect().top
    stuck.value =
      scrollRoot.scrollTop > 0 &&
      el.getBoundingClientRect().top <= rootTop + dockTop + 0.5
  }

  function onScroll() {
    if (!raf) raf = requestAnimationFrame(measure)
  }

  function detach() {
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    scrollRoot?.removeEventListener('scroll', onScroll)
    scrollRoot = null
    stuck.value = false
  }

  // Re-attach whenever the element swaps (v-if regions), not just on mount.
  watch(
    stuckRef,
    el => {
      detach()
      if (!el) return
      scrollRoot = findScrollAncestor(el)
      scrollRoot?.addEventListener('scroll', onScroll, { passive: true })
      measure()
    },
    { immediate: true, flush: 'post' },
  )

  onUnmounted(detach)

  return { stuckRef, stuck }
}
