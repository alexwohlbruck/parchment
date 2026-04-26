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

const props = defineProps<
  DialogContentProps & {
    class?: HTMLAttributes['class']
    noPadding?: boolean
    showCloseButton?: boolean
  }
>()
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
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border border-border shadow-lg duration-200 sm:max-w-lg',
          !props.noPadding && 'p-6',
          props.class,
        )
      "
    >
      <slot />

      <!-- Match the BottomSheet close button style: secondary pill in the
           top-right corner. Keeps the close affordance consistent across
           every modal surface in the app. -->
      <DialogClose v-if="props.showCloseButton" as-child>
        <Button
          variant="secondary"
          size="icon-sm"
          class="rounded-full absolute top-2 right-2 z-50"
          aria-label="Close"
        >
          <X class="size-4" />
        </Button>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
