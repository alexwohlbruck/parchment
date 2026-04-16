<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useElementBounding } from '@vueuse/core'
import { Card } from '@/components/ui/card'
import { useObstructingComponent } from '@/composables/useObstructingComponent'
import { useHotkeys } from '@/composables/useHotkeys'
import { useAppStore } from '@/stores/app.store'
import { Button } from '@/components/ui/button'
import {
  ArrowLeftIcon,
  XIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from 'lucide-vue-next'

const props = defineProps<{
  canGoBack?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'back'): void
}>()

const appStore = useAppStore()
const sheet = ref<HTMLElement | null>(null)
const buttonColumn = ref<HTMLElement | null>(null)
const hidden = ref(false)
const trackingEnabled = computed(() => !hidden.value)

useObstructingComponent(sheet, 'left-sheet', undefined, trackingEnabled)

// Measure the button column so map widgets can reserve matching space when
// the drawer is collapsed (only the expand button is visible then).
const { width: buttonColumnWidth } = useElementBounding(buttonColumn)

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

function onPrimaryClick() {
  if (props.canGoBack) emit('back')
  else emit('close')
}

function toggleHidden() {
  hidden.value = !hidden.value
}

useHotkeys([
  {
    key: 'esc',
    handler: onPrimaryClick,
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

    <div
      ref="buttonColumn"
      class="flex flex-col gap-2 p-2 pointer-events-auto"
    >
      <Transition
        enter-active-class="transition-all duration-200 ease-out"
        leave-active-class="transition-all duration-200 ease-in"
        enter-from-class="opacity-0 -translate-x-2 scale-90"
        leave-to-class="opacity-0 -translate-x-2 scale-90"
      >
        <Button
          v-if="!hidden"
          variant="outline"
          size="icon-sm"
          class="rounded-full shadow-md bg-background"
          @click="onPrimaryClick"
          :description="canGoBack ? 'Back' : 'Close'"
        >
          <ArrowLeftIcon v-if="canGoBack" class="size-4" />
          <XIcon v-else class="size-4" />
        </Button>
      </Transition>

      <Button
        variant="outline"
        size="icon-sm"
        class="rounded-full shadow-md bg-background"
        @click="toggleHidden"
        :description="hidden ? 'Show panel' : 'Hide panel'"
      >
        <PanelLeftOpenIcon v-if="hidden" class="size-4" />
        <PanelLeftCloseIcon v-else class="size-4" />
      </Button>
    </div>
  </div>
</template>
