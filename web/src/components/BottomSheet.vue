<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { cn } from '@/lib/utils'
import { useWindowSize, useScroll } from '@vueuse/core'
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
  }>(),
  {
    open: true,
    modal: false,
    obstructingKey: 'bottom-sheet',
    defaultSnapPointIndex: 0,
    trackObstructing: true,
    zIndexOffset: 0,
  },
)

const emit = defineEmits<{
  (e: 'update:open', open: boolean): void
  (e: 'snapPointChange', snapPoint: string): void
  (e: 'update:activeSnapPoint', snapPoint: number | string | null): void
  (e: 'update:activeSnapPointIndex', index: number): void
}>()

const sheet = ref<HTMLElement | null>(null)
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

const shouldTrack = computed(() => {
  return props.open && props.trackObstructing
})

// Calculate manual bounds based on snap point
const manualBounds = computed<ManualBounds | null>(() => {
  if (!props.trackObstructing) return null

  let snapPoint = activeSnapPoint.value
  const open = props.open // Watch both snap point and open state together
  if (snapPoint === null) return null

  // Use the second to last snap point when fully expanded
  if (isFullyExpanded.value) {
    snapPoint = snapPoints.value[snapPoints.value.length - 2]
  }

  let sheetHeight: number

  if (typeof snapPoint === 'number') {
    // If it's between 0 and 1, treat it as a percentage
    if (snapPoint > 0 && snapPoint <= 1) {
      sheetHeight = windowHeight.value * snapPoint
    } else {
      // Otherwise, treat it as pixel value
      sheetHeight = snapPoint
    }
  } else if (typeof snapPoint === 'string') {
    // Parse pixel values like "300px"
    if (snapPoint.endsWith('px')) {
      sheetHeight = parseFloat(snapPoint)
    } else {
      // Assume it's a number string
      sheetHeight = parseFloat(snapPoint)
    }
  } else {
    return null
  }

  return {
    x: 0,
    y: windowHeight.value - sheetHeight,
    width: windowWidth.value,
    height: sheetHeight,
  }
})

useObstructingComponent(sheet, props.obstructingKey, manualBounds, shouldTrack)

const { y: scrollY } = useScroll(scrollContainer)
const isAtTop = computed(() => scrollY.value === 0)

let lastTouchY = 0
let isScrollingUp = false
const snapPoints = computed(
  () => props.customSnapPoints ?? [props.peekHeight ?? '250px', 0.5, 1],
)
const isFullyExpanded = computed(() => activeSnapPoint.value === 1)

// Computed value for active snap point index
const activeSnapPointIndex = computed(() => {
  const currentSnapPoint = activeSnapPoint.value
  if (currentSnapPoint === null) return -1
  return snapPoints.value.findIndex(point => point === currentSnapPoint)
})

function handleOpenChange(open: boolean) {
  // Prevent closing this drawer if another drawer is currently dismissing
  // This prevents the focus-outside bug when non-modal drawers are transitioning
  if (!open && props.open && !props.modal && isDismissing()) {
    return
  }

  if (!open && props.open) {
    // Drawer is starting to close - register it
    registerDismissing(drawerId)

    // Unregister after animation completes (typical drawer animation is 300-500ms)
    setTimeout(() => {
      unregisterDismissing(drawerId)
    }, 500)
  }

  emit('update:open', open)
}

function snapPointChanged(snapPoint: number | string | null) {
  activeSnapPoint.value = snapPoint
  const snapIndex = snapPoints.value.indexOf(snapPoint as string | number)
  emit('update:activeSnapPoint', snapPoint)
  emit('update:activeSnapPointIndex', snapIndex)
}

// Handle ESC key
useHotkeys([
  {
    key: 'esc',
    handler: () => {
      if (props.dismissable) {
        emit('update:open', false)
      }
    },
  },
])

// Watch for external activeSnapPoint prop changes
watch(
  () => props.activeSnapPoint,
  newSnapPoint => {
    if (newSnapPoint !== undefined && newSnapPoint !== activeSnapPoint.value) {
      activeSnapPoint.value = newSnapPoint
    }
  },
)

watch(activeSnapPointIndex, (newIndex, oldIndex) => {
  if (newIndex === -1) {
    emit('update:open', false)
  }
})

// Touch event handlers to prevent upward scroll when at top
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
</script>

<template>
  <DrawerRoot
    :open="props.open"
    @update:open="handleOpenChange"
    :modal="modal"
    :should-scale-background="true"
    direction="bottom"
    :snap-points="snapPoints"
    v-model:active-snap-point="activeSnapPoint"
    @update:activeSnapPoint="snapPointChanged"
    :default-snap-point="props.defaultSnapPointIndex"
    :repositionInputs="true"
    :dismissible="props.dismissable"
    :fade-from-index="0 as any
    "
  >
    <DrawerPortal>
      <DrawerOverlay
        :class="cn('fixed bg-black/40 inset-0')"
        :style="{ zIndex: 30 + props.zIndexOffset }"
      />
      <DrawerContent
        :class="
          cn(
            'bg-background rounded-t-md min-h-full shadow-lg flex flex-col fixed bottom-0 left-0 right-0',
            props.class,
          )
        "
        :style="{
          zIndex: 40 + props.zIndexOffset,
          '--tw-shadow':
            '0 -4px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
        }"
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
            cn('flex-1 h-[200vh]', {
              'overflow-y-auto': isFullyExpanded,
              'overflow-y-hidden': !isFullyExpanded,
            })
          "
          :style="{ touchAction: isFullyExpanded ? 'pan-y' : 'none' }"
          @touchstart="handleTouchStart"
          @touchmove="handleTouchMove"
          @touchend="handleTouchEnd"
        >
          <slot />
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
</style>
