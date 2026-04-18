<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { cn } from '@/lib/utils'
import { useWindowSize, useScroll, useScreenSafeArea } from '@vueuse/core'
import { useObstructingComponent } from '@/composables/useObstructingComponent'
import { type ManualBounds } from '@/stores/app.store'
import { useHotkeys } from '@/composables/useHotkeys'
import { useDrawerCoordination } from '@/composables/useDrawerCoordination'
import {
  DrawerRoot,
  DrawerContent,
  DrawerOverlay,
  DrawerPortal,
  DrawerHandle,
  DrawerClose,
} from '@alexwohlbruck/vaul-vue'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-vue-next'
import { handleVaulRelease } from '@/lib/vaulChromeWorkaround'

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class']
    peekHeight?: number | string
    modal?: boolean
    dismissable?: boolean
    open?: boolean
    showDragHandle?: boolean
    showCloseButton?: boolean
    activeSnapPoint?: number | string | null
    defaultSnapPointIndex?: number
    customSnapPoints?: (number | string)[]
    obstructingKey?: string
    /**
     * When true, the sheet publishes its bounds to the app store so the
     * map shifts its padding (and therefore its visual center) to stay
     * inside the unoccluded area as the sheet slides / drags. Opt-in:
     * only the top-level nav sheet (the one hosting `<router-view />`)
     * should set this. Nested / popover-style sheets should stay off so
     * they don't nudge the map on every open.
     */
    adjustMapPadding?: boolean
    parentId?: string
    zIndexOffset?: number
    respectSafeArea?: boolean
    fitContent?: boolean
  }>(),
  {
    open: true,
    modal: false,
    peekHeight: '125px',
    obstructingKey: 'bottom-sheet',
    defaultSnapPointIndex: 0,
    adjustMapPadding: false,
    zIndexOffset: 0,
    respectSafeArea: true,
  },
)

const emit = defineEmits<{
  (e: 'update:open', open: boolean): void
  (e: 'snapPointChange', snapPoint: string): void
  (e: 'update:activeSnapPoint', snapPoint: number | string | null): void
  (e: 'update:activeSnapPointIndex', index: number): void
}>()

const sheet = ref<HTMLElement | null>(null)
const drawerContentRef = ref<InstanceType<typeof DrawerContent> | null>(null)
const scrollContainer = ref<HTMLElement | null>(null)
const headerRef = ref<HTMLElement | null>(null)
const activeSnapPoint = ref<number | string | null>(
  props.activeSnapPoint ?? null,
)
const { width: windowWidth, height: windowHeight } = useWindowSize()
const { registerDismissing, unregisterDismissing, isDismissing } =
  useDrawerCoordination()
const drawerId =
  props.parentId || `drawer-${Math.random().toString(36).substr(2, 9)}`

// ==================== HELPERS ====================

type SnapPoint = number | string

// Convert any snap point format to pixel height
function snapPointToPixels(point: SnapPoint): number {
  if (typeof point === 'string') return parseFloat(point)
  if (point > 0 && point <= 1) return windowHeight.value * point
  return point
}

// ==================== OBSTRUCTING BOUNDS ====================
//
// Three-phase bounds tracking driven by Vaul's lifecycle events:
//   - Idle (no drag, no transition in flight) → publish the TARGET bounds
//     derived from `activeSnapPoint`. Publishing the target (rather than
//     whatever the element currently measures) is essential on programmatic
//     open so consumers that call flyTo at open time — e.g. Place.vue
//     flying to a marker — compute their camera center against the FINAL
//     padding, otherwise the marker lands mid-canvas instead of mid-
//     visible-area.
//   - Dragging (Vaul @drag firing, before @release) → publish the live
//     element rect every frame via rAF, so the map vanishing point tracks
//     the finger.
//   - Animating (between @release / programmatic open-close and
//     @animation-end) → keep publishing the live element rect every frame
//     so the vanishing point rides the Vaul snap-to-position CSS transition
//     smoothly. Without this, padding snaps to target instantly while the
//     drawer is still mid-transition.
//
// Fully-expanded snap point is capped to the second-to-last snap point so
// the padding doesn't eat the entire canvas when the drawer is at 100%.

