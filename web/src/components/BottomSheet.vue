<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ref, computed, watch } from 'vue'
import { cn } from '@/lib/utils'
import { useWindowSize, useScroll, useScreenSafeArea } from '@vueuse/core'
import { useObstructingComponent } from '@/composables/useObstructingComponent'
import { type ManualBounds } from '@/stores/app.store'
import { useHotkeys } from '@/composables/useHotkeys'
import { useDrawerCoordination } from '@/composables/useDrawerCoordination'
import {
  DrawerTrigger,
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
    trackObstructing?: boolean
    parentId?: string
    zIndexOffset?: number
    respectSafeArea?: boolean
  }>(),
  {
    open: true,
    modal: false,
    peekHeight: '125px',
    obstructingKey: 'bottom-sheet',
    defaultSnapPointIndex: 0,
    trackObstructing: true,
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

const open = ref(props.open)
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

const shouldTrack = computed(() => props.open && props.trackObstructing)

const manualBounds = computed<ManualBounds | null>(() => {
  if (!props.trackObstructing || activeSnapPoint.value === null) return null

  // Use second-to-last snap point when fully expanded (for map padding)
  const point = isFullyExpanded.value
    ? snapPoints.value.at(-2) ?? activeSnapPoint.value
    : activeSnapPoint.value

  const height = snapPointToPixels(point)

  return {
    x: 0,
    y: windowHeight.value - height,
    width: windowWidth.value,
    height,
  }
})

useObstructingComponent(sheet, props.obstructingKey, manualBounds, shouldTrack)

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

const isFullyExpanded = computed(
  () => activeSnapPoint.value === snapPoints.value.at(-1),
)

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
  if (!open) {
    console.log('handleAnimationEnd', open)
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
    @release="handleVaulRelease"
    @animation-end="handleAnimationEnd"
    :modal="modal"
    :should-scale-background="true"
    direction="bottom"
    :snap-points="snapPoints"
    v-model:active-snap-point="activeSnapPoint"
    @update:activeSnapPoint="onSnapPointChange"
    :repositionInputs="true"
    :dismissible="props.dismissable"
    :fade-from-index="0 as any"
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
            'bg-background rounded-t-md min-h-full shadow-lg flex flex-col absolute top-0 bottom-0 left-0 right-0 border-t border-border',
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
        <div
          v-if="props.showDragHandle || props.showCloseButton"
          ref="headerRef"
          class="flex justify-between items-center flex-shrink-0"
        >
          <div
            v-if="props.showDragHandle"
            class="flex-1 flex justify-center py-4"
          >
            <DrawerHandle class="h-1 w-16 rounded-full bg-muted-foreground" />
          </div>
          <DrawerClose v-if="props.showCloseButton" as-child>
            <Button
              variant="secondary"
              size="icon-xs"
              class="rounded-full hover:bg-muted transition-colors absolute top-2 right-2"
            >
              <X class="size-3.5" />
            </Button>
          </DrawerClose>
        </div>

        <div
          ref="scrollContainer"
          :class="
            cn('flex-1 h-[200vh] pb-[env(safe-area-inset-bottom)]', {
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
