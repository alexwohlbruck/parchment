<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  useResponsiveOverlay,
  type ResponsiveOverlayBaseProps,
  type ResponsiveOverlayPositionProps,
} from '@/composables/useResponsiveOverlay'
import BottomSheet from '@/components/BottomSheet.vue'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

/** Floating-ui reference: a real element or a virtual one (anything exposing
 *  getBoundingClientRect in viewport coordinates). */
type PopoverReference =
  | HTMLElement
  | { getBoundingClientRect: () => DOMRect }

interface Props
  extends ResponsiveOverlayBaseProps,
    ResponsiveOverlayPositionProps {
  desktopContentClass?: string
  mobileContentClass?: string
  modal?: boolean
  zIndexOffset?: number
  /**
   * Mobile only: let the bottom sheet size itself to the content height
   * instead of running snap points. Ignored on desktop (the popover is
   * already content-sized).
   */
  fitContent?: boolean
  /**
   * Desktop only: anchor the popover to this element or virtual element
   * instead of the trigger — e.g. a virtual rect at map click coordinates
   * for popovers opened programmatically. Ignored on mobile (the bottom
   * sheet has no anchor).
   */
  reference?: PopoverReference
}

const props = withDefaults(defineProps<Props>(), {
  align: 'center',
  side: 'bottom',
  sideOffset: 0,
  modal: false,
  showDragHandle: true,
  showCloseButton: true,
  zIndexOffset: 0,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { isMobileScreen } = useResponsiveOverlay({
  getOpen: () => props.open,
  emit,
})

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
      :fit-content="props.fitContent"
      obstructing-key="responsive-popover"
      :z-index-offset="props.zIndexOffset"
    >
      <div :class="props.mobileContentClass || 'pt-5 pb-4 px-4'">
        <slot name="content" :close="() => handleMobileOpenChange(false)" />
      </div>
    </BottomSheet>
  </template>

  <!-- Desktop: Popover (controlled state for click trigger). The trigger
       slot is wrapped in an inline span so PopoverTrigger's as-child event
       bindings have a concrete element to attach to — when the slot
       contains a nested shadcn <Tooltip><TooltipTrigger as-child>...</>
       (both also using as-child), PopoverTrigger's onClick otherwise gets
       swallowed by the outer Tooltip wrapper and never reaches the button.
       Clicks inside bubble to the span and open the popover normally. -->
  <Popover
    v-else
    v-model:open="desktopOpen"
    @update:open="handleDesktopOpenChange"
  >
    <!-- Custom anchor (element or virtual rect) wins over the trigger for
         positioning; the trigger keeps its open/close role. Rendered as an
         empty inline span so it never affects layout. -->
    <PopoverAnchor
      v-if="props.reference"
      :reference="props.reference"
      as="span"
    />
    <PopoverTrigger as-child>
      <span class="inline-flex"><slot name="trigger" /></span>
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