const isDragging = ref(false)
const isAnimating = ref(false)
const liveBounds = ref<ManualBounds | null>(null)
const useLiveBounds = computed(() => isDragging.value || isAnimating.value)

function getElementBounds(): ManualBounds | null {
  // drawerContentRef.$el can be a Comment placeholder while the Vaul portal
  // is mounting — guard before calling getBoundingClientRect.
  const raw = drawerContentRef.value?.$el as
    | { getBoundingClientRect?: () => DOMRect }
    | null
    | undefined
  if (!raw || typeof raw.getBoundingClientRect !== 'function') return null
  const r = raw.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  return { x: r.left, y: r.top, width: r.width, height: r.height }
}

function snapPointBounds(point: SnapPoint | null): ManualBounds | null {
  if (point === null) return null
  const height = snapPointToPixels(point)
  return {
    x: 0,
    y: windowHeight.value - height,
    width: windowWidth.value,
    height,
  }
}

// BottomSheet publishes its real obstruction rect — the 50% map-padding cap
// lives in map.service so it applies consistently during drag and programmatic
// motion, rather than being gated on `isFullyExpanded` (which is sticky
// during drag because Vaul only commits activeSnapPoint on @release and was
// causing drag bounds to be frozen at the cap while the drawer visibly moved).

const manualBounds = computed<ManualBounds | null>(() => {
  if (!props.adjustMapPadding) return null
  // Fully closed + no animation in flight → drawer is off-screen, clear
  // bounds so the map padding drops to zero.
  if (!props.open && !isAnimating.value) return null
  // Drag, snap-back, open, or close animation → live bounds so the
  // vanishing point tracks the drawer's actual position.
  if (liveBounds.value) return liveBounds.value
  return snapPointBounds(activeSnapPoint.value)
})

useObstructingComponent(sheet, props.obstructingKey, manualBounds)

// Mirror DrawerContent's $el into `sheet` for the composable.
watch(
  () => drawerContentRef.value?.$el as HTMLElement | undefined,
  el => {
    sheet.value = el ?? null
  },
  { immediate: true, flush: 'post' },
)

// rAF loop — runs only while the drawer is dragging or mid-animation.
// Self-cancels once both flags go false.
let rafId = 0
function tickLiveBounds() {
  if (!useLiveBounds.value) {
    rafId = 0
    return
  }
  liveBounds.value = getElementBounds()
  rafId = requestAnimationFrame(tickLiveBounds)
}
function startLiveTracking() {
  liveBounds.value = getElementBounds()
  if (rafId === 0) rafId = requestAnimationFrame(tickLiveBounds)
}
function stopLiveTracking() {
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  liveBounds.value = null
}

// ---- Vaul event wiring ----

// Vaul fires @drag repeatedly during a user drag. We keep the rAF warm on
// every call (idempotent — startLiveTracking won't schedule a second loop
// if one is already running) so the first drag frame after a programmatic
// open always lands live bounds.
function onVaulDrag(_percentageDragged: number) {
  isDragging.value = true
  startLiveTracking()
}

// Vaul fires @release when the user ends a drag. Vaul then runs the CSS
// transition to snap the drawer to the nearest allowed snap point. We flip
// from drag mode to animation mode so the rAF keeps ticking through the
// transition, and let @animation-end clear it.
function onVaulRelease() {
  handleVaulRelease()
  isDragging.value = false
  isAnimating.value = true
  startLiveTracking()
}

// Programmatic open / close also triggers a CSS transition on the drawer.
// Flag animation so the live tracker runs until @animation-end.
watch(
  () => props.open,
  () => {
    isAnimating.value = true
    startLiveTracking()
  },
)

// Backup pointer-based drag detection. Vaul's @drag has a small movement
// threshold before it fires, and the first drag gesture after the open
// animation can miss a frame or two. Arm drag mode optimistically on any
// pointerdown inside the drawer — Vaul will confirm with @release /
// @animation-end which clear it. Taps (pointerdown without significant
// movement) just cause a handful of cheap rAF ticks.
//
// We walk the DOM with closest('[data-vaul-drawer]') instead of checking
// sheet.value.contains(target), because sheet.value is populated by a
// post-flush watch on drawerContentRef.$el and can still be null on the
// first pointerdown of the first open — that race was what broke the
// first drag after opening the sheet.
function onPointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement | null
  if (!target || !target.closest('[data-vaul-drawer]')) return
  isDragging.value = true
  startLiveTracking()
}
function onPointerEnd() {
  // Tap / release — clear the optimistic drag flag. If a real drag
  // occurred, @release has already fired and set isAnimating so the rAF
  // keeps ticking until @animation-end.
  isDragging.value = false
}

onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('pointerup', onPointerEnd, true)
  window.addEventListener('pointercancel', onPointerEnd, true)
})
onUnmounted(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('pointerup', onPointerEnd, true)
  window.removeEventListener('pointercancel', onPointerEnd, true)
  if (rafId) cancelAnimationFrame(rafId)
})

const { y: scrollY } = useScroll(scrollContainer)
const isAtTop = computed(() => scrollY.value === 0)

// ==================== SAFE AREA HANDLING ====================
// Use refs that only increase to prevent brief resets during init (common in mobile WebViews)
const { top: safeAreaTop, bottom: safeAreaBottom } = useScreenSafeArea()
const safeAreaInsetTop = ref(0)
const safeAreaInsetBottom = ref(0)

watch(
  () => parseFloat(safeAreaTop.value) || 0,
  val => {
    if (val > safeAreaInsetTop.value) safeAreaInsetTop.value = val
  },
  { immediate: true },
)
watch(
  () => parseFloat(safeAreaBottom.value) || 0,
  val => {
    if (val > safeAreaInsetBottom.value) safeAreaInsetBottom.value = val
  },
  { immediate: true },
)

// ==================== SNAP POINTS ====================
// Flow: userSnapPoints → snapPoints (with safe area adjustments) → vaul

// User-provided snap points (or sensible defaults)
const userSnapPoints = computed<SnapPoint[]>(
  () => props.customSnapPoints ?? [props.peekHeight, 0.5, 1],
)

// Apply safe area adjustments to a snap point
function adjustForSafeArea(point: SnapPoint, index: number): SnapPoint {
  if (!props.respectSafeArea) return point

  // Full height (1) → respect top safe area (notch/status bar)
  if (point === 1 && safeAreaInsetTop.value > 0) {
    return (windowHeight.value - safeAreaInsetTop.value) / windowHeight.value
  }

  // First snap point (peek) → add bottom safe area (home indicator)
  if (index === 0 && safeAreaInsetBottom.value > 0) {
    if (typeof point === 'string' && point.endsWith('px')) {
      return `${parseFloat(point) + safeAreaInsetBottom.value}px`
    }
    if (typeof point === 'number') {
      if (point > 0 && point <= 1) {
        return (
          (point * windowHeight.value + safeAreaInsetBottom.value) /
          windowHeight.value
        )
      }
      return point + safeAreaInsetBottom.value
    }
  }

  return point
}

// Final snap points passed to vaul (with safe area adjustments applied)
const snapPoints = computed<SnapPoint[]>(() =>
  userSnapPoints.value.map((point, i) => adjustForSafeArea(point, i)),
)

// ==================== SNAP POINT STATE ====================

// Track which index we're at (persists across snapPoints array changes)
const snapIndex = ref(props.defaultSnapPointIndex ?? 0)

// Derived state
const activeSnapPointIndex = computed(() => {
  if (activeSnapPoint.value === null) return -1
  return snapPoints.value.indexOf(activeSnapPoint.value)
})

const isFullyExpanded = computed(() => {
  if (props.fitContent) return props.open
  return activeSnapPoint.value === snapPoints.value.at(-1)
})

// ==================== SNAP POINT SYNCING ====================

// When user drags to a new snap point, update our tracked index
watch(activeSnapPoint, val => {
  if (val === null) return
  const idx = snapPoints.value.indexOf(val)
  if (idx >= 0) snapIndex.value = idx
})

// When snapPoints array changes (e.g., safe area loads), update position
// flush: 'post' ensures we run after vaul's internal updates
watch(
  snapPoints,
  points => {
    if (!props.open || snapIndex.value < 0) return
    const target = points[snapIndex.value]
    if (target && activeSnapPoint.value !== target) {
      activeSnapPoint.value = target
    }
  },
  { flush: 'post' },
)

