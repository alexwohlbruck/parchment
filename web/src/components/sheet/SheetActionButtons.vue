<script setup lang="ts">
import { computed } from 'vue'
import { TransitionSlide } from '@morev/vue-transitions'
import { Button } from '@/components/ui/button'
import {
  ArrowLeftIcon,
  XIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelBottomCloseIcon,
  PanelBottomOpenIcon,
} from 'lucide-vue-next'

/**
 * Navigation buttons used by the app's primary drawers.
 *
 * Layout & visibility rules:
 *   - `direction="left"` (desktop LeftSheet): vertical stack. When the sheet
 *     is collapsed, the action buttons slide out and the toggle button
 *     animates up into their place.
 *   - `direction="bottom"` (mobile BottomSheet): horizontal row. The hide/show
 *     toggle is omitted — the drag handle already handles that on mobile.
 *
 * Button behaviour:
 *   - Back (←): only shown when `canGoBack` is true. Emits `back`.
 *   - Close (×): always shown (when primaryVisible). Emits `home` — always
 *     navigates to the map root regardless of history.
 *   - If `canGoBack` is false the close button is the only action button shown.
 */

const props = withDefaults(
  defineProps<{
    canGoBack?: boolean
    hidden?: boolean
    direction?: 'left' | 'bottom'
  }>(),
  { direction: 'left' },
)

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'home'): void
  (e: 'update:hidden', value: boolean): void
}>()

const isHorizontal = computed(() => props.direction === 'bottom')

// On mobile every button stays visible in all snap states so the sheet can be
// dismissed even from the peek position. On desktop they collapse when hidden.
const primaryVisible = computed(() => isHorizontal.value || !props.hidden)

function toggleHidden() {
  emit('update:hidden', !props.hidden)
}

const hideIcon = computed(() =>
  isHorizontal.value ? PanelBottomCloseIcon : PanelLeftCloseIcon,
)
const showIcon = computed(() =>
  isHorizontal.value ? PanelBottomOpenIcon : PanelLeftOpenIcon,
)

// Slide buttons in from the outside edge of the layout on mount/unmount.
const slideOffset = computed<[number | string, number | string]>(() =>
  isHorizontal.value ? [16, 0] : [0, -20],
)
</script>

<template>
  <!--
    TransitionSlide with `group` acts as a <TransitionGroup>, which runs FLIP
    animations on remaining children when a sibling enters / leaves. That's
    how the toggle button smoothly slides into the vacated slot on desktop
    collapse (and back out on expand).
  -->
  <TransitionSlide
    group
    tag="div"
    :duration="200"
    :move-duration="250"
    :offset="slideOffset"
    :class="[
      'flex pointer-events-auto',
      isHorizontal ? 'flex-row gap-1 px-1' : 'flex-col gap-2 p-2',
    ]"
  >
    <!-- Toggle (hide/show) — desktop only. `order-last` keeps it below the
         action buttons in the vertical stack. -->
    <Button
      v-if="!isHorizontal"
      key="toggle"
      variant="outline"
      size="icon-sm"
      class="rounded-full shadow-md bg-background order-last"
      :description="hidden ? 'Show panel' : 'Hide panel'"
      @click="toggleHidden"
    >
      <component :is="hidden ? showIcon : hideIcon" class="size-4" />
    </Button>

    <!-- Back button — only when there is history to go back to. -->
    <Button
      v-if="canGoBack && primaryVisible"
      key="back"
      :variant="isHorizontal ? 'secondary' : 'outline'"
      size="icon-sm"
      :class="['rounded-full select-none', isHorizontal ? '' : 'shadow-md bg-background']"
      description="Back"
      @click="emit('back')"
    >
      <ArrowLeftIcon :class="isHorizontal ? 'size-3.5' : 'size-4'" />
    </Button>

    <!-- Close button — always goes to map root. -->
    <Button
      v-if="primaryVisible"
      key="home"
      :variant="isHorizontal ? 'secondary' : 'outline'"
      size="icon-sm"
      :class="['rounded-full select-none', isHorizontal ? '' : 'shadow-md bg-background']"
      description="Close"
      @click="emit('home')"
    >
      <XIcon :class="isHorizontal ? 'size-3.5' : 'size-4'" />
    </Button>
  </TransitionSlide>
</template>
