<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { X } from 'lucide-vue-next'
import {
  DialogClose,
  DialogContent,
  type DialogContentEmits,
  type DialogContentProps,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '@/lib/utils'
import DialogOverlay from './DialogOverlay.vue'
import Button from '@/components/ui/button/Button.vue'

// Close button defaults on: dialogs are full-screen on mobile (no tap-outside
// to dismiss), so they need a visible close affordance. Dialogs that don't
// want one (e.g. the command palette) opt out with `:show-close-button="false"`.
const props = withDefaults(
  defineProps<
    DialogContentProps & {
      class?: HTMLAttributes['class']
      noPadding?: boolean
      showCloseButton?: boolean
    }
  >(),
  {
    showCloseButton: true,
  },
)
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = reactiveOmit(props, 'class', 'noPadding')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DialogPortal>
    <DialogOverlay />
    <DialogContent
      data-slot="dialog-content"
      v-bind="forwarded"
      :class="
        cn(
          // Mobile: full-screen sheet (edge-to-edge, square corners). From the
          // `sm` breakpoint up it becomes the centered, rounded card.
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed inset-0 z-50 m-auto grid w-full gap-4 depth-overlay duration-200 h-full max-w-full rounded-none border-0 sm:h-fit sm:max-w-lg sm:rounded-lg sm:border',
          !props.noPadding && 'p-6',
          props.class,
        )
      "
    >
      <slot />

      <!-- Mobile: inside close button -->
      <DialogClose v-if="props.showCloseButton" as-child class="md:hidden">
        <Button
          variant="secondary"
          size="icon-sm"
          class="rounded-full absolute top-2 right-2 z-50"
          aria-label="Close"
        >
          <X class="size-4" />
        </Button>
      </DialogClose>

      <!-- Desktop: floating close button outside dialog -->
      <DialogClose v-if="props.showCloseButton" as-child class="hidden md:flex">
        <Button
          variant="outline"
          size="icon-sm"
          class="rounded-full shadow-md bg-background absolute top-2 -right-10 z-50"
          aria-label="Close"
        >
          <X class="size-4" />
        </Button>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
