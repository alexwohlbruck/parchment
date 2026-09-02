<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useMediaQuery, useTransition } from '@vueuse/core'
import { TooltipProvider } from '@/components/ui/tooltip'
import { provideSidebarContext } from './context'
import {
  SIDEBAR_COLLAPSE_SLACK,
  SIDEBAR_DRAG_THRESHOLD,
  SIDEBAR_DURATION_MS,
  SIDEBAR_EASING,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_ICON,
} from './scale'

/**
 * A collapsible, drag-resizable side rail.
 *
 * Width is animated as a real number rather than a CSS transition so hosts
 * can stay in lockstep with it frame by frame — the map next door has to
 * resize and re-publish its padding as the rail moves, and a CSS transition
 * gives it nothing to listen to. Same reason `LeftSheet` drives its slide
 * off a `useTransition` value.
 */
const props = withDefaults(
  defineProps<{
    /** Icon-rail width, px. */
    collapsedWidth?: number
    /** Drag-resize bounds for the expanded panel, px. */
    minWidth?: number
    maxWidth?: number
    /** Labels the landmark for screen readers. */
    label?: string
    /** Landmark element. A sidebar that isn't navigation should say so. */
    as?: string
  }>(),
  {
    collapsedWidth: SIDEBAR_WIDTH_ICON,
    minWidth: SIDEBAR_MIN_WIDTH,
    maxWidth: SIDEBAR_MAX_WIDTH,
    as: 'nav',
  },
)

const collapsed = defineModel<boolean>('collapsed', { default: false })
/** Expanded width, px. Owned by the host so it can be persisted. */
const width = defineModel<number>('width', { default: SIDEBAR_WIDTH })

const emit = defineEmits<{
  /** Fires on every frame of a collapse, expand or drag. */
  (e: 'resize', width: number): void
}>()

const resizing = ref(false)
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

const targetWidth = computed(() =>
  collapsed.value ? props.collapsedWidth : width.value,
)
// A drag has to track the pointer exactly, and a reduced-motion preference
// wants no travel at all. Both are a zero-length transition rather than
// `disabled`, which skips the source watcher and would leave the output
// holding a stale width the moment the drag ended.
const duration = computed(() =>
  resizing.value || reducedMotion.value ? 0 : SIDEBAR_DURATION_MS,
)
const animatedWidth = useTransition(targetWidth, {
  duration,
  transition: SIDEBAR_EASING,
})

// After the DOM update, not before it: hosts react to this by measuring the
// panel and resizing a neighbour, and a pre-flush watcher would hand them the
// width from the previous frame.
watch(animatedWidth, w => emit('resize', w), { flush: 'post' })

function toggle() {
  collapsed.value = !collapsed.value
}

/**
 * Dragging the rail sizes the panel; dragging it well inside the minimum
 * collapses it, and dragging back out brings it straight back — the offset is
 * always measured from where the press started, so the panel never jumps.
 */
function startResize(event: PointerEvent): Promise<boolean> {
  const startX = event.clientX
  const startWidth = collapsed.value ? props.collapsedWidth : width.value
  let dragged = false

  return new Promise(resolve => {
    function onMove(e: PointerEvent) {
      const dx = e.clientX - startX
      if (!dragged && Math.abs(dx) < SIDEBAR_DRAG_THRESHOLD) return
      if (!dragged) {
        dragged = true
        resizing.value = true
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
      }
      const next = startWidth + dx
      if (next < props.minWidth - SIDEBAR_COLLAPSE_SLACK) {
        collapsed.value = true
      } else {
        collapsed.value = false
        width.value = Math.min(props.maxWidth, Math.max(props.minWidth, next))
      }
    }

    function onEnd() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      if (dragged) {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      // Released a frame after the last move, the panel would animate the
      // final few pixels instead of landing on them. Hold the drag open for
      // one flush so that last width is applied instantly, like the rest.
      void nextTick(() => (resizing.value = false))
      resolve(dragged)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  })
}

provideSidebarContext({ collapsed, toggle, resizing, startResize })
</script>

<template>
  <component
    :is="as"
    :aria-label="label"
    :data-collapsed="collapsed"
    :data-resizing="resizing"
    class="relative shrink-0 h-full flex flex-col overflow-hidden border-r border-border/60"
    :style="{ width: `${animatedWidth}px` }"
  >
    <TooltipProvider :delay-duration="collapsed ? 200 : 500">
      <slot />
    </TooltipProvider>
  </component>
</template>