function handleOpenChange(open: boolean) {
  // Prevent closing this drawer if another drawer is currently dismissing
  // This prevents the focus-outside bug when non-modal drawers are transitioning
  if (!open && props.open && !props.modal && isDismissing()) {
    return
  }

  if (!open && props.open) {
    // Drawer is starting to close - register it
    registerDismissing(drawerId)

    // TODO: Move to animation end event
    // Unregister after animation completes (typical drawer animation is 300-500ms)
    setTimeout(() => {
      unregisterDismissing(drawerId)
    }, 500)
  }

  emit('update:open', open)
}

function onSnapPointChange(point: SnapPoint | null) {
  // activeSnapPoint.value = point as number
  emit('update:activeSnapPoint', point)
  emit(
    'update:activeSnapPointIndex',
    snapPoints.value.indexOf(point as SnapPoint),
  )
}

// Handle ESC key
useHotkeys([
  {
    key: 'esc',
    handler: () => {
      if (props.dismissable) emit('update:open', false)
    },
  },
])

// Handle external activeSnapPoint prop changes (parent sets a user-facing snap point value)
watch(
  () => props.activeSnapPoint,
  newPoint => {
    if (!newPoint) return
    // Map from user snap point to adjusted snap point
    const idx = userSnapPoints.value.indexOf(newPoint)
    if (idx >= 0) {
      const adjusted = snapPoints.value[idx]
      if (adjusted && adjusted !== activeSnapPoint.value) {
        activeSnapPoint.value = adjusted as number
      }
    }
  },
)

// Close when snap point becomes invalid (dragged below minimum)
watch(activeSnapPointIndex, idx => {
  if (idx === -1) emit('update:open', false)
})

// Fix: Capture the current transform position before the drawer closes
// to prevent the close animation from jumping back to the snap point
watch(
  () => props.open,
  (newValue, oldValue) => {
    if (oldValue && !newValue) {
      // Drawer is about to close - capture current transform position
      const drawer = drawerContentRef.value?.$el as HTMLElement | undefined
      if (drawer) {
        const computedStyle = window.getComputedStyle(drawer)
        const transform = computedStyle.transform

        // Extract the Y translation from the matrix
        const match = transform.match(/matrix.*\((.+)\)/)
        if (match) {
          const values = match[1].split(', ')
          // For matrix3d, Y is at index 13; for matrix, Y is at index 5
          const yValue = transform.startsWith('matrix3d')
            ? parseFloat(values[13])
            : parseFloat(values[5])

          if (!isNaN(yValue)) {
            // Set CSS custom property for the close animation starting position
            drawer.style.setProperty('--close-from-position', `${yValue}px`)
          }
        }
      }
    }
  },
  { flush: 'sync' }, // Use sync to run before DOM updates
)

// ==================== TOUCH SCROLL HANDLING ====================

let lastTouchY = 0
let isScrollingUp = false

function handleTouchStart(e: TouchEvent) {
  lastTouchY = e.touches[0].clientY
}

function handleTouchMove(e: TouchEvent) {
  if (!isFullyExpanded.value) return

  const currentTouchY = e.touches[0].clientY
  const deltaY = currentTouchY - lastTouchY
  isScrollingUp = deltaY > 0 // Positive deltaY means scrolling up (finger moving down)

  // Prevent upward scroll when at the top of the container
  if (isAtTop.value && isScrollingUp) {
    e.preventDefault()
    return false
  }

  lastTouchY = currentTouchY
}

function handleTouchEnd() {
  isScrollingUp = false
}

function handleAnimationEnd(open: boolean) {
  // Clear the animation flag so obstructing bounds switch back to the
  // target snap point (flyTo callers can read stable padding again).
  isAnimating.value = false
  stopLiveTracking()

  if (!open) {
    setTimeout(() => {
      activeSnapPoint.value =
        snapPoints.value[props.defaultSnapPointIndex] ?? null
    }, 100)
  }
}
</script>

