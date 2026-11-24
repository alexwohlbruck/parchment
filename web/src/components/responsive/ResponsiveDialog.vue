<script setup lang="ts">
import { computed } from 'vue'
import {
  useResponsiveOverlay,
  type ResponsiveOverlayBaseProps,
  type ResponsiveOverlayTitleProps,
} from '@/composables/sheet/useResponsiveOverlay'
import BottomSheet from '@/components/sheet/BottomSheet.vue'
import SheetPeek from '@/components/sheet/SheetPeek.vue'
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

interface Props
  extends ResponsiveOverlayBaseProps,
    ResponsiveOverlayTitleProps {
  noPadding?: boolean
  contentClass?: string
  fitContent?: boolean
  /** Mobile only: lifts the sheet above an overlay it opens from, such as settings. */
  zIndexOffset?: number
  modal?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showDragHandle: true,
  showCloseButton: true,
  noPadding: false,
  zIndexOffset: 0,
  modal: false,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { isMobileScreen, internalOpen, handleOpenChange } = useResponsiveOverlay(
  {
    getOpen: () => props.open,
    emit,
  },
)

const FALLBACK_PEEK = '250px'

// Unless told otherwise, open just tall enough for the content, then full height.
const fitsContent = computed(
  () =>
    !props.fitContent &&
    !props.customSnapPoints &&
    props.peekHeight === undefined,
)
const snapPoints = computed(() =>
  fitsContent.value ? [FALLBACK_PEEK, 1] : props.customSnapPoints,
)
</script>

<template>
  <!-- Mobile: Bottom Sheet -->
  <div v-if="isMobileScreen">
    <div class="cursor-pointer" @click="handleOpenChange(true)">
      <slot name="trigger" :open="() => handleOpenChange(true)" />
    </div>

    <BottomSheet
      v-model:open="internalOpen"
      :peek-height="props.peekHeight"
      :custom-snap-points="snapPoints"
      :dynamic-peek="fitsContent"
      :fit-content="props.fitContent"
      :show-drag-handle="props.showDragHandle"
      :show-close-button="props.showCloseButton"
      :dismissable="true"
      :modal="props.modal"
      :z-index-offset="props.zIndexOffset"
      obstructing-key="responsive-dialog"
    >
      <SheetPeek :class="props.noPadding ? 'p-0' : 'pt-5 pb-4 px-4'">
        <div v-if="props.title || props.description" class="mb-4">
          <h2 v-if="props.title" class="text-lg font-semibold">
            {{ props.title }}
          </h2>
          <p
            v-if="props.description"
            class="text-sm text-muted-foreground mt-1"
          >
            {{ props.description }}
          </p>
        </div>
        <slot name="content" :close="() => handleOpenChange(false)" />
      </SheetPeek>
    </BottomSheet>
  </div>

  <!-- Desktop: Dialog -->
  <Dialog v-else v-model:open="internalOpen">
    <DialogTrigger as-child>
      <slot name="trigger" :open="() => handleOpenChange(true)" />
    </DialogTrigger>
    <DialogContent :class="props.contentClass" :show-close-button="props.showCloseButton">
      <DialogHeader v-if="props.title || props.description">
        <DialogTitle v-if="props.title">{{ props.title }}</DialogTitle>
        <DialogDescription v-if="props.description">{{
          props.description
        }}</DialogDescription>
      </DialogHeader>
      <slot name="content" :close="() => handleOpenChange(false)" />
    </DialogContent>
  </Dialog>
</template>
