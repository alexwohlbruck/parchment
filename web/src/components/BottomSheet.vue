<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { cn } from '@/lib/utils'
import { useWindowSize, useScroll } from '@vueuse/core'
// import { useObstructingComponent } from '@/composables/useObstructingComponent'
import { useAppStore } from '@/stores/app.store'
import { useDragState } from '@/composables/useDragState'
import { useHotkeys } from '@/composables/useHotkeys'
import { 
  DrawerRoot, 
  DrawerContent, 
  DrawerOverlay, 
  DrawerPortal, 
  DrawerHandle,
  DrawerClose
} from 'vaul-vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { X } from 'lucide-vue-next'

const props = defineProps<{
  class?: HTMLAttributes['class']
  peekHeight?: number | string
  dismissable?: boolean
  open?: boolean
  showDragHandle?: boolean
  showCloseButton?: boolean
  activeSnapPoint?: number | string | null
  customSnapPoints?: (number | string)[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:open', open: boolean): void
  (e: 'snapPointChange', snapPoint: string): void
  (e: 'update:activeSnapPoint', snapPoint: number | string | null): void
  (e: 'update:activeSnapPointIndex', index: number): void
}>()

const sheet = ref<HTMLElement | null>(null)
const scrollContainer = ref<HTMLElement | null>(null)
const headerRef = ref<HTMLElement | null>(null)
const isOpen = ref(props.open ?? true)
const activeSnapPoint = ref<number | string | null>(props.activeSnapPoint ?? null)
const { isDragActive } = useDragState()
const appStore = useAppStore()

// useObstructingComponent(sheet, 'bottom-sheet')

const { y: scrollY } = useScroll(scrollContainer)
const isAtTop = computed(() => scrollY.value === 0)

let lastTouchY = 0
let isScrollingUp = false
const snapPoints = computed(() => props.customSnapPoints ?? [props.peekHeight ?? '300px', 0.5, 1])
const isFullyExpanded = computed(() => activeSnapPoint.value === 1)

// Computed value for active snap point index
const activeSnapPointIndex = computed(() => {
  const currentSnapPoint = activeSnapPoint.value
  if (currentSnapPoint === null) return -1
  return snapPoints.value.findIndex(point => point === currentSnapPoint)
})

function handleOpenChange(open: boolean) {
  isOpen.value = open
  emit('update:open', open)
  if (!open) {
    emit('close')
  }
}

function snapPointChanged(snapPoint: number | string | null) {
  activeSnapPoint.value = snapPoint
  const snapIndex = snapPoints.value.indexOf(snapPoint as string | number)
  const snapName = String(snapPoints.value[snapIndex] || 'UNKNOWN')
  
  // Emit both events for different use cases
  emit('snapPointChange', snapName)
  emit('update:activeSnapPoint', snapPoint)
  emit('update:activeSnapPointIndex', snapIndex)
  
  // Manually trigger refresh of obstructing components when snap position changes
  // This provides more precise timing than the automatic debounced updates
  nextTick(() => {
    // TODO: Not working
    // appStore.refreshObstructingComponents()
  })
}

// Handle ESC key
useHotkeys([
  {
    key: 'esc',
    handler: () => {
      isOpen.value = false
      emit('close')
    },
  },
])

// Watch for external open prop changes
watch(() => props.open, (newOpen) => {
  if (newOpen !== undefined && newOpen !== isOpen.value) {
    isOpen.value = newOpen
  }
})

// Watch for external activeSnapPoint prop changes
watch(() => props.activeSnapPoint, (newSnapPoint) => {
  if (newSnapPoint !== undefined && newSnapPoint !== activeSnapPoint.value) {
    activeSnapPoint.value = newSnapPoint
  }
})

watch(activeSnapPointIndex, (newIndex) => {
  if (newIndex === -1) {
    emit('close')
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

// Initialize the activeSnapPoint with the first snap point if not provided
onMounted(() => {
  if (activeSnapPoint.value === null) {
    activeSnapPoint.value = snapPoints.value[0]
    // Emit the initial index
    nextTick(() => {
      emit('update:activeSnapPointIndex', 0)
    })
  }
})

</script>

<template>

<DrawerRoot
    :open="isOpen"
    @open-change="handleOpenChange"
    :modal="false"
    direction="bottom"
    :snap-points="snapPoints"
    v-model:active-snap-point="activeSnapPoint"
    @update:activeSnapPoint="snapPointChanged"
    :repositionInputs="true"
    :dismissible="!props.dismissable"
    >
    <DrawerPortal>
      <DrawerOverlay class="fixed bg-black/40 inset-0 z-50"/>
      <DrawerContent
        ref="sheet"
        :class="cn('bg-background z-30 rounded-t-md min-h-full shadow-lg flex flex-col fixed z-50 bottom-0 left-0 right-0', props.class)"

      >
        <div v-if="props.showDragHandle || props.showCloseButton" ref="headerRef" class="flex justify-between items-center flex-shrink-0">
          <div v-if="props.showDragHandle" class="flex-1 flex justify-center py-3">
            <DrawerHandle class="h-1 w-16 rounded-full bg-muted-foreground" />
          </div>
          <DrawerClose v-if="props.showCloseButton" as-child>
            <Button
              variant="secondary"
              size="icon-xs"
              class="rounded-full hover:bg-muted transition-colors absolute top-2 right-2"
              @click="emit('close')"
            >
              <X class="size-3.5" />
            </Button>
          </DrawerClose>
        </div>
        
        <!-- Scrollable content -->
        <div
          ref="scrollContainer"
          :class="
            cn('flex-1 overscroll-contain', {
            })
          "
        >
        
              <!-- 'overflow-y-auto pointer-events-auto': isFullyExpanded,
              'overflow-y-hidden pointer-events-none': !isFullyExpanded, -->
        
          <!-- @touchstart="handleTouchStart"
          @touchmove="handleTouchMove"
          @touchend="handleTouchEnd" -->
            <slot/>
        </div>
      </DrawerContent>
    </DrawerPortal>
  </DrawerRoot>

</template>


<style scoped>
[data-vaul-drawer][data-vaul-snap-points=true][data-vaul-drawer-direction=bottom][data-state=open] {
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
