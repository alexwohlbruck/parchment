<script setup lang="ts">
import {
  useResponsiveOverlay,
  type ResponsiveOverlayBaseProps,
  type ResponsiveOverlayTitleProps,
} from '@/composables/useResponsiveOverlay'
import BottomSheet from '@/components/BottomSheet.vue'
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
}

const props = withDefaults(defineProps<Props>(), {
  showDragHandle: true,
  showCloseButton: true,
  noPadding: false,
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
</script>

<template>
  <!-- Mobile: Bottom Sheet -->
  <div v-if="isMobileScreen">
    <div @click="handleOpenChange(true)">
      <slot name="trigger" :open="() => handleOpenChange(true)" />
    </div>

    <BottomSheet
      v-model:open="internalOpen"
      :peek-height="props.peekHeight"
      :custom-snap-points="props.customSnapPoints"
      :show-drag-handle="props.showDragHandle"
      :show-close-button="props.showCloseButton"
      :dismissable="true"
      obstructing-key="responsive-dialog"
    >
      <div :class="props.noPadding ? 'p-0' : 'p-4'">
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
      </div>
    </BottomSheet>
  </div>

  <!-- Desktop: Dialog -->
  <Dialog v-else v-model:open="internalOpen">
    <DialogTrigger as-child>
      <slot name="trigger" :open="() => handleOpenChange(true)" />
    </DialogTrigger>
    <DialogContent :class="props.contentClass">
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
