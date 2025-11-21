<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useResponsive } from '@/lib/utils'
import BottomSheet from '@/components/BottomSheet.vue'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'

const props = withDefaults(
  defineProps<{
    open?: boolean
    openDelay?: number
    closeDelay?: number
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
  }>(),
  {
    openDelay: 0,
    closeDelay: 100,
    align: 'center',
    side: 'bottom',
    sideOffset: 0,
    modal: false,
    showDragHandle: true,
    showCloseButton: true,
  },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { isMobileScreen } = useResponsive()
const mobileOpen = ref(false)

// Only used for mobile bottom sheet
function handleMobileOpenChange(value: boolean) {
  mobileOpen.value = value
  emit('update:open', value)
}

// Sync mobile state with prop if provided
watch(
  () => props.open,
  newValue => {
    if (newValue !== undefined && isMobileScreen.value) {
      mobileOpen.value = newValue
    }
  },
)
</script>

<template>
  <!-- Mobile: Bottom Sheet with click trigger -->
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
      obstructing-key="responsive-hover-card"
    >
      <div :class="props.mobileContentClass || 'p-4'">
        <slot name="content" :close="() => handleMobileOpenChange(false)" />
      </div>
    </BottomSheet>
  </template>

  <!-- Desktop: Hover Card (uncontrolled - handles its own hover state) -->
  <HoverCard
    v-else
    :open-delay="props.openDelay"
    :close-delay="props.closeDelay"
    @update:open="value => emit('update:open', value)"
  >
    <HoverCardTrigger as-child>
      <slot name="trigger" />
    </HoverCardTrigger>
    <HoverCardContent
      :align="props.align"
      :side="props.side"
      :side-offset="props.sideOffset"
      :class="props.desktopContentClass"
    >
      <slot name="content" />
    </HoverCardContent>
  </HoverCard>
</template>
