<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useResponsive } from '@/lib/utils'
import BottomSheet from '@/components/BottomSheet.vue'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

const props = withDefaults(
  defineProps<{
    open?: boolean
    align?: 'start' | 'center' | 'end'
    side?: 'top' | 'right' | 'bottom' | 'left'
    sideOffset?: number
    desktopContentClass?: string
    mobileContentClass?: string
    // Bottom sheet specific props
    modal?: boolean
    peekHeight?: number | string
    customSnapPoints?: (number | string)[]
    showDragHandle?: boolean
    showCloseButton?: boolean
    zIndexOffset?: number
  }>(),
  {
    align: 'center',
    side: 'bottom',
    sideOffset: 0,
    modal: false,
    showDragHandle: true,
    showCloseButton: true,
    zIndexOffset: 0,
  },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { isMobileScreen } = useResponsive()
const mobileOpen = ref(false)
const desktopOpen = ref(props.open ?? false)

// Handle mobile bottom sheet open/close
function handleMobileOpenChange(value: boolean) {
  mobileOpen.value = value
  emit('update:open', value)
}

// Handle desktop popover open/close
function handleDesktopOpenChange(value: boolean) {
  desktopOpen.value = value
  emit('update:open', value)
}

// Sync state with prop if provided
watch(
  () => props.open,
  newValue => {
    if (newValue !== undefined) {
      if (isMobileScreen.value) {
        mobileOpen.value = newValue
      } else {
        desktopOpen.value = newValue
      }
    }
  },
)
</script>

<template>
  <!-- Mobile: Bottom Sheet with controlled open state -->
  <template v-if="isMobileScreen">
    <div @click="handleMobileOpenChange(true)">
      <slot name="trigger" />
    </div>

    <BottomSheet
      v-model:open="mobileOpen"
      :modal="props.modal"
      :peek-height="props.peekHeight"
      :custom-snap-points="props.customSnapPoints"
      :show-drag-handle="props.showDragHandle"
      :show-close-button="props.showCloseButton"
      :dismissable="true"
      obstructing-key="responsive-popover"
      :z-index-offset="props.zIndexOffset"
    >
      <div :class="props.mobileContentClass || 'p-4'">
        <slot name="content" :close="() => handleMobileOpenChange(false)" />
      </div>
    </BottomSheet>
  </template>

  <!-- Desktop: Popover (controlled state for click trigger) -->
  <Popover
    v-else
    v-model:open="desktopOpen"
    @update:open="handleDesktopOpenChange"
  >
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverContent
      :align="props.align"
      :side="props.side"
      :side-offset="props.sideOffset"
      :class="props.desktopContentClass"
    >
      <slot name="content" :close="() => handleDesktopOpenChange(false)" />
    </PopoverContent>
  </Popover>
</template>
