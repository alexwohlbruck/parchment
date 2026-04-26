<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  getCurrentInstance,
} from 'vue'
import { useElementBounding, useTransition } from '@vueuse/core'
import { Card } from '@/components/ui/card'
import { useHotkeys } from '@/composables/useHotkeys'
import { useAppStore } from '@/stores/app.store'
import SheetActionButtons from '@/components/SheetActionButtons.vue'

const OBSTRUCTING_KEY = 'left-sheet'
const DURATION_MS = 300
// iOS sheet-style deceleration — no overshoot, no lingering tail.
const EASING: [number, number, number, number] = [0.32, 0.72, 0, 1]

// Transform X percentages (of the element's own width). One reactive
// animated value drives the visual slide AND the map padding sync — no
// Vue <Transition>, no rAF polling, no mount/unmount race conditions.
const OFFSET_VISIBLE = 0
const OFFSET_COLLAPSED = -90 // just the floating button column peeks out
const OFFSET_HIDDEN = -130 // fully off-screen

const props = withDefaults(
  defineProps<{
    canGoBack?: boolean
    /** When false, the sheet slides off-screen to the left. */
    show?: boolean
  }>(),
  { show: true },
)

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'home'): void
}>()

const appStore = useAppStore()
const instance = getCurrentInstance()

const sheet = ref<HTMLElement | null>(null)
const buttonColumnEl = ref<HTMLElement | null>(null)
const hidden = ref(false)

// Keep local `hidden` in sync with the store so DesktopNavigation can open
// the drawer by writing to appStore.leftSheetHidden.
watch(
  () => appStore.leftSheetHidden,
  val => {
    hidden.value = val
  },
)
watch(hidden, val => {
  appStore.leftSheetHidden = val
})

// ==================== ANIMATION ====================
//
// `useTransition` drives a single reactive number smoothly between target
// values. Because the value is reactive, changes fire both:
//   1. Vue's template update → inline transform → visual slide
//   2. The `watch` below → bounds publish → map padding setPadding
// Both are driven off the same source so they are guaranteed to stay in
// lockstep, frame-by-frame, with the chosen easing.
const targetOffset = computed(() => {
  if (!props.show) return OFFSET_HIDDEN
  if (hidden.value) return OFFSET_COLLAPSED
  return OFFSET_VISIBLE
})
const offset = useTransition(targetOffset, {
  duration: DURATION_MS,
  transition: EASING,
})

// Publish bounds on every animated-offset update so map.service's existing
// `watch(visibleMapArea)` fires each frame and setPadding stays in sync.
// `flush: 'post'` ensures we read `getBoundingClientRect` AFTER Vue has
// applied the new inline transform for this frame.
watch(
  offset,
  () => {
    const el = sheet.value
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    appStore.updateManualBounds(OBSTRUCTING_KEY, {
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
    })
  },
  { flush: 'post' },
)

onMounted(() => {
  if (instance?.proxy) {
    appStore.trackObstructingComponentWithKey(OBSTRUCTING_KEY, instance.proxy)
  }
  // Seed bounds immediately so the map has a correct padding even before
  // the first animated frame lands.
  const el = sheet.value
  if (el) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      appStore.updateManualBounds(OBSTRUCTING_KEY, {
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
      })
    }
  }
})

onUnmounted(() => {
  if (instance?.proxy) appStore.untrackObstructingComponent(instance.proxy)
  appStore.clearManualBounds(OBSTRUCTING_KEY)
  appStore.leftSheetHidden = false
  appStore.leftSheetOverlayWidth = 0
})

// Measure the button column so map widgets can reserve matching space
// when the drawer is collapsed (only the expand button is visible then).
const { width: buttonColumnWidth } = useElementBounding(buttonColumnEl)
watch(
  [hidden, buttonColumnWidth],
  ([isHidden, w]) => {
    appStore.leftSheetOverlayWidth = isHidden ? w : 0
  },
  { immediate: true },
)

// Esc closes the drawer. Gated on `show` because LeftSheet is permanently
// mounted — without the guard, pressing esc on the map root (with no
// subview open) would still fire and trigger a home navigation.
// preventDefault: false so esc still reaches Reka UI dialogs above (e.g.
// the settings dialog) when this sheet is hidden.
useHotkeys([
  {
    key: 'esc',
    preventDefault: false,
    handler: () => {
      if (!props.show) return
      emit('home')
    },
  },
])
</script>

<template>
  <div
    ref="sheet"
    class="absolute top-0 left-0 h-full z-30 flex flex-row items-start pointer-events-none"
    :style="{ transform: `translate3d(${offset}%, 0, 0)` }"
  >
    <Card
      class="bg-muted-light shadow-none overflow-y-auto pointer-events-auto w-full md:w-104 h-full flex flex-col rounded-l-none border-foreground/5 border-l-0 border-y-0 justify-start"
    >
      <slot />
    </Card>

    <div ref="buttonColumnEl">
      <SheetActionButtons
        v-model:hidden="hidden"
        :can-go-back="canGoBack"
        direction="left"
        @back="emit('back')"
        @home="emit('home')"
      />
    </div>
  </div>
</template>