<template>
  <DrawerRoot
    :open="props.open"
    @update:open="handleOpenChange"
    @drag="onVaulDrag"
    @release="onVaulRelease"
    @animation-end="handleAnimationEnd"
    :modal="modal"
    :should-scale-background="true"
    direction="bottom"
    :snap-points="props.fitContent ? undefined : snapPoints"
    v-model:active-snap-point="activeSnapPoint"
    @update:activeSnapPoint="onSnapPointChange"
    :repositionInputs="true"
    :dismissible="props.dismissable"
    :fade-from-index="props.fitContent ? undefined : (0 as any)"
  >
    <DrawerPortal>
      <DrawerOverlay
        :class="cn('fixed bg-black/40 inset-0')"
        :style="{ zIndex: 30 + props.zIndexOffset }"
      />
      <DrawerContent
        ref="drawerContentRef"
        :class="
          cn(
            'bg-background rounded-t-md shadow-lg flex flex-col border-t border-border',
            props.fitContent
              ? 'fixed bottom-0 left-0 right-0 max-h-[calc(100vh-env(safe-area-inset-top))]'
              : 'min-h-full absolute top-0 bottom-0 left-0 right-0',
            props.class,
          )
        "
        :style="{
          zIndex: 40 + props.zIndexOffset,
          '--tw-shadow':
            '0 -4px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
        }"
        :data-vaul-no-drag="!isAtTop ? '' : undefined"
      >
        <!-- Header: absolutely positioned so it never displaces content.
             Individual views add their own top padding/title to clear it. -->
        <div
          v-if="props.showDragHandle || $slots.actions"
          ref="headerRef"
          class="absolute top-0 left-0 right-0 z-10 grid grid-cols-[1fr_auto_1fr] items-start pointer-events-none"
        >
          <!-- Col 1: left spacer -->
          <div />

          <!-- Col 2: drag handle (centered) -->
          <div class="flex justify-center pb-1.5 pt-2">
            <DrawerHandle
              v-if="props.showDragHandle"
              class="h-1 w-16 rounded-full bg-muted-foreground"
            />
          </div>

          <!-- Col 3: actions slot (right-aligned) -->
          <div
            class="flex items-center justify-end pt-3 pr-2 pointer-events-auto"
          >
            <slot name="actions" />
          </div>
        </div>

        <!-- Close button: absolutely positioned so it never affects flow -->
        <DrawerClose v-if="props.showCloseButton" as-child>
          <Button
            variant="secondary"
            size="icon-sm"
            class="rounded-full absolute top-2 right-2 z-50"
          >
            <X class="size-4" />
          </Button>
        </DrawerClose>

        <div
          ref="scrollContainer"
          :class="
            cn('pb-[env(safe-area-inset-bottom)]', {
              'flex-1 h-[200vh]': !props.fitContent,
              'overflow-y-auto': isFullyExpanded,
              'overflow-y-hidden': !isFullyExpanded,
            })
          "
          :style="{
            touchAction: isFullyExpanded ? 'pan-y' : 'none',
            overscrollBehavior: 'none',
          }"
          @touchstart="handleTouchStart"
          @touchmove="handleTouchMove"
          @touchend="handleTouchEnd"
        >
          <slot />
          <!-- Spacer to account for safe area inset bottom -->
          <div class="w-full h-[env(safe-area-inset-bottom)]"></div>
        </div>
      </DrawerContent>
    </DrawerPortal>
  </DrawerRoot>
</template>

<style scoped>
[data-vaul-drawer] {
  position: fixed;
  transition: transform 0.5s cubic-bezier(0.32, 0.72, 0, 1);
  animation-duration: 0.5s;
}

[data-vaul-drawer][data-vaul-snap-points='true'][data-vaul-drawer-direction='bottom'][data-state='open'] {
  animation-name: slideFromBottomToSnapPoint;
}

@keyframes slideFromBottomToSnapPoint {
  from {
    transform: translate3d(0, var(--initial-transform, 100%), 0);
  }
  to {
    transform: translate3d(0, var(--snap-point-height, 0), 0);
  }
}

/* Fix: Override the close animation for snap-point drawers to start from the current position */
[data-vaul-drawer][data-vaul-drawer-direction='bottom'][data-state='closed'] {
  animation-name: slideToBottomFromCurrentPosition !important;
}

@keyframes slideToBottomFromCurrentPosition {
  from {
    transform: translate3d(
      0,
      var(--close-from-position, var(--snap-point-height, 0)),
      0
    );
  }
  to {
    transform: translate3d(0, 100%, 0);
  }
}
</style>
