<script setup lang="ts">
import { ref, computed, watch, onUnmounted, onMounted } from 'vue'
import { useElementBounding } from '@vueuse/core'
import { Card } from '@/components/ui/card'
import { useObstructingComponent } from '@/composables/useObstructingComponent'
import { useHotkeys } from '@/composables/useHotkeys'
import { useAppStore } from '@/stores/app.store'
import SheetActionButtons from '@/components/SheetActionButtons.vue'

defineProps<{
  canGoBack?: boolean
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'home'): void
}>()

const appStore = useAppStore()
const sheet = ref<HTMLElement | null>(null)
const buttonColumnEl = ref<HTMLElement | null>(null)
const hidden = ref(false)
const trackingEnabled = computed(() => !hidden.value)

// Keep local hidden in sync with the store so DesktopNavigation can open
// the drawer by writing to appStore.leftSheetHidden.
watch(
  () => appStore.leftSheetHidden,
  val => { hidden.value = val },
)
watch(hidden, val => { appStore.leftSheetHidden = val })
onMounted(() => { appStore.leftSheetHidden = false })
onUnmounted(() => { appStore.leftSheetHidden = false })

useObstructingComponent(sheet, 'left-sheet', undefined, trackingEnabled)

// Measure the button column so map widgets can reserve matching space when
// the drawer is collapsed (only the expand button is visible then).
// We wrap SheetActionButtons in a plain div so useElementBounding always
// receives a proper DOM element (TransitionGroup components expose a fragment
// as $el which lacks getBoundingClientRect).
const { width: buttonColumnWidth } = useElementBounding(buttonColumnEl)

watch(
  [hidden, buttonColumnWidth],
  ([isHidden, w]) => {
    appStore.leftSheetOverlayWidth = isHidden ? w : 0
  },
  { immediate: true },
)

onUnmounted(() => {
  appStore.leftSheetOverlayWidth = 0
})

useHotkeys([
  {
    key: 'esc',
    handler: () => emit('back'),
  },
])
</script>

<template>
  <div
    class="absolute top-0 left-0 h-full z-30 flex flex-row items-start pointer-events-none transition-transform duration-300 ease-out"
    :class="hidden ? '-translate-x-104' : 'translate-x-0'"
  >
    <Card
      ref="sheet"
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
